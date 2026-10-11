#!/usr/bin/env node
/**
 * Generates the expected output for the Pandoc fixtures with the Pandoc inside RStudio: plain text (`-t plain --wrap=none`) and HTML
 * (`-t html`) for `tests/fixtures/flavors/pandoc/citations*.md` (with `--citeproc`) and
 * `tables.md`, into `tests/fixtures/flavors/pandoc/expected/`.
 *
 * Usage: node scripts/gen-pandoc-expected.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PANDOC =
  process.env.WD_PANDOC ??
  '/Applications/RStudio.app/Contents/Resources/app/quarto/bin/tools/aarch64/pandoc';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'tests/fixtures/flavors/pandoc');
const out = join(folder, 'expected');
mkdirSync(out, { recursive: true });

const version = spawnSync(PANDOC, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0];
if (!version.startsWith('pandoc 3.8.3')) {
  console.error(`Expected pandoc 3.8.3, found: ${version}`);
  process.exit(1);
}

// The fixtures of the folder, and the inputs this script owns in `expected/src` (extra cases the
// fixtures do not have: locators, entry types, more table forms). `bibliography: refs.bib` in
// those is relative to the folder because Pandoc runs there.
const files = [
  ...readdirSync(folder).filter((name) => /^citations.*\.md$/.test(name) || name === 'tables.md'),
  ...readdirSync(join(folder, 'expected/src')).map((name) => `expected/src/${name}`),
];

for (const name of files) {
  const text = readFileSync(join(folder, name), 'utf8');
  const citeproc = /^(?:bibliography|references|nocite):/m.test(text);
  const base = name.replace(/^expected\/src\//, '').replace(/\.md$/, '');
  for (const [format, extension, extra] of [
    ['plain', 'txt', ['--wrap=none']],
    ['html', 'html', []],
  ]) {
    const args = ['-f', 'markdown', '-t', format, ...extra];
    if (citeproc) args.push('--citeproc');
    args.push(name);
    const result = spawnSync(PANDOC, args, { cwd: folder, encoding: 'utf8' });
    if (result.status !== 0) {
      console.error(`pandoc failed on ${name}: ${result.stderr}`);
      process.exit(1);
    }
    writeFileSync(join(out, `${base}.${extension}`), result.stdout);
  }
  console.log(`generated ${base}`);
}
