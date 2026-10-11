#!/usr/bin/env node
// Generates large synthetic Markdown documents for the measurement harness.
//
//   node scripts/gen-large-doc.mjs --size 100k|1m|5m|all [--out tests/fixtures/generated]
//
// Writes large-100k.md, large-1m.md and large-5m.md. Sizes are binary: 100k is 100 KiB (102,400
// bytes), 1m is 1 MiB and 5m is 5 MiB, the same unit as the memory figures of the harness. The
// size lands within 2% of the target (in practice 0 to 1% over).
//
// Deterministic: a seeded PRNG and integer-only choices, so the same bytes come out on every run
// and machine. The SHA-256 of each file is printed.
//
// Synthetic text only: lorem-style words and made-up code. There is no real data in it.
//
// Content mix, by lines: about 70% prose paragraphs, wrapped at 80 columns, with some **bold**,
// *italic*, `inline code` and [links](https://example.org). A heading (H1 to H3) every 30 to 50
// lines, a GFM table about every 200 lines, a fenced code block about every 150 lines (js,
// python, r, sql in turn), and between those bullet and numbered lists, blockquotes and task
// lists. Block spacing counts every line, blank ones included. The prose share and the measured
// spacing of each file are printed, so the claims can be checked.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..');
export const defaultOutDir = join(repoRoot, 'tests', 'fixtures', 'generated');

export const DOC_SIZES = {
  '100k': { bytes: 100 * 1024, file: 'large-100k.md', label: '100 KiB' },
  '1m': { bytes: 1024 * 1024, file: 'large-1m.md', label: '1 MiB' },
  '5m': { bytes: 5 * 1024 * 1024, file: 'large-5m.md', label: '5 MiB' },
};

const TOLERANCE = 0.02;
const SEED = 20261004;
const WRAP_COLUMNS = 80;

// ---------- seeded random numbers (mulberry32) ----------

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- vocabulary ----------

const WORDS = (
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut ' +
  'labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris ' +
  'nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse ' +
  'cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui ' +
  'officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus gravida orci a ' +
  'odio nullam varius turpis commodo pharetra eros bibendum sapien morbi vel nunc facilisis porta ' +
  'felis vivamus luctus urna sed augue mauris blandit aliquet pellentesque habitant senectus ' +
  'netus fames ac egestas vestibulum tortor quam feugiat vitae ultricies leo integer malesuada ' +
  'fringilla suspendisse potenti donec rutrum congue fermentum dictum mi arcu cursus euismod ' +
  'nibh praesent elementum facilisi sollicitudin nec tellus maecenas ornare lectus magna'
).split(' ');

const NAME_A = [
  'parse',
  'render',
  'load',
  'scan',
  'merge',
  'flush',
  'emit',
  'bind',
  'patch',
  'fetch',
  'count',
  'build',
  'check',
  'split',
  'join',
  'apply',
];
const NAME_B = [
  'frame',
  'block',
  'index',
  'cache',
  'node',
  'batch',
  'token',
  'queue',
  'state',
  'item',
  'chunk',
  'table',
  'field',
  'value',
  'group',
  'label',
];
const ARGS = ['a', 'b', 'x', 'y', 'n', 'k', 'rows', 'items', 'values', 'text'];

/** Relative share of each kind of block in the "free" slots between the scheduled blocks. */
const FREE_BLOCK_WEIGHTS = [
  ['prose', 88],
  ['bullets', 4],
  ['numbers', 3],
  ['quote', 3],
  ['tasks', 2],
];

/**
 * Lines to wait after a heading, table or code block before the next one is due. The next block
 * boundary after that decides the exact spot, and the block itself adds length, so the measured
 * spacing is a little larger than these gaps (it is printed by the command line tool).
 */
const GAPS = { heading: [28, 42], table: [158, 218], code: [106, 156] };

// ---------- generator ----------

function makeRandom(seed) {
  const next = mulberry32(seed);
  const int = (n) => Math.floor(next() * n);
  return {
    int,
    range: (low, high) => low + int(high - low + 1),
    chance: (p) => next() < p,
    pick: (list) => list[int(list.length)],
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Greedy word wrap at `columns`. Every space that becomes a line break keeps the byte count. */
function wrap(text, columns = WRAP_COLUMNS, prefix = '') {
  const lines = [];
  let line = prefix;
  let empty = true;
  for (const word of text.split(' ')) {
    if (!empty && line.length + 1 + word.length > columns) {
      lines.push(line);
      line = prefix + word;
    } else {
      line += (empty ? '' : ' ') + word;
    }
    empty = false;
  }
  lines.push(line);
  return lines;
}

function buildDocument(sizeKey) {
  const target = DOC_SIZES[sizeKey]?.bytes;
  if (!target) throw new Error(`Unknown size "${sizeKey}". Use 100k, 1m or 5m.`);

  const r = makeRandom(SEED);
  const word = () => r.pick(WORDS);
  const ident = () => `${r.pick(NAME_A)}_${r.pick(NAME_B)}`;
  const camel = () => `${r.pick(NAME_A)}${capitalize(r.pick(NAME_B))}`;
  const small = () => r.range(2, 9);
  const tens = () => r.range(1, 9) * 10;
  const comment = () => Array.from({ length: r.range(3, 7) }, word).join(' ');
  const link = () => `https://example.org/${r.pick(NAME_B)}-${r.int(100)}`;

  /** `count` words, with the occasional inline markup. */
  const phrase = (low, high, markup = 0.5) => {
    const words = Array.from({ length: r.range(low, high) }, word);
    if (!r.chance(markup)) return words.join(' ');
    const span = (min, max) => {
      const length = Math.min(words.length, r.range(min, max));
      const start = r.int(words.length - length + 1);
      return [start, length];
    };
    const kind = r.int(100);
    if (kind < 30) {
      const [start, length] = span(1, 3);
      words.splice(start, length, `**${words.slice(start, start + length).join(' ')}**`);
    } else if (kind < 55) {
      const [start, length] = span(1, 3);
      words.splice(start, length, `*${words.slice(start, start + length).join(' ')}*`);
    } else if (kind < 80) {
      words.splice(r.int(words.length), 1, `\`${r.chance(0.5) ? ident() : `${camel()}()`}\``);
    } else {
      const [start, length] = span(1, 3);
      const text = words.slice(start, start + length).join(' ');
      words.splice(start, length, `[${text}](${link()})`);
    }
    return words.join(' ');
  };

  const sentence = () => {
    let length = r.range(4, 11);
    if (r.chance(0.35)) length += r.range(0, 10);
    if (r.chance(0.1)) length += r.range(0, 8);
    const body = phrase(length, length, 0.28);
    const stop = r.int(20) === 0 ? '?' : r.int(25) === 0 ? '!' : '.';
    return capitalize(body) + stop;
  };

  const paragraph = (sentences) => {
    const count = sentences ?? r.range(2, 7);
    return wrap(Array.from({ length: count }, sentence).join(' '));
  };

  // ----- blocks: each returns an array of lines without the blank line that follows it -----

  const heading = (level) => [
    `${'#'.repeat(level)} ${phrase(2, 6, 0).split(' ').map(capitalize).join(' ')}`,
  ];

  const bullets = () => {
    const lines = [];
    for (let i = r.range(3, 8); i > 0; i--) {
      lines.push(`- ${capitalize(phrase(5, 16, 0.35))}${r.chance(0.5) ? '.' : ''}`);
      if (r.chance(0.12)) {
        for (let j = r.range(1, 3); j > 0; j--) lines.push(`  - ${phrase(3, 9, 0.2)}`);
      }
    }
    return lines;
  };

  const numbers = () => {
    const count = r.range(3, 8);
    return Array.from(
      { length: count },
      (_, i) => `${i + 1}. ${capitalize(phrase(5, 16, 0.35))}${r.chance(0.5) ? '.' : ''}`,
    );
  };

  const tasks = () =>
    Array.from(
      { length: r.range(3, 5) },
      () => `- [${r.chance(0.4) ? 'x' : ' '}] ${capitalize(phrase(4, 11, 0.2))}`,
    );

  const quote = () => {
    const lines = [];
    if (r.chance(0.15)) lines.push(`> [!${r.pick(['NOTE', 'TIP', 'WARNING'])}]`);
    lines.push(...wrap(Array.from({ length: r.range(1, 2) }, sentence).join(' '), 78, '> '));
    return lines;
  };

  const table = () => {
    const columns = r.range(3, 5);
    const kinds = Array.from({ length: columns }, (_, i) =>
      i === 0 ? 'text' : r.pick(['int', 'dec', 'text', 'code']),
    );
    const cell = (kind) => {
      if (kind === 'int') return String(r.int(10000));
      if (kind === 'dec') return `${r.int(1000)}.${String(r.int(100)).padStart(2, '0')}`;
      if (kind === 'code') return `\`${ident()}\``;
      return Array.from({ length: r.range(1, 3) }, word).join(' ');
    };
    const header = Array.from({ length: columns }, () => capitalize(word()));
    const align = Array.from({ length: columns }, () => r.pick([':---', '---:', ':---:', '---']));
    const lines = [`| ${header.join(' | ')} |`, `| ${align.join(' | ')} |`];
    for (let i = r.range(4, 10); i > 0; i--) lines.push(`| ${kinds.map(cell).join(' | ')} |`);
    return lines;
  };

  const codeUnits = {
    js: [
      () => [`const ${ident()} = ${camel()}(${r.pick(ARGS)}, ${r.int(1000)});`],
      () => [`const ${ident()} = ${r.pick(ARGS)}.map((v) => v * ${small()}).filter(Boolean);`],
      () => [`console.log('${r.pick(NAME_B)}-${r.int(100)}', ${ident()});`],
      () => {
        const [a, b] = [r.pick(ARGS), r.pick(ARGS)];
        return [
          `function ${camel()}(${a}, ${b}) {`,
          `  const total = ${a} + ${b} * ${small()};`,
          '  return total;',
          '}',
        ];
      },
      () => [`// ${comment()}`],
      () => {
        const v = r.pick(NAME_B);
        return [`for (const ${v} of ${r.pick(ARGS)}) {`, `  ${camel()}(${v});`, '}'];
      },
      () => [
        `export const ${ident()} = { ${r.pick(ARGS)}: ${r.int(100)}, ${r.pick(ARGS)}: ${r.int(100)} };`,
      ],
    ],
    python: [
      () => [`${ident()} = [i * ${small()} for i in range(${tens()})]`],
      () => {
        const [a, b] = [r.pick(ARGS), r.pick(ARGS)];
        return [
          `def ${ident()}(${a}, ${b}):`,
          `    total = ${a} + ${b} * ${small()}`,
          '    return total',
        ];
      },
      () => [`print('${r.pick(NAME_B)}-${r.int(100)}', ${ident()})`],
      () => [`# ${comment()}`],
      () => ['for item in items:', `    ${ident()}(item)`],
      () => [`import ${r.pick(['os', 'sys', 'json', 'math', 'csv'])}`],
    ],
    r: [
      () => [`${ident()} <- data.frame(id = 1:${tens()}, value = rnorm(${tens()}))`],
      () => [`fit <- lm(value ~ id, data = ${ident()})`],
      () => ['summary(fit)'],
      () => [`${ident()} <- aggregate(value ~ group, data = ${ident()}, FUN = mean)`],
      () => [`# ${comment()}`],
      () => [`library(${r.pick(['dplyr', 'ggplot2', 'tidyr', 'readr', 'stringr'])})`],
      () => ['ggplot(df, aes(x = id, y = value)) + geom_line()'],
    ],
    sql: [
      () => [
        `SELECT ${r.pick(NAME_B)}, COUNT(*) AS n`,
        `FROM ${r.pick(NAME_A)}_${r.pick(NAME_B)}`,
        `WHERE ${r.pick(NAME_B)} > ${small()}`,
        `GROUP BY ${r.pick(NAME_B)}`,
        'ORDER BY n DESC;',
      ],
      () => [`SELECT ${r.pick(NAME_B)}, ${r.pick(NAME_B)} FROM ${ident()} LIMIT ${tens()};`],
      () => [`-- ${comment()}`],
      () => [
        `CREATE TABLE ${ident()} (id INTEGER PRIMARY KEY, ${r.pick(NAME_B)} TEXT, ${r.pick(NAME_B)} REAL);`,
      ],
      () => [`UPDATE ${ident()} SET ${r.pick(NAME_B)} = ${small()} WHERE id = ${r.int(1000)};`],
    ],
  };
  const codeLanguages = ['js', 'python', 'r', 'sql'];
  let codeBlocks = 0;
  const code = () => {
    const language = codeLanguages[codeBlocks++ % codeLanguages.length];
    const lines = [];
    const wanted = r.range(6, 18);
    while (lines.length < wanted) lines.push(...r.pick(codeUnits[language])());
    return [`\`\`\`${language}`, ...lines, '```'];
  };

  // ----- assembly -----

  const out = [];
  const composition = {};
  let bytes = 0;
  let lineCount = 0;
  let sinceHeading = 0;
  let sinceTable = 0;
  let sinceCode = 0;
  const gap = (kind) => r.range(...GAPS[kind]);
  let headingGap = gap('heading');
  let tableGap = gap('table');
  let codeGap = gap('code');
  const starts = { heading: [], table: [], code: [] };

  const emit = (type, lines) => {
    starts[type]?.push(lineCount);
    for (const line of lines) {
      out.push(line);
      bytes += line.length + 1;
    }
    out.push('');
    bytes += 1;
    const used = lines.length + 1;
    lineCount += used;
    sinceHeading += used;
    sinceTable += used;
    sinceCode += used;
    composition[type] ??= { blocks: 0, lines: 0, textLines: 0 };
    const entry = composition[type];
    entry.blocks += 1;
    entry.lines += used;
    entry.textLines += lines.length;
  };

  emit('heading', [`# Synthetic test document (${DOC_SIZES[sizeKey].label})`]);
  emit('quote', [
    '> Generated by scripts/gen-large-doc.mjs with a fixed seed. Synthetic text only: it contains',
    '> no real data.',
  ]);
  sinceHeading = 0;

  const totalWeight = FREE_BLOCK_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
  const freeBlock = () => {
    let roll = r.int(totalWeight);
    for (const [type, weight] of FREE_BLOCK_WEIGHTS) {
      if (roll < weight) return type;
      roll -= weight;
    }
    return 'prose';
  };

  const tail = target - 3000;
  while (bytes < target) {
    if (bytes >= tail) {
      emit('prose', paragraph(r.range(2, 4)));
      continue;
    }
    // Choose the next block, then decide whether a heading has to come before it. Tables and code
    // blocks wait for their turn; everything else is drawn by weight.
    let next;
    if (sinceTable >= tableGap) {
      next = { type: 'table', lines: table() };
    } else if (sinceCode >= codeGap) {
      next = { type: 'code', lines: code() };
    } else {
      const type = freeBlock();
      const build = { prose: paragraph, bullets, numbers, quote, tasks }[type];
      next = { type, lines: build() };
    }
    // A heading is due after its gap, or earlier if this block would push the spacing past the
    // upper limit (50 lines from heading to heading, counting the heading and its blank line).
    const length = next.lines.length + 1;
    if (
      sinceHeading >= headingGap ||
      (sinceHeading >= GAPS.heading[0] && sinceHeading + length > 48)
    ) {
      const level = r.int(100) < 12 ? 1 : r.int(100) < 45 ? 2 : 3;
      emit('heading', heading(level));
      sinceHeading = 0;
      headingGap = gap('heading');
    }
    emit(next.type, next.lines);
    if (next.type === 'table') {
      sinceTable = 0;
      tableGap = gap('table');
    } else if (next.type === 'code') {
      sinceCode = 0;
      codeGap = gap('code');
    }
  }

  // Drop the final blank line, so the file ends with exactly one newline.
  out.pop();
  const text = `${out.join('\n')}\n`;
  const size = Buffer.byteLength(text, 'utf8');
  return { text, bytes: size, target, lines: lineCount - 1, composition, starts };
}

// ---------- files ----------

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Spacing, in lines, between consecutive blocks of one kind: median, minimum, maximum. */
function spacing(starts) {
  const gaps = starts
    .slice(1)
    .map((start, i) => start - starts[i])
    .sort((a, b) => a - b);
  if (gaps.length === 0) return null;
  const middle = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  return { n: gaps.length, median, min: gaps[0], max: gaps[gaps.length - 1] };
}

/** Composition as percentages of all lines and of non-blank lines. */
export function describeComposition(composition, totalLines, starts = {}) {
  const nonBlank = Object.values(composition).reduce((sum, c) => sum + c.textLines, 0);
  const prose = composition.prose ?? { lines: 0, textLines: 0 };
  return {
    spacing_in_lines: Object.fromEntries(
      Object.entries(starts).map(([kind, list]) => [kind, spacing(list)]),
    ),
    prose_share_of_lines_incl_blank_after_each_block: prose.lines / totalLines,
    prose_share_of_non_blank_lines: prose.textLines / nonBlank,
    by_type: Object.fromEntries(
      Object.entries(composition).map(([type, c]) => [
        type,
        { blocks: c.blocks, lines: c.lines, share_of_lines: c.lines / totalLines },
      ]),
    ),
  };
}

/**
 * Makes sure `<outDir>/<file>` holds exactly the deterministic document for `sizeKey`.
 * Writes the file only when it is missing or different. Returns what the harness records.
 */
export function ensureDocument(sizeKey, outDir = defaultOutDir) {
  const built = buildDocument(sizeKey);
  const deviation = (built.bytes - built.target) / built.target;
  if (Math.abs(deviation) > TOLERANCE) {
    throw new Error(
      `${sizeKey}: generated ${built.bytes} bytes, ${(deviation * 100).toFixed(2)}% from the target`,
    );
  }
  const buffer = Buffer.from(built.text, 'utf8');
  const hash = sha256(buffer);
  const path = join(outDir, DOC_SIZES[sizeKey].file);
  let action = 'written';
  if (existsSync(path) && sha256(readFileSync(path)) === hash) {
    action = 'unchanged';
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path, buffer);
  }
  return {
    size: sizeKey,
    path,
    action,
    bytes: built.bytes,
    target_bytes: built.target,
    deviation_from_target: deviation,
    lines: built.lines,
    sha256: hash,
    composition: describeComposition(built.composition, built.lines + 1, built.starts),
  };
}

// ---------- command line ----------

function parseArguments(argv) {
  const options = { sizes: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--size') options.sizes = argv[++i];
    else if (argument.startsWith('--size=')) options.sizes = argument.slice('--size='.length);
    else if (argument === '--out') options.out = argv[++i];
    else if (argument.startsWith('--out=')) options.out = argument.slice('--out='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function main() {
  const usage = 'Usage: node scripts/gen-large-doc.mjs --size 100k|1m|5m|all [--out DIR]';
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${usage}`);
    process.exit(2);
  }
  if (!options.sizes) {
    console.error(usage);
    process.exit(2);
  }
  const keys = options.sizes === 'all' ? Object.keys(DOC_SIZES) : options.sizes.split(',');
  const unknown = keys.filter((key) => !(key in DOC_SIZES));
  if (unknown.length > 0) {
    console.error(`Unknown size: ${unknown.join(', ')}\n${usage}`);
    process.exit(2);
  }
  const outDir = options.out ? resolve(process.cwd(), options.out) : defaultOutDir;
  for (const key of keys) {
    const info = ensureDocument(key, outDir);
    const percent = (value) => `${(value * 100).toFixed(1)}%`;
    const c = info.composition;
    console.log(`${info.path} (${info.action})`);
    console.log(
      `  size: ${info.bytes} bytes, target ${info.target_bytes} (${(info.deviation_from_target * 100).toFixed(2)}%)`,
    );
    console.log(`  lines: ${info.lines}`);
    console.log(
      `  prose: ${percent(c.prose_share_of_lines_incl_blank_after_each_block)} of all lines ` +
        `(each block counted with the blank line after it), ` +
        `${percent(c.prose_share_of_non_blank_lines)} of non-blank lines`,
    );
    const parts = Object.entries(c.by_type)
      .map(([type, v]) => `${type} ${v.blocks}`)
      .join(', ');
    console.log(`  blocks: ${parts}`);
    for (const [kind, v] of Object.entries(c.spacing_in_lines)) {
      if (v) {
        console.log(
          `  ${kind} spacing, lines: median ${v.median} (min ${v.min} to max ${v.max}, n ${v.n})`,
        );
      }
    }
    console.log(`  sha256: ${info.sha256}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
