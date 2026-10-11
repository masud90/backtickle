/**
 * The six Markdown flavors, their menu data, and how the flavor of a document is chosen
 *.
 *
 * This module is small and has no dependencies, so the shell can import it at startup. The
 * renderers live in `src/preview` and load lazily.
 */

export type FlavorId = 'commonmark' | 'gfm' | 'obsidian' | 'pandoc' | 'quarto' | 'mdx';

export interface FlavorInfo {
  id: FlavorId;
  /** Menu label. */
  label: string;
  /** Pill label. */
  short: string;
  /** Lower-case, without the dot. */
  extensions: string[];
  /** False until Phase 2 implements the flavor. */
  available: boolean;
  /** What is actually rendered: the flavor itself if it is available, otherwise 'gfm'. */
  renderAs: FlavorId;
}

/** The flavors in menu order. */
export const FLAVORS: readonly FlavorInfo[] = [
  {
    id: 'commonmark',
    label: 'CommonMark',
    short: 'CommonMark',
    extensions: [],
    available: true,
    renderAs: 'commonmark',
  },
  {
    id: 'gfm',
    label: 'GitHub Flavored Markdown (GFM)',
    short: 'GFM',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'],
    available: true,
    renderAs: 'gfm',
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    short: 'Obsidian',
    extensions: [],
    available: true,
    renderAs: 'obsidian',
  },
  {
    id: 'pandoc',
    label: 'Pandoc / MMD',
    short: 'Pandoc / MMD',
    extensions: ['mmd'],
    available: true,
    renderAs: 'pandoc',
  },
  {
    id: 'quarto',
    label: 'Quarto / RMD',
    short: 'Quarto / RMD',
    extensions: ['qmd', 'rmd'],
    available: true,
    renderAs: 'quarto',
  },
  {
    id: 'mdx',
    label: 'MDX',
    short: 'MDX',
    extensions: ['mdx'],
    available: true,
    renderAs: 'mdx',
  },
];

const BY_ID = new Map<string, FlavorInfo>(FLAVORS.map((info) => [info.id, info]));

export function isFlavorId(value: unknown): value is FlavorId {
  return typeof value === 'string' && BY_ID.has(value);
}

/** The table row of a flavor. */
export function flavorInfo(id: FlavorId): FlavorInfo {
  const info = BY_ID.get(id);
  if (!info) throw new Error(`Unknown flavor: ${id}`);
  return info;
}

/** The text of the pill for a flavor that cannot be rendered yet, shown instead of a version. */
export const RENDERS_AS_GFM_NOTE = 'Renders as GFM for now';

// ---- detection -----------------------------------------------------------------------------

export type FlavorReason = 'chosen' | 'extension' | 'vault' | 'frontmatter' | 'default';

export interface FlavorInput {
  /** null for an untitled document. */
  path: string | null;
  /** Only the first 4 KB are inspected. */
  text: string;
  /** The per-file choice made from the pill. */
  chosen: FlavorId | null;
  /** settings.defaultFlavor. */
  defaultFlavor: FlavorId;
  /** From platform.documentContext. */
  inObsidianVault: boolean;
  /**
   * settings.preview.autoDetectFlavor, true when absent. Off: only the per-file choice, the
   * extension and the default are used (no vault or frontmatter rule).
   */
  autoDetect?: boolean;
}

export interface FlavorDetection {
  flavor: FlavorId;
  reason: FlavorReason;
}

/** How much of the text is looked at for frontmatter hints. */
export const DETECTION_WINDOW = 4096;

/** The extensions of the Markdown family (those of GFM): a vault makes these Obsidian. */
const MARKDOWN_EXTENSIONS = new Set(flavorInfo('gfm').extensions);

/** Extensions that decide the flavor by themselves: every flavor except GFM lists some. */
const EXTENSION_FLAVOR = new Map<string, FlavorId>(
  FLAVORS.filter((info) => info.id !== 'gfm').flatMap((info) =>
    info.extensions.map((extension) => [extension, info.id] as const),
  ),
);

/** Top-level frontmatter keys that suggest a flavor. */
const PANDOC_KEYS = new Set(['bibliography', 'csl', 'link-citations']);
const QUARTO_KEYS = new Set(['format', 'execute', 'output']);

/** The lower-case extension of a path, without the dot, or '' (also for a hidden file like `.md`). */
export function fileExtension(path: string | null): string {
  if (!path) return '';
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

const FRONTMATTER_OPEN = /^---[ \t]*$/;
const FRONTMATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;
/** A top-level YAML key: no indentation, plain or quoted, followed by a colon. */
const TOP_LEVEL_KEY = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.-]*))[ \t]*:(?:[ \t]|$)/;

/**
 * The flavor that the top-level keys of a leading YAML block suggest, if any. The block must be
 * closed inside the inspected window. Quarto wins over Pandoc when both kinds of key appear,
 * because Quarto builds on Pandoc (a Quarto document may well have a bibliography).
 */
export function frontmatterHint(text: string): 'pandoc' | 'quarto' | null {
  const lines = text.slice(0, DETECTION_WINDOW).split(/\r\n|\r|\n/);
  if (lines[0]?.charCodeAt(0) === 0xfeff) lines[0] = lines[0].slice(1);
  if (!FRONTMATTER_OPEN.test(lines[0] ?? '')) return null;

  let pandoc = false;
  let quarto = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FRONTMATTER_CLOSE.test(line)) {
      if (quarto) return 'quarto';
      return pandoc ? 'pandoc' : null;
    }
    const match = TOP_LEVEL_KEY.exec(line);
    const key = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
    if (key === undefined) continue;
    if (QUARTO_KEYS.has(key)) quarto = true;
    else if (PANDOC_KEYS.has(key)) pandoc = true;
  }
  return null; // not closed within the window: not frontmatter
}

/**
 * Chooses the flavor of a document. First match wins:
 * 1. the per-file choice; 2. the extension (`mdx`, `qmd`, `rmd`, `mmd`); 3. an Obsidian vault,
 * for Markdown extensions; 4. frontmatter hints; 5. the default. Steps 3 and 4 are skipped when
 * `autoDetect` is false.
 */
export function detectFlavor(input: FlavorInput): FlavorDetection {
  if (input.chosen) return { flavor: input.chosen, reason: 'chosen' };

  const extension = fileExtension(input.path);
  const byExtension = EXTENSION_FLAVOR.get(extension);
  if (byExtension) return { flavor: byExtension, reason: 'extension' };

  if (input.autoDetect === false) return { flavor: input.defaultFlavor, reason: 'default' };

  if (input.inObsidianVault && MARKDOWN_EXTENSIONS.has(extension)) {
    return { flavor: 'obsidian', reason: 'vault' };
  }

  const hint = frontmatterHint(input.text);
  if (hint) return { flavor: hint, reason: 'frontmatter' };

  return { flavor: input.defaultFlavor, reason: 'default' };
}
