/**
 * What the Pandoc pack needs to know about the whole document before it renders any of it: the metadata of the title block, the numbers of the example list
 * items, and the abbreviation definitions; and which bibliography files to fetch.
 *
 * The context's `metadata` also carries two reserved keys of ours, `wd:title-block` ('mmd' in a
 * MultiMarkdown document) and `wd:abbreviations`; they are never shown.
 */

import { hashString } from '../../hash';
import type { ContextInputs, ContextNeeds, DocContext } from '../../types';
import { ABBREVIATIONS_KEY, collectAbbreviations } from './abbr';
import { collectExamples } from './examples';
import { parseTitleBlock, TITLE_BLOCK_KEY } from './title-block';

const MMD_PATH = /\.(?:mmd|multimarkdown)$/i;

/** The lines at the head of the source, enough to find a title block (not the whole document). */
function headLines(source: string): string[] {
  const lines: string[] = [];
  let offset = 0;
  while (lines.length < 5000 && offset <= source.length) {
    const stop = source.indexOf('\n', offset);
    const end = stop === -1 ? source.length : stop;
    const line = source.slice(offset, end).replace(/\r$/, '');
    lines.push(line);
    if (stop === -1) break;
    offset = stop + 1;
    if (lines.length > 1 && lines[0]?.startsWith('---') && /^(?:---|\.\.\.)[ \t]*$/.test(line))
      break;
    if (lines.length >= 200 && !lines[0]?.startsWith('---')) break;
  }
  return lines;
}

export function preparePandoc(source: string, inputs: ContextInputs): DocContext {
  const mmd = inputs.path !== null && MMD_PATH.test(inputs.path);
  const block = parseTitleBlock(headLines(source), mmd);
  const metadata: Record<string, unknown> = { ...(block?.data ?? {}) };
  if (mmd) metadata[TITLE_BLOCK_KEY] = 'mmd';

  const lines = source.split(/\r\n?|\n/);
  const abbreviations = collectAbbreviations(lines);
  const hasAbbreviations = Object.keys(abbreviations).length > 0;
  if (hasAbbreviations) metadata[ABBREVIATIONS_KEY] = abbreviations;
  const labels = collectExamples(lines);

  // Only what changes the output of a block that did not change itself.
  const signature = hashString(
    JSON.stringify([
      mmd,
      hasAbbreviations ? abbreviations : null,
      [...labels].map(([key, label]) => [key, label.number]),
    ]),
  );
  return {
    metadata,
    labels,
    // WP2.2b: the cited keys and the parsed bibliography (`inputs.bibliographies`).
    citationKeys: [],
    bibliography: null,
    vault: null,
    includes: new Map(),
    signature,
  };
}

const NO_NEEDS: ContextNeeds = { bibliographies: [], includes: [], vault: false, project: false };
let lastYaml = '';
let lastNeeds: ContextNeeds = NO_NEEDS;

/** The `bibliography` files named in the YAML block at the start of the document. */
export function needsPandoc(source: string): ContextNeeds {
  if (!source.startsWith('---')) return NO_NEEDS;
  const lines = headLines(source);
  const block = parseTitleBlock(lines, false);
  if (block?.kind !== 'yaml') return NO_NEEDS;
  const key = lines.slice(0, block.lines).join('\n');
  if (key === lastYaml) return lastNeeds;
  const value = block.data.bibliography;
  const items = Array.isArray(value) ? value : [value];
  const hrefs = items
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
  lastYaml = key;
  lastNeeds = hrefs.length === 0 ? NO_NEEDS : { ...NO_NEEDS, bibliographies: hrefs };
  return lastNeeds;
}
