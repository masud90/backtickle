/**
 * The block pipeline shared by every flavor pack: parse once, render each top-level block to its
 * own HTML, give it a key, and sanitize only what has not been seen before.
 *
 * - A block is the group of tokens between a top-level opening token and its closing token (or a
 *   single token such as a rule or a fence). The key is a hash of its raw HTML. Line numbers
 *   never enter the HTML of a block (inner elements carry their line relative to the block, see
 *   `lines.ts`), so a block that only moved down the document keeps its key.
 * - `RenderedBlock.html` is produced the first time it is read: sanitized, wrapped, and remembered
 *   under the key in a bounded cache. The preview reads the blocks it needs to show first, so a
 *   large document reaches the screen before the rest has been sanitized.
 * - Words and characters are counted per block and remembered by the prose text of the block, so
 *   an update only segments the text of the blocks that changed.
 * - A large source is parsed one window at a time (`windows.ts`): the tokens of a window are
 *   dropped as soon as its blocks are made, so they never exist for the whole document at once.
 */
import type { Env, MarkdownIt, Token } from 'markdown-it';
import type { CompletionData } from '@/editor/complete';
import type { FlavorId } from '@/flavors';
import { BoundedCache } from './cache';
import { collectGarbage } from './collect';
import { hashString } from './hash';
import { blockKeySuffix, registerCacheOwner } from './options';
import { fenceLanguage } from './rules/code';
import { createEnv, wdEnv } from './rules/env';
import { sanitizeBlockHtml } from './sanitize-block';
import type { Slugger } from './slug';
import { addStats, blockProse, countProse, EMPTY_STATS } from './stats';
import type {
  Analysis,
  ContextInputs,
  ContextNeeds,
  DocContext,
  DocStats,
  Heading,
  Pipeline,
  RenderedBlock,
  RenderResult,
} from './types';
import { type SourceWindow, splitSource } from './windows';

export interface PipelineOptions {
  /** Most characters of sanitized HTML kept for blocks that are not on screen. Default 6 million. */
  cacheChars?: number;
  /** Most blocks kept. Default 40,000. */
  cacheEntries?: number;
  /** Sources shorter than this many characters are parsed in one piece (see `windows.ts`). */
  windowMinChars?: number;
  /** A window of a larger source is cut at the first safe place after this many characters. */
  windowChars?: number;
  /** False: the pack parses the whole document in one piece (MDX). */
  windowing?: boolean;
  /** Extra places where a window must not start, see `splitSource`. */
  unsafeSplit?: (lines: readonly string[], index: number) => boolean;
  /** Pack hooks that feed the whole-document context. */
  needs?: (source: string) => ContextNeeds;
  prepare?: (source: string, inputs: ContextInputs) => DocContext;
  completions?: (context: DocContext) => CompletionData;
  /** Loads what `prepare` needs and cannot load itself (see `Pipeline.preload`). */
  preload?: (inputs: ContextInputs) => Promise<void> | undefined;
  /** A pack with its own heading ids (Pandoc) gives a new slugger for every document. */
  slugger?: () => Slugger;
}

/** What the pipeline did, for tests and measurements. */
export interface PipelineCounters {
  /** Blocks rendered to raw HTML. */
  rendered: number;
  /** Blocks that went through the sanitizer. */
  sanitized: number;
  /** Blocks whose sanitized HTML came from the cache. */
  cacheHits: number;
  /** Blocks whose words and characters were counted. */
  counted: number;
  /** Windows that were parsed (a source that is parsed in one piece is one window). */
  windows: number;
}

export interface EnginePipeline extends Pipeline {
  readonly counters: PipelineCounters;
  /** The raw HTML of the blocks, before sanitizing (conformance tests, debugging). */
  renderRaw(source: string, context?: DocContext): string;
  /** The prose of every top-level block that has any, in token order (tests, debugging). */
  proseBlocks(source: string): string[];
  /** Forgets everything remembered (the preview shows another document, or memory is needed). */
  clearCaches(): void;
}

interface Group {
  tokens: Token[];
  line: number;
  endLine: number;
}

/** One block of a window, as it is remembered: lines are relative to the window. */
interface WindowBlock {
  key: string;
  raw: string;
  headingIds: ReadonlySet<string> | null;
  line: number;
  endLine: number;
}

/**
 * What parsing one window gave, remembered by the hash of the text of the window. An update of a
 * large document changes one window, and the others are taken from here instead of being parsed
 * again. A window gives the same result for the same text if the ids of the headings before it
 * were the same, because heading ids are made unique over the whole document: `sigIn` says so.
 */
interface WindowEntry {
  /** Stands for the heading ids given before the window; `sigOut` for those after it. */
  sigIn: string;
  sigOut: string;
  /** The blocks (null if the window was only analyzed, which does not need them). */
  blocks: WindowBlock[] | null;
  /** The headings of the window, with lines relative to it. */
  headings: Heading[];
  hasH1: boolean;
  stats: DocStats;
  languages: string[];
  math: boolean;
}

interface Walk {
  env: Env;
  blocks: RenderedBlock[];
  stats: DocStats;
  languages: Set<string>;
  math: boolean;
}

/** HTML that can be made from tokens with different prose: see `BlockPipeline.statsOf`. */
const UNSHAREABLE =
  /<a |class="math |footnote-ref|task-checkbox|callout-title|class="critic|inline-chunk/;

/** Garbage is collected after this many characters have been parsed (see `collect.ts`). */
const COLLECT_AFTER_CHARS = 100_000;

/** Normalizes line endings the way markdown-it does, so line numbers agree with the parser. */
function normalizeSource(source: string): string {
  return source.includes('\r') ? source.replace(/\r\n?/g, '\n') : source;
}

/** Offsets of the start of every line. */
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

function isBlankLine(text: string, starts: readonly number[], index: number): boolean {
  const from = starts[index];
  if (from === undefined) return true;
  const to = (starts[index + 1] ?? text.length + 1) - 1;
  for (let i = from; i < to; i++) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x09) return false;
  }
  return true;
}

/** Cuts the tokens at the top level: one group per block. */
function splitTopLevel(tokens: readonly Token[]): Token[][] {
  const groups: Token[][] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    depth += tokens[i]?.nesting ?? 0;
    if (depth <= 0) {
      groups.push(tokens.slice(start, i + 1));
      start = i + 1;
      depth = 0;
    }
  }
  if (start < tokens.length) groups.push(tokens.slice(start));
  return groups;
}

export class BlockPipeline implements EnginePipeline {
  readonly flavor: FlavorId;
  readonly counters: PipelineCounters = {
    rendered: 0,
    sanitized: 0,
    cacheHits: 0,
    counted: 0,
    windows: 0,
  };
  private readonly md: MarkdownIt;
  private readonly htmlCache: BoundedCache<string>;
  private readonly windowOptions: {
    minChars?: number;
    windowChars?: number;
    unsafeSplit?: (lines: readonly string[], index: number) => boolean;
  };
  private readonly windowing: boolean;
  private readonly makeSlugger: (() => Slugger) | undefined;
  private windowCache = new Map<string, WindowEntry>();
  private readonly keyStats: BoundedCache<DocStats>;
  private readonly proseStats: BoundedCache<DocStats>;

  constructor(flavor: FlavorId, md: MarkdownIt, options: PipelineOptions = {}) {
    this.flavor = flavor;
    this.md = md;
    registerCacheOwner(this);
    this.windowOptions = {
      minChars: options.windowMinChars,
      windowChars: options.windowChars,
      unsafeSplit: options.unsafeSplit,
    };
    this.windowing = options.windowing !== false;
    this.makeSlugger = options.slugger;
    // The hooks exist only where the pack has them (GFM and CommonMark have none).
    if (options.needs) this.needs = options.needs;
    if (options.prepare) this.prepare = options.prepare;
    if (options.completions) this.completions = options.completions;
    if (options.preload) this.preload = options.preload;
    this.htmlCache = new BoundedCache<string>({
      maxEntries: options.cacheEntries ?? 40_000,
      maxSize: options.cacheChars ?? 6_000_000,
      sizeOf: (key, html) => key.length + html.length,
    });
    // Counts by block key: a block with the same HTML has the same prose (see `statsOf`).
    this.keyStats = new BoundedCache<DocStats>({
      maxEntries: 60_000,
      maxSize: Number.POSITIVE_INFINITY,
      sizeOf: () => 1,
    });
    // The numbers are tiny, but the prose text that serves as the key is not.
    this.proseStats = new BoundedCache<DocStats>({
      maxEntries: 40_000,
      maxSize: 4_000_000,
      sizeOf: (prose) => prose.length,
    });
  }

  declare needs?: (source: string) => ContextNeeds;
  declare prepare?: (source: string, inputs: ContextInputs) => DocContext;
  declare completions?: (context: DocContext) => CompletionData;
  declare preload?: (inputs: ContextInputs) => Promise<void> | undefined;

  clearCaches(): void {
    this.htmlCache.clear();
    this.keyStats.clear();
    this.proseStats.clear();
    this.windowCache = new Map();
  }

  analyze(source: string, context?: DocContext): Analysis {
    const { env, stats } = this.walk(normalizeSource(source), 'analyze', context ?? null);
    return this.analysisOf(env, stats);
  }

  render(source: string, context?: DocContext): RenderResult {
    const { env, blocks, stats, languages, math } = this.walk(
      normalizeSource(source),
      'render',
      context ?? null,
    );
    const analysis = this.analysisOf(env, stats);
    const features: RenderResult['features'] = { math, languages: [...languages].sort() };
    if (languages.has('mermaid')) features.mermaid = true;
    if (languages.has('dot') || languages.has('graphviz')) features.graphviz = true;
    return { ...analysis, blocks, features };
  }

  /**
   * The HTML markdown-it makes for the blocks of the document, before the sanitizer sees it: the
   * blocks one after the other, without wrappers. For the conformance tests and for debugging;
   * the preview never uses it.
   */
  renderRaw(source: string, context?: DocContext): string {
    const text = normalizeSource(source);
    const env = createEnv(this.makeSlugger);
    wdEnv(env).context = context ?? null;
    let html = '';
    for (const group of this.groupsOf(text, this.md.parse(text, env))) {
      html += this.renderGroup(group, env, new Set()).raw;
    }
    return html;
  }

  proseBlocks(source: string): string[] {
    const tokens = this.md.parse(normalizeSource(source), createEnv(this.makeSlugger));
    return splitTopLevel(tokens)
      .map((tokensOfBlock) => blockProse(tokensOfBlock))
      .filter((prose) => prose !== '');
  }

  // ---- internals --------------------------------------------------------------------------

  /** The source in windows of a size that keeps the tokens small (one window if it is short). */
  private windowsOf(text: string): SourceWindow[] {
    const windows = (this.windowing ? splitSource(text, this.windowOptions) : null) ?? [
      { text, line: 0 },
    ];
    this.counters.windows += windows.length;
    return windows;
  }

  /**
   * Goes through the windows of the source: a window that was seen before, with the same heading
   * ids before it, is taken from the window cache; any other is parsed, and its tokens are
   * dropped as soon as its blocks (or its counts, when only analyzing) are made.
   */
  private walk(text: string, mode: 'render' | 'analyze', context: DocContext | null): Walk {
    const windows = this.windowsOf(text);
    const env = createEnv(this.makeSlugger);
    const wd = wdEnv(env);
    wd.context = context;
    // The same text gives other blocks under another context (numbers, citations): not the same window.
    const contextSig = context?.signature ?? '';
    const blocks: RenderedBlock[] = [];
    const stats: DocStats = { words: 0, characters: 0, charactersNoSpaces: 0 };
    const languages = new Set<string>();
    let math = false;
    // The frontmatter header shows the title only if the document has no H1, which is known when
    // the last window is parsed: in a document of several windows its block is made at the end.
    let late: { index: number; group: Group; line: number } | undefined;
    const several = windows.length > 1;
    const nextCache = new Map<string, WindowEntry>();
    let sig = '';
    let sinceCollect = 0;

    for (const window of windows) {
      // The frontmatter makes the first window special: it is parsed every time.
      const cacheable = several && !window.text.startsWith('---');
      // The same text can come after different headings, and then it is not the same window.
      const isLast = window === windows[windows.length - 1];
      const hash = cacheable
        ? `${hashString(window.text)}|${sig}|${contextSig}|${isLast ? 'L' : ''}`
        : '';
      const known = cacheable ? this.windowCache.get(hash) : undefined;
      if (known && (mode === 'analyze' || known.blocks !== null)) {
        for (const heading of known.headings) {
          wd.slugger.replay(heading.text, heading.id);
          wd.headings.push({ ...heading, line: heading.line + window.line });
        }
        wd.hasH1 ||= known.hasH1;
        addStats(stats, known.stats);
        for (const name of known.languages) languages.add(name);
        math ||= known.math;
        for (const block of mode === 'render' ? (known.blocks ?? []) : []) {
          blocks.push(
            this.lazyBlock(
              block.key,
              block.raw,
              block.headingIds,
              block.line + window.line,
              block.endLine + window.line,
            ),
          );
        }
        nextCache.set(hash, known);
        sig = known.sigOut;
        continue;
      }

      wd.lineOffset = window.line;
      wd.lastWindow = isLast;
      const headingsBefore = wd.headings.length;
      // The tokens of the windows before this one are garbage by now: have them collected, so that
      // the garbage of the whole document never piles up (see `collect.ts`).
      if (sinceCollect >= COLLECT_AFTER_CHARS) {
        collectGarbage();
        sinceCollect = 0;
      }
      sinceCollect += window.text.length;
      const tokens = this.md.parse(window.text, env);
      const windowStats: DocStats = { words: 0, characters: 0, charactersNoSpaces: 0 };
      const windowLanguages = new Set<string>();
      const windowBlocks: WindowBlock[] = [];
      let windowMath = false;

      if (mode === 'analyze') {
        for (const tokensOfBlock of splitTopLevel(tokens)) {
          addStats(windowStats, this.proseOf(tokensOfBlock));
        }
      } else {
        for (const group of this.groupsOf(window.text, tokens)) {
          if (several && group.tokens[0]?.type === 'frontmatter') {
            late = { index: blocks.length, group, line: group.line + window.line };
            blocks.push(undefined as unknown as RenderedBlock);
            continue;
          }
          const { raw, headingIds, rawHtml } = this.renderGroup(group, env, windowLanguages);
          if (!windowMath && raw.includes('class="math ')) windowMath = true;
          const key = hashString(raw + blockKeySuffix());
          addStats(windowStats, this.statsOf(key, raw, rawHtml, group.tokens));
          windowBlocks.push({ key, raw, headingIds, line: group.line, endLine: group.endLine });
        }
        for (const block of windowBlocks) {
          blocks.push(
            this.lazyBlock(
              block.key,
              block.raw,
              block.headingIds,
              block.line + window.line,
              block.endLine + window.line,
            ),
          );
        }
      }

      addStats(stats, windowStats);
      for (const name of windowLanguages) languages.add(name);
      math ||= windowMath;
      const added = wd.headings.slice(headingsBefore);
      const sigOut =
        added.length === 0
          ? sig
          : hashString(`${sig}\u0001${added.map((heading) => heading.text).join('\u0002')}`);
      if (cacheable) {
        nextCache.set(hash, {
          sigIn: sig,
          sigOut,
          blocks: mode === 'render' ? windowBlocks : null,
          headings: added.map((heading) => ({ ...heading, line: heading.line - window.line })),
          hasH1: added.some((heading) => heading.level === 1),
          stats: windowStats,
          languages: [...windowLanguages],
          math: windowMath,
        });
      }
      sig = sigOut;
    }

    if (late) {
      const { group } = late;
      const { raw, headingIds, rawHtml } = this.renderGroup(group, env, languages);
      const key = hashString(raw + blockKeySuffix());
      blocks[late.index] = this.lazyBlock(key, raw, headingIds, late.line, group.endLine);
      addStats(stats, this.statsOf(key, raw, rawHtml, group.tokens));
    }

    // The tokens of the last window, or of a document that was parsed in one piece.
    if (sinceCollect >= COLLECT_AFTER_CHARS) collectGarbage();
    this.windowCache = nextCache;
    return { env, blocks, stats, languages, math };
  }

  private analysisOf(env: Env, stats: DocStats): Analysis {
    const wd = wdEnv(env);
    return { headings: wd.headings, stats, frontmatter: wd.frontmatter };
  }

  /** The top-level blocks of the token stream, each with its first and last source line. */
  private groupsOf(text: string, tokens: readonly Token[]): Group[] {
    const lineStarts = lineStartsOf(text);
    const lineCount = lineStarts.length;
    const isBlank = (index: number): boolean => isBlankLine(text, lineStarts, index);
    const groups: Group[] = [];
    let previousEnd = -1;
    for (const tokensOfBlock of splitTopLevel(tokens)) {
      const range = this.rangeOf(tokensOfBlock, previousEnd, lineCount, isBlank);
      previousEnd = range.endLine;
      groups.push({ tokens: tokensOfBlock, ...range });
    }
    return groups;
  }

  /** Renders one block to raw HTML, and notes its heading ids and code languages. */
  private renderGroup(
    group: Group,
    env: Env,
    languages: Set<string>,
  ): { raw: string; headingIds: Set<string> | null; rawHtml: boolean } {
    let headingIds: Set<string> | null = null;
    let rawHtml = false;
    for (const token of group.tokens) {
      if ((token.type === 'list_item_open' || token.type === 'tr_open') && token.map) {
        // The line of a list item or a table row, relative to its block (see `lines.ts`).
        token.attrSet('data-wd-rl', String(Math.max(0, token.map[0] - group.line)));
      } else if (token.type === 'heading_open') {
        const id = token.attrGet('id');
        if (typeof id === 'string') {
          headingIds ??= new Set();
          headingIds.add(id);
        }
      } else if (token.type === 'html_block') {
        rawHtml = true;
      } else if (token.type === 'fence') {
        const language = fenceLanguage(this.md, token.info).toLowerCase();
        if (language !== '') languages.add(language);
      }
    }
    wdEnv(env).blockStart = group.line;
    const raw = this.md.renderer.render(group.tokens, this.md.options, env);
    this.counters.rendered++;
    return { raw, headingIds, rawHtml };
  }

  /**
   * The counts of a block. Most blocks are counted once per key: the same HTML has the same prose.
   * The exceptions are blocks where the same HTML can come from different tokens with different
   * prose: raw HTML blocks (their text is not prose, the same markup written as Markdown is), links
   * (the text of an autolink is not prose, the same text in an ordinary link is), and the
   * generated pieces (math, footnote references, task boxes, alert titles) that a document could
   * imitate with raw HTML. Those are counted from their tokens, with the prose cache below.
   */
  private statsOf(key: string, raw: string, rawHtml: boolean, tokens: readonly Token[]): DocStats {
    const shareable = !rawHtml && !UNSHAREABLE.test(raw);
    if (shareable) {
      const known = this.keyStats.get(key);
      if (known) return known;
    }
    const counted = this.proseOf(tokens);
    if (shareable) this.keyStats.set(key, counted);
    return counted;
  }

  /** Words and characters of one block, from the cache when its prose was seen before. */
  private proseOf(tokens: readonly Token[]): DocStats {
    const prose = blockProse(tokens);
    if (prose === '') return EMPTY_STATS;
    let counted = this.proseStats.get(prose);
    if (!counted) {
      counted = countProse(prose);
      this.counters.counted++;
      this.proseStats.set(prose, counted);
    }
    return counted;
  }

  /** The first and last source line of a block (both included, trailing blank lines left out). */
  private rangeOf(
    tokens: readonly Token[],
    previousEnd: number,
    lineCount: number,
    isBlank: (index: number) => boolean,
  ): { line: number; endLine: number } {
    let first = Number.POSITIVE_INFINITY;
    let last = -1;
    const opener = tokens[0];
    if (opener?.map) {
      first = opener.map[0];
      last = opener.map[1] - 1;
    } else {
      // Blocks without a line of their own, such as the footnotes that markdown-it-footnote moves
      // to the end: the lines of the definitions they were made from.
      for (const token of tokens) {
        if (!token.map) continue;
        first = Math.min(first, token.map[0]);
        last = Math.max(last, token.map[1] - 1);
      }
    }
    if (last < 0 || first === Number.POSITIVE_INFINITY) {
      const line = Math.min(Math.max(previousEnd + 1, 0), Math.max(lineCount - 1, 0));
      return { line, endLine: line };
    }
    let end = Math.min(last, lineCount - 1);
    while (end > first && isBlank(end)) end--;
    return { line: first, endLine: Math.max(end, first) };
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
