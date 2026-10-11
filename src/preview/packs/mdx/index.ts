/**
 * The MDX pack: the official MDX parser (micromark with
 * `micromark-extension-mdxjs`, GFM, frontmatter and math) to mdast, then to the contract HTML.
 * It parses the whole document in one piece (no windows), and it never runs anything.
 *
 * A parse error does not throw: `render` returns it as `RenderResult.error` with the 1-based
 * line, and the preview keeps the last good blocks and shows the banner.
 */
import type { Root } from 'mdast';
import type { FlavorId } from '@/flavors';
import { BoundedCache } from '../../cache';
import type { EnginePipeline, PipelineCounters, PipelineOptions } from '../../engine';
import { hashString } from '../../hash';
import { blockKeySuffix, registerCacheOwner } from '../../options';
import { sanitizeBlockHtml } from '../../sanitize-block';
import { slugify } from '../../slug';
import { addStats, countProse, EMPTY_STATS } from '../../stats';
import type { Analysis, DocStats, Heading, RenderedBlock, RenderResult } from '../../types';
import { type MdxError, parseMdx } from './parse';
import { type MdxDocument, renderDocument } from './render';

const WHITESPACE_RUN = /\s+/g;

/** What `analyze` counts when the text does not parse (a selection often is half a tag). */
function fallbackAnalysis(text: string): Analysis {
  const headings: Heading[] = [];
  const lines = text.split('\n');
  const used = new Map<string, number>();
  let fence = '';
  let proseText = '';
  lines.forEach((line, index) => {
    const marker = /^\s{0,3}(```+|~~~+)/.exec(line)?.[1];
    if (fence !== '') {
      if (marker?.startsWith(fence.charAt(0)) && marker.length >= fence.length) fence = '';
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    if (/^(?:import|export)\s/.test(line)) return;
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line);
    const body = heading?.[2] ?? line;
    if (heading?.[1] && heading[2] !== undefined) {
      const base = slugify(heading[2].trim());
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      headings.push({
        level: heading[1].length as Heading['level'],
        text: heading[2].trim(),
        id: n === 0 ? base : `${base}-${n}`,
        line: index,
      });
    }
    proseText += `${body.replace(/<[^>]*>|\{[^}]*\}/g, ' ')} `;
  });
  const stats = countProse(proseText.replace(WHITESPACE_RUN, ' ').trim());
  return { headings, stats: { ...stats }, frontmatter: null };
}

export class MdxPipeline implements EnginePipeline {
  readonly flavor: FlavorId = 'mdx';
  readonly counters: PipelineCounters = {
    rendered: 0,
    sanitized: 0,
    cacheHits: 0,
    counted: 0,
    windows: 0,
  };
  private readonly htmlCache: BoundedCache<string>;
  private readonly proseStats: BoundedCache<DocStats>;

  constructor(options: PipelineOptions = {}) {
    registerCacheOwner(this);
    this.htmlCache = new BoundedCache<string>({
      maxEntries: options.cacheEntries ?? 40_000,
      maxSize: options.cacheChars ?? 6_000_000,
      sizeOf: (key, html) => key.length + html.length,
    });
    this.proseStats = new BoundedCache<DocStats>({
      maxEntries: 40_000,
      maxSize: 4_000_000,
      sizeOf: (text) => text.length,
    });
  }

  clearCaches(): void {
    this.htmlCache.clear();
    this.proseStats.clear();
  }

  render(source: string): RenderResult {
    const parsed = parseMdx(source);
    if (parsed.error) return this.failed(parsed.error);
    const document = this.documentOf(parsed.tree, source);
    const blocks: RenderedBlock[] = [];
    const stats: DocStats = { words: 0, characters: 0, charactersNoSpaces: 0 };
    for (const block of document.blocks) {
      const key = hashString(block.raw + blockKeySuffix());
      addStats(stats, this.statsOf(block.runs));
      blocks.push(this.lazyBlock(key, block.raw, block.ids, block.line, block.endLine));
    }
    return {
      blocks,
      headings: document.headings,
      stats,
      frontmatter: document.frontmatter,
      features: { math: document.math, languages: document.languages },
    };
  }

  analyze(source: string): Analysis {
    const parsed = parseMdx(source);
    if (parsed.error) return fallbackAnalysis(source);
    const document = this.documentOf(parsed.tree, source);
    const stats: DocStats = { words: 0, characters: 0, charactersNoSpaces: 0 };
    for (const block of document.blocks) addStats(stats, this.statsOf(block.runs));
    return { headings: document.headings, stats, frontmatter: document.frontmatter };
  }

  renderRaw(source: string): string {
    const parsed = parseMdx(source);
    if (parsed.error) return '';
    return this.documentOf(parsed.tree, source)
      .blocks.map((block) => block.raw)
      .join('');
  }

  proseBlocks(source: string): string[] {
    const parsed = parseMdx(source);
    if (parsed.error) return [];
    return this.documentOf(parsed.tree, source)
      .blocks.map((block) => block.runs.join(' ').replace(WHITESPACE_RUN, ' ').trim())
      .filter((text) => text !== '');
  }

  // ---- internals --------------------------------------------------------------------------

  /** A parse error: the preview keeps its last good blocks and shows the banner. */
  private failed(error: MdxError): RenderResult {
    return {
      blocks: [],
      headings: [],
      stats: { ...EMPTY_STATS },
      frontmatter: null,
      features: { math: false, languages: [] },
      error,
    };
  }

  private documentOf(tree: Root, source: string): MdxDocument {
    const document = renderDocument(tree, source);
    this.counters.rendered += document.blocks.length;
    this.counters.windows++;
    return document;
  }

  /** Words and characters of a block: its runs of prose joined with one space, counted once. */
  private statsOf(runs: readonly string[]): DocStats {
    if (runs.length === 0) return EMPTY_STATS;
    const text = runs.join(' ').replace(WHITESPACE_RUN, ' ').trim();
    if (text === '') return EMPTY_STATS;
    let counted = this.proseStats.get(text);
    if (!counted) {
      counted = countProse(text);
      this.counters.counted++;
      this.proseStats.set(text, counted);
    }
    return counted;
  }

  private lazyBlock(
    key: string,
    raw: string,
    headingIds: ReadonlySet<string> | null,
    line: number,
    endLine: number,
  ): RenderedBlock {
    let pending: string | undefined = raw;
    let html: string | undefined;
    const block = { key, line, endLine } as RenderedBlock;
    Object.defineProperty(block, 'html', {
      enumerable: true,
      get: () => {
        if (html === undefined) {
          let inner = this.htmlCache.get(key);
          if (inner === undefined) {
            inner = sanitizeBlockHtml(pending ?? '', headingIds);
            this.counters.sanitized++;
            this.htmlCache.set(key, inner);
          } else {
            this.counters.cacheHits++;
          }
          pending = undefined;
          html = `<div class="wd-block" data-line="${line}" data-end-line="${endLine}" data-key="${key}">${inner}</div>`;
        }
        return html;
      },
    });
    return block;
  }
}

export function createMdxPipeline(options?: PipelineOptions): MdxPipeline {
  return new MdxPipeline(options);
}
