#!/usr/bin/env node
// Generates a large synthetic folder of Markdown files for search and file-tree measurements.
//
//   node scripts/gen-folder.mjs [--n 2000] [--out tests/fixtures/generated]
//
// Writes <out>/folder-<n>/ with n Markdown files of about 5 KB each, in folders of 50 files
// (n/50 folders, 40 for the default 2,000), two levels: group-XX/dir-YY/file-NNNN.md. The word
// "lantern" lands in about 1% of the prose lines. Prints the file count, total bytes and the
// number of lantern lines.
//
// Deterministic: a seeded PRNG and integer-only choices, so the same bytes come out on every
// run and machine. Synthetic lorem-style text only; there is no real data in it.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

function parseArgs(argv) {
  const opts = { n: 2000, out: join(repoRoot, 'tests', 'fixtures', 'generated') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--n') opts.n = Number.parseInt(argv[++i], 10);
    else if (argv[i] === '--out') opts.out = resolve(argv[++i]);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!Number.isInteger(opts.n) || opts.n < 1) throw new Error('--n must be a positive integer');
  return opts;
}

// mulberry32, integer arithmetic only
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  'amber breeze candle drift ember field garden harbor island juniper kettle meadow nectar ' +
  'orchard pebble quiet river saddle thistle umber valley willow yarrow zephyr bridge copper ' +
  'dawn fern glade hollow ivory jasmine knoll lagoon marsh north oasis pine quartz reed slate'
).split(' ');

const { n, out } = parseArgs(process.argv.slice(2));
const root = join(out, `folder-${n}`);
rmSync(root, { recursive: true, force: true });

const rand = rng(20261008);
const pick = (list) => list[Math.floor(rand() * list.length)];
let totalBytes = 0;
let lanternLines = 0;

for (let i = 0; i < n; i++) {
  const folder = Math.floor(i / 50);
  const group = String(Math.floor(folder / 5)).padStart(2, '0');
  const dir = String(folder % 5).padStart(2, '0');
  const lines = [`# Note ${i}`, ''];
  let size = lines.join('\n').length;
  while (size < 5000) {
    const count = 8 + Math.floor(rand() * 8);
    const words = [];
    for (let k = 0; k < count; k++) words.push(pick(WORDS));
    // 1 in 100 lines carries the search word
    if (Math.floor(rand() * 100) === 0) {
      words[Math.floor(rand() * count)] = 'lantern';
      lanternLines++;
    }
    const line = words.join(' ') + '.';
    lines.push(line, '');
    size += line.length + 2;
  }
  const dirPath = join(root, `group-${group}`, `dir-${dir}`);
  mkdirSync(dirPath, { recursive: true });
  const text = lines.join('\n');
  writeFileSync(join(dirPath, `file-${String(i).padStart(4, '0')}.md`), text);
  totalBytes += Buffer.byteLength(text);
}

console.log(`${root}\nfiles: ${n}\nbytes: ${totalBytes}\nlantern lines: ${lanternLines}`);
