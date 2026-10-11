#!/usr/bin/env node

// Deterministic documents for the Phase 2 measurement scenarios S6 to S10. Output goes to tests/fixtures/perf/flavors/ and is committed. Same script, same
// bytes: the only randomness is a fixed-seed generator.
//
//   node scripts/gen-flavor-perf.mjs
//
// S6 Pandoc ~30 KB, 40 citations, BibTeX bibliography; S7 Quarto, 12 chunks, 6 cross-references,
// a callout; S8 an Obsidian note in a copy of the fixture vault, 20 wikilinks, 2 embeds;
// S9 MDX ~20 KB, 15 components; S10 GFM with 3 Mermaid diagrams; S15 GFM with 3 Graphviz graphs.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
export const OUT_DIR = join(repoRoot, 'tests', 'fixtures', 'perf', 'flavors');
const FLAVOR_FIXTURES = join(repoRoot, 'tests', 'fixtures', 'flavors');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const WORDS =
  'survey household sample estimate region indicator coverage registration district population ' +
  'analysis dataset variable weighting stratum cluster response interview protection access ' +
  'education health shelter income livelihood assessment trend baseline comparison method ' +
  'quality record source report finding limitation context period measure category group'.split(
    ' ',
  );

function sentence(r, min = 8, max = 18) {
  const n = min + Math.floor(r() * (max - min));
  const w = [];
  for (let i = 0; i < n; i++) w.push(WORDS[Math.floor(r() * WORDS.length)]);
  const s = w.join(' ');
  return `${s[0].toUpperCase() + s.slice(1)}.`;
}

function paragraph(r, sentences = 4) {
  return Array.from({ length: sentences }, () => sentence(r)).join(' ');
}

function bibKeys() {
  return Array.from({ length: 40 }, (_, i) => `ref${String(i + 1).padStart(2, '0')}`);
}

function s6() {
  const r = rng(6);
  const keys = bibKeys();
  const bib = keys
    .map((k, i) =>
      [
        `@article{${k},`,
        `  author = {Author${i + 1}, Alex and Writer${i + 1}, Sam},`,
        `  title = {${sentence(r, 4, 7).slice(0, -1)}},`,
        `  journal = {Journal of Studies ${(i % 7) + 1}},`,
        `  volume = {${(i % 20) + 1}},`,
        `  pages = {${10 + i}--${20 + i}},`,
        `  year = {${2000 + (i % 24)}}`,
        '}',
      ].join('\n'),
    )
    .join('\n\n');
  const out = [
    '---',
    'title: Pandoc performance document',
    'bibliography: s6-refs.bib',
    'link-citations: true',
    '---',
    '',
  ];
  let cite = 0;
  let size = out.join('\n').length;
  let section = 1;
  while (size < 29_500 || cite < 40) {
    const block = [`## Section ${section}`, ''];
    for (let p = 0; p < 3; p++) {
      let text = paragraph(r, 4);
      if (cite < 40) {
        const k = keys[cite++];
        text += cite % 3 === 0 ? ` @${k} showed this.` : ` [@${k}, p. ${cite + 3}]`;
      }
      block.push(text, '');
    }
    block.push('Term', `:   ${sentence(r)}`, '');
    const text = block.join('\n');
    out.push(text);
    size += text.length;
    section++;
  }
  out.push('::: {#refs}', ':::', '');
  return { files: { 's6-pandoc.md': out.join('\n'), 's6-refs.bib': `${bib}\n` } };
}

function s7() {
  const r = rng(7);
  const out = [
    '---',
    'title: Quarto performance document',
    'number-sections: true',
    '---',
    '',
    '# Introduction {#sec-intro}',
    '',
    paragraph(r, 5),
    '',
    '::: {.callout-note}',
    '## Reading note',
    '',
    paragraph(r, 2),
    ':::',
    '',
  ];
  for (let i = 1; i <= 12; i++) {
    out.push(`## Part ${i} {#sec-part${i}}`, '', paragraph(r, 5), '');
    if (i % 2 === 0) {
      out.push(
        '```{r}',
        `#| label: fig-plot${i}`,
        `#| fig-cap: "Plot ${i}"`,
        `x <- seq(1, ${i * 10})`,
        'plot(x, x^2)',
        '```',
        '',
        `See @fig-plot${i} for the pattern.`,
        '',
      );
    } else {
      out.push(
        '```{python}',
        `#| label: chunk${i}`,
        'import statistics',
        `statistics.mean([1, 2, ${i}])`,
        '```',
        '',
        paragraph(r, 3),
        '',
      );
    }
  }
  return { files: { 's7-quarto.qmd': out.join('\n') } };
}

function s8() {
  const r = rng(8);
  const src = join(FLAVOR_FIXTURES, 'obsidian', 'vault');
  const dest = join(OUT_DIR, 'vault');
  const files = {};
  const skip = ['.hidden', '.trash', 'node_modules'];
  const copies = [
    ['.obsidian/app.json'],
    ['Home.md'],
    ['Notes/Note A.md'],
    ['Projects/Plan.md'],
    ['Archive/Old/Plan.md'],
    ['attachments/diagram.png'],
    ['attachments/report.pdf'],
  ];
  const binary = [];
  for (const [p] of copies) {
    if (skip.some((s) => p.includes(s))) continue;
    if (/\.(png|pdf)$/.test(p)) binary.push(p);
    else files[`vault/${p}`] = readFileSync(join(src, p), 'utf8');
  }
  const targets = [
    '[[Plan]]',
    '[[Projects/Plan]]',
    '[[Note A]]',
    '[[Note A|an alias]]',
    '[[Note A#Second heading]]',
    '[[Note A#^block1]]',
    '[[Home]]',
    '[[Home#Local heading]]',
    '[[Does Not Exist]]',
  ];
  const out = ['---', 'tags: [perf, note]', 'aliases: [Perf]', '---', '', '# Perf note', ''];
  for (let i = 0; i < 20; i++) {
    out.push(
      `${paragraph(r, 3)} See ${targets[i % targets.length]} for more. #perf/topic${i % 4}`,
      '',
    );
    if (i === 6) out.push('![[Note A#Second heading]]', '');
    if (i === 13) out.push('![[diagram.png|300]]', '');
    if (i % 5 === 4)
      out.push(
        `> [!note] Callout ${i}`,
        `> ${sentence(r)}`,
        '',
        `==${sentence(r, 3, 5)}== ^blk${i}`,
        '',
      );
  }
  files['vault/Perf note.md'] = out.join('\n');
  return { files, binary: { src, dest, list: binary } };
}

function s9() {
  const r = rng(9);
  const out = [
    '---',
    'title: MDX performance document',
    '---',
    '',
    "import { Callout, Chart } from './components'",
    '',
    'export const meta = { title: "MDX performance document" }',
    '',
  ];
  const comps = ['Callout', 'Chart', 'Tabs', 'Card', 'Badge'];
  let n = 0;
  let size = out.join('\n').length;
  let i = 1;
  while (size < 19_500 || n < 15) {
    const block = [`## Section ${i}`, '', paragraph(r, 5), '', paragraph(r, 4), ''];
    if (n < 15) {
      const c = comps[n % comps.length];
      block.push(
        `<${c} kind="info" count={${n + 1}}>`,
        '',
        `**${sentence(r, 4, 8)}**`,
        '',
        `</${c}>`,
        '',
      );
      n++;
    }
    block.push(`Value: {${i} + 1}`, '', '| A | B |', '|---|---|', `| ${i} | ${i * 2} |`, '');
    const t = block.join('\n');
    out.push(t);
    size += t.length;
    i++;
  }
  return { files: { 's9-mdx.mdx': out.join('\n') } };
}

function s10() {
  const r = rng(10);
  const out = ['# Diagrams', '', paragraph(r, 4), ''];
  const diagrams = [
    'flowchart TD\n    A[Start] --> B{Check}\n    B -->|yes| C[Done]\n    B -->|no| D[Retry]\n    D --> B',
    'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Request\n    B-->>A: Response',
    'classDiagram\n    class Animal\n    class Dog\n    Animal <|-- Dog\n    Animal : +name',
  ];
  diagrams.forEach((d, i) => {
    out.push(
      `## Diagram ${i + 1}`,
      '',
      paragraph(r, 3),
      '',
      '```mermaid',
      d,
      '```',
      '',
      paragraph(r, 3),
      '',
    );
  });
  return { files: { 's10-mermaid.md': out.join('\n') } };
}

function s15() {
  const r = rng(15);
  const out = ['# Graphs', '', paragraph(r, 4), ''];
  const graphs = [
    'digraph G {\n  rankdir=LR;\n  Start -> Check;\n  Check -> Done [label="yes"];\n  Check -> Retry [label="no"];\n  Retry -> Check;\n}',
    'digraph Clusters {\n  subgraph cluster_a { label="Front"; a1 -> a2 -> a3; }\n  subgraph cluster_b { label="Back"; b1 -> b2; }\n  a3 -> b1;\n  a1 -> b2;\n}',
    'graph Ring {\n  layout=neato;\n  n1 -- n2 -- n3 -- n4 -- n5 -- n1;\n  n1 -- n3;\n}',
  ];
  graphs.forEach((d, i) => {
    out.push(
      `## Graph ${i + 1}`,
      '',
      paragraph(r, 3),
      '',
      '```dot',
      d,
      '```',
      '',
      paragraph(r, 3),
      '',
    );
  });
  return { files: { 's15-graphviz.md': out.join('\n') } };
}

export function generate() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (const make of [s6, s7, s8, s9, s10, s15]) {
    const { files, binary } = make();
    for (const [name, text] of Object.entries(files)) {
      const p = join(OUT_DIR, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
      written.push(p);
    }
    if (binary) {
      for (const f of binary.list) {
        const p = join(binary.dest, f);
        mkdirSync(dirname(p), { recursive: true });
        cpSync(join(binary.src, f), p);
        written.push(p);
      }
    }
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const p of generate()) {
    const b = readFileSync(p);
    console.log(
      `${relative(repoRoot, p)}  ${b.length} bytes  ${createHash('sha256').update(b).digest('hex').slice(0, 12)}`,
    );
  }
}
