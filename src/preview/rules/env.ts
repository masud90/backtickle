/**
 * What the rules of the preview share while one document is parsed and rendered. It lives in the
 * markdown-it `env` object under the key `wd`, a new one for every document.
 */
import type { Env } from 'markdown-it';
import { Slugger } from '../slug';
import type { DocContext, Heading } from '../types';

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  /** 0-based line of the opening `---`. */
  line: number;
  /** 0-based line of the closing delimiter. */
  endLine: number;
}

export interface WdEnv {
  headings: Heading[];
  /** True when the document has a Markdown heading of level 1. */
  hasH1: boolean;
  slugger: Slugger;
  frontmatter: ParsedFrontmatter | null;
  /**
   * First source line of the block that is being rendered (set by the engine before each), in
   * the lines of the window that is being parsed.
   */
  blockStart: number;
  /**
   * The line of the document where the window that is being parsed starts (0 for a document that
   * is parsed in one piece). The lines of the tokens are relative to the window.
   */
  lineOffset: number;
  /** True while the last window of the document (or the whole document) is being parsed. */
  lastWindow: boolean;
  /** The whole-document context the shell gave the pipeline (packs only), or null. */
  context: DocContext | null;
}

export function createWdEnv(slugger?: () => Slugger): WdEnv {
  return {
    headings: [],
    hasH1: false,
    slugger: slugger ? slugger() : new Slugger(),
    frontmatter: null,
    blockStart: 0,
    lineOffset: 0,
    lastWindow: true,
    context: null,
  };
}

/** A new `env` for one document. A pack with its own heading ids gives its slugger. */
export function createEnv(slugger?: () => Slugger): Env {
  return { wd: createWdEnv(slugger) };
}

/** The shared state in `env`, created on first use so the rules also work with a plain `{}`. */
export function wdEnv(env: Env | undefined): WdEnv {
  if (!env) return createWdEnv();
  const existing = env.wd as WdEnv | undefined;
  if (existing) return existing;
  const created = createWdEnv();
  env.wd = created;
  return created;
}
