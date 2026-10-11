/**
 * Fidelity harness: Writedown's pipeline, Pandoc 3.8.3 and Quarto 1.9.38 (both inside RStudio)
 * render the same fixture; `extract` reduces each HTML to the structure that is compared
 *.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createPandocPipeline } from '@/preview/packs/pandoc';
import { createQuartoPipeline } from '@/preview/packs/quarto';
import type { ContextInputs, EnginePipelineLike } from './types';

const BIN = '/Applications/RStudio.app/Contents/Resources/app/quarto/bin';
export const QUARTO = `${BIN}/quarto`;
export const PANDOC = `${BIN}/tools/aarch64/pandoc`;
export const HAVE_TOOLS = existsSync(QUARTO) && existsSync(PANDOC);

export const ROOT = resolve(__dirname, '../..');
export const FLAVORS = join(ROOT, 'tests/fixtures/flavors');

// ---- Writedown --------------------------------------------------------------------------------

function nearestProject(path: string): { path: string; text: string } | null {
  let folder = dirname(path);
  while (folder.startsWith(FLAVORS)) {
    const candidate = join(folder, '_quarto.yml');
    if (existsSync(candidate)) return { path: candidate, text: readFileSync(candidate, 'utf8') };
    folder = dirname(folder);
  }
  return null;
}

/** What the shell would fetch for a document, fetched the same way, until nothing new is named. */
export async function fetchInputs(
  pipeline: EnginePipelineLike,
  source: string,
  path: string,
  quarto: boolean,
): Promise<ContextInputs> {
  const inputs: ContextInputs = {
    path,
    bibliographies: [],
    includes: new Map(),
    vault: null,
    project: quarto ? nearestProject(path) : null,
  };
  const folder = dirname(path);
  // prepare() remembers what the project and the included files name, so it runs between rounds.
  pipeline.prepare?.(source, inputs);
  for (let round = 0; round < 8; round++) {
    const needs = pipeline.needs?.(source);
    if (!needs) break;
    let changed = false;
    for (const href of needs.bibliographies) {
      if (inputs.bibliographies.some((file) => file.href === href)) continue;
      const full = resolve(folder, href);
      if (!existsSync(full)) continue;
      inputs.bibliographies.push({ href, path: full, text: readFileSync(full, 'utf8') });
      changed = true;
    }
    for (const href of needs.includes) {
      if (inputs.includes.has(href)) continue;
      const full = resolve(folder, href);
      inputs.includes.set(
        href,
        existsSync(full) ? { path: full, text: readFileSync(full, 'utf8') } : null,
      );
      changed = true;
    }
    // prepare() remembers what the included files name (nesting), so run it between rounds.
    await pipeline.preload?.(inputs);
    pipeline.prepare?.(source, inputs);
    if (!changed) break;
  }
  await pipeline.preload?.(inputs);
  return inputs;
}

export async function renderOurs(path: string, flavor: 'pandoc' | 'quarto'): Promise<string> {
  const source = readFileSync(path, 'utf8');
  const pipeline = (
    flavor === 'pandoc' ? createPandocPipeline() : createQuartoPipeline()
  ) as EnginePipelineLike;
  const inputs = await fetchInputs(pipeline, source, path, flavor === 'quarto');
  const context = pipeline.prepare?.(source, inputs);
  const result = pipeline.render(source, context);
  return result.blocks.map((block) => block.html).join('\n');
}

// ---- Pandoc -----------------------------------------------------------------------------------

export function renderPandoc(path: string): string {
  const text = readFileSync(path, 'utf8');
  return execFileSync(
    PANDOC,
    [
      '-f',
      /\.mmd$/.test(path) ? 'markdown_mmd' : 'markdown',
      '-t',
      'html',
      '-s',
      '--citeproc',
      '--wrap=none',
    ],
    { input: text, encoding: 'utf8', cwd: dirname(path), maxBuffer: 64 * 1024 * 1024 },
  );
}

// ---- Quarto (never executes code) ---------------------------------------------------------------

/** A temporary copy of the flavors fixtures: nothing is rendered in the repository. */
export function makeSandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wd-fidelity-'));
  cpSync(FLAVORS, join(dir, 'flavors'), { recursive: true });
  return dir;
}

/** The source with `engine: markdown` in its YAML (a block is added when there is none). */
export function withMarkdownEngine(text: string): string {
  const match = /^---\r?\n/.exec(text);
  if (match) return `${match[0]}engine: markdown\n${text.slice(match[0].length)}`;
  return `---\nengine: markdown\n---\n\n${text}`;
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export interface QuartoRun {
  html: string | null;
  error: string | null;
}

/**
 * Renders `relative` (a path inside the sandbox's `flavors` copy) with Quarto, the markdown
 * engine forced, so no R, Python or Julia can start.
 */
export function renderQuarto(sandbox: string, relative: string): QuartoRun {
  const file = join(sandbox, 'flavors', relative);
  const original = readFileSync(file, 'utf8');
  // An .Rmd would start knitr: the copy is a .qmd with the same content, engine forced.
  const isRmd = /\.rmd$/i.test(file);
  const target = isRmd ? file.replace(/\.rmd$/i, '.rmd.qmd') : file;
  writeFileSync(target, withMarkdownEngine(original));
  const out = target.replace(/\.qmd$/, '.html');
  try {
    execFileSync(QUARTO, ['render', target, '--to', 'html', '--quiet'], {
      cwd: dirname(target),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (error) {
    const e = error as { stderr?: string; message: string };
    return { html: null, error: (e.stderr || e.message).trim().split('\n').slice(-3).join(' | ') };
  }
  return { html: readFileSync(out, 'utf8'), error: null };
}
