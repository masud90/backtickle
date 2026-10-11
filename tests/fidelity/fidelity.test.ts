/**
 * Fidelity of the Pandoc / MMD and Quarto / RMD packs against the real tools: Pandoc 3.8.3 and Quarto 1.9.38 inside RStudio render the same fixtures; the
 * structure and text of both HTMLs are compared, not the exact markup. Quarto never executes code
 * (a temporary copy with `engine: markdown` forced). Every allowed difference is in ALLOWED.md.
 * Run with `npm run test:fidelity`; skipped with a notice when RStudio's tools are missing.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extract, type Structure } from './extract';
import {
  FLAVORS,
  HAVE_TOOLS,
  listFiles,
  makeSandbox,
  ROOT,
  renderOurs,
  renderPandoc,
  renderQuarto,
} from './harness';

if (!HAVE_TOOLS) {
  console.warn('fidelity: RStudio Pandoc and Quarto not found; the fidelity tests are skipped.');
}

// ---- the fixtures -------------------------------------------------------------------------------

interface Fixture {
  name: string;
  flavor: 'pandoc' | 'quarto';
  /** Absolute path of the source in the repository. */
  path: string;
  /** Path inside the sandbox copy (Quarto). */
  relative: string;
}

const GUIDES = join(ROOT, 'src/content/guides');

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  const pandocDir = join(FLAVORS, 'pandoc');
  for (const file of readdirSync(pandocDir).sort()) {
    if (!/\.(md|mmd)$/.test(file)) continue;
    out.push({
      name: `pandoc/${file}`,
      flavor: 'pandoc',
      path: join(pandocDir, file),
      relative: '',
    });
  }
  const quartoDir = join(FLAVORS, 'quarto');
  for (const file of readdirSync(quartoDir).sort()) {
    if (!/\.(qmd|Rmd)$/.test(file)) continue;
    out.push({
      name: `quarto/${file}`,
      flavor: 'quarto',
      path: join(quartoDir, file),
      relative: `quarto/${file}`,
    });
  }
  out.push({
    name: 'quarto/project/chapter.qmd',
    flavor: 'quarto',
    path: join(quartoDir, 'project/chapter.qmd'),
    relative: 'quarto/project/chapter.qmd',
  });
  out.push({
    name: 'guide/pandoc.md',
    flavor: 'pandoc',
    path: join(GUIDES, 'pandoc.md'),
    relative: '',
  });
  out.push({
    name: 'guide/quarto.md',
    flavor: 'quarto',
    path: join(GUIDES, 'quarto.md'),
    relative: 'guides/quarto.qmd',
  });
  return out;
}

// ---- allowed differences (each id is described in ALLOWED.md) -------------------------------------

type Rule = {
  id: string;
  files: RegExp;
  /** Removes or rewrites what the allowed difference changes, on both sides. */
  apply(ours: Structure, ref: Structure, name: string): void;
};

const drop = (list: string[], test: (item: string) => boolean) => {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i] as string)) list.splice(i, 1);
};

const RULES: Rule[] = [
  {
    id: 'missing-key',
    files: /^pandoc\/citations|^guide\/pandoc/,
    apply(ours) {
      ours.citations = ours.citations.map((c) => c.replace(/\(@(\w+)\?\)/g, '($1?)'));
      ours.paragraphs = ours.paragraphs.map((p) => p.replace(/\(@(\w+)\?\)/g, '($1?)'));
    },
  },
  {
    id: 'mmd-citation',
    files: /^pandoc\/citations/,
    apply(ours, ref) {
      const had = ours.paragraphs.some((p) => p.startsWith('MultiMarkdown (MMD) form:'));
      drop(ours.paragraphs, (p) => p.startsWith('MultiMarkdown (MMD) form:'));
      drop(ref.paragraphs, (p) => p.startsWith('MultiMarkdown (MMD) form:'));
      if (had) ours.citations.pop();
    },
  },
  {
    id: 'abbreviations',
    files: /^pandoc\/syntax\.md$|^guide\//,
    apply(_ours, ref) {
      drop(ref.paragraphs, (p) => /^\*?\[[^\]]+\]: .+/.test(p) && !p.includes(']('));
    },
  },
  {
    id: 'criticmarkup',
    files: /^pandoc\/syntax\.md$|^guide\//,
    apply(ours, ref) {
      drop(ours.paragraphs, (p) => p.startsWith('CRITIC '));
      drop(ref.paragraphs, (p) => /\{(\+\+|--|~~|==|>>)|\{>>/.test(p));
    },
  },
  {
    id: 'mmd-caption',
    files: /^pandoc\/tables\.md$/,
    apply(ours, ref) {
      drop(ours.captions, (c) => c === 'MMD table caption');
      drop(ref.paragraphs, (p) => p === '[MMD table caption]');
    },
  },
  {
    id: 'author-map',
    files: /^pandoc\/title-yaml\.md$|^guide\//,
    apply(ours, ref) {
      drop(ours.titleBlock, (t) => t.startsWith('author:'));
      drop(ref.titleBlock, (t) => t.startsWith('author:'));
    },
  },
  {
    id: 'references-heading',
    files: /^quarto\//,
    apply(_ours, ref) {
      drop(ref.headings, (h) => h === 'h2 References');
    },
  },
  {
    id: 'chunks-not-run',
    files: /^quarto\/chunks\.qmd$|^guide\/quarto/,
    apply(ours, ref, name) {
      // Pandoc shows a chunk as plain text; Writedown shows a card. Nothing runs, so the
      // figures the chunks would make do not exist in Quarto (no caption, no number).
      drop(ref.paragraphs, (p) => /^\{(r|python)\b/.test(p));
      for (const prefix of ['We use inline R code', 'Quarto form:', 'The trend is plotted in']) {
        drop(ref.paragraphs, (p) => p.startsWith(prefix));
        drop(ours.paragraphs, (p) => p.startsWith(prefix));
      }
      if (name === 'quarto/chunks.qmd') ours.captions.length = 0;
      else {
        drop(ours.captions, (c) => c.includes('A trend line over time'));
        drop(ours.crossrefs, (c) => c === 'Figure 2');
      }
    },
  },
  {
    id: 'bookdown-not-knitted',
    files: /^quarto\/bookdown\.Rmd$/,
    apply(ours, ref) {
      // bookdown resolves `\@ref()` only after knitr and the bookdown format ran; nothing runs.
      for (const s of [ours, ref]) {
        drop(s.paragraphs, (p) => /^(Reference to|\{r|MATH)/.test(p));
        s.captions.length = 0;
        s.crossrefs.length = 0;
      }
    },
  },
  {
    id: 'video-shortcode',
    files: /^guide\/quarto\.md$|^quarto\/shortcodes\.qmd$/,
    apply(ours, ref) {
      // The preview loads no external media: a video shortcode stays literal text here.
      drop(ours.paragraphs, (p) => p.includes('{{< video'));
      drop(ref.paragraphs, (p) => /^(Video|video)\b/.test(p));
    },
  },
  {
    id: 'quarto-shortcode-in-code',
    files: /^guide\/quarto\.md$/,
    apply(ours, ref) {
      // Quarto 1.9.38 treats `{{<` inside inline code as the start of a shortcode.
      for (const s of [ours, ref])
        drop(s.paragraphs, (p) => p.startsWith('Shortcodes are written between'));
    },
  },
];

const ALLOWED_FILE = join(__dirname, 'ALLOWED.md');
const allowedIds = (): string[] =>
  existsSync(ALLOWED_FILE)
    ? [...readFileSync(ALLOWED_FILE, 'utf8').matchAll(/^- ([a-z0-9-]+) \|/gm)].map(
        (m) => m[1] as string,
      )
    : [];

// ---- findings: a difference that is not allowed stays as an expected failure ------------------------

const FINDINGS = new Map<string, string>([]);

// ---- run ------------------------------------------------------------------------------------------

const FIELDS: (keyof Structure)[] = [
  'titleBlock',
  'headings',
  'paragraphs',
  'lists',
  'tables',
  'captions',
  'citations',
  'references',
  'crossrefs',
  'footnotes',
  'footnoteCount',
  'terms',
  'callouts',
  'tabs',
];

interface Result {
  ours: Structure;
  ref: Structure | null;
  refError: string | null;
}

const ALL = fixtures();
const results = new Map<string, Result>();
let sandbox = '';

describe.skipIf(!HAVE_TOOLS)('fidelity against Pandoc 3.8.3 and Quarto 1.9.38', () => {
  beforeAll(async () => {
    sandbox = makeSandbox();
    // The guides are copied into the sandbox too, next to the fixtures they refer to.
    mkdirSync(join(sandbox, 'flavors/guides'), { recursive: true });
    copyFileSync(join(GUIDES, 'quarto.md'), join(sandbox, 'flavors/guides/quarto.qmd'));
    // The guide shows an include of a file that does not exist; Quarto stops on that, so the
    // reference render gets an empty file of that name.
    writeFileSync(join(sandbox, 'flavors/guides/missing-file.qmd'), '');
    for (const fixture of ALL) {
      const quarto = fixture.flavor === 'quarto';
      const ours = extract(await renderOurs(fixture.path, fixture.flavor), {
        quarto,
      });
      let refHtml: string | null = null;
      let refError: string | null = null;
      if (quarto) {
        const run = renderQuarto(sandbox, fixture.relative);
        refHtml = run.html;
        refError = run.error;
      } else {
        refHtml = renderPandoc(fixture.path);
      }
      results.set(fixture.name, {
        ours,
        ref: refHtml === null ? null : extract(refHtml, { quarto }),
        refError,
      });
    }
  });

  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  it('every rule is described in ALLOWED.md and every entry has a rule', () => {
    const described = allowedIds().sort();
    const implemented = RULES.map((r) => r.id).sort();
    expect(implemented).toEqual(described);
  });

  for (const fixture of ALL) {
    describe(fixture.name, () => {
      for (const field of FIELDS) {
        const key = `${fixture.name}:${field}`;
        const body = () => {
          const result = results.get(fixture.name) as Result;
          if (result.ref === null) return; // Quarto itself failed: see the Quarto failures test.
          const ours = structuredClone(result.ours);
          const ref = structuredClone(result.ref);
          for (const rule of RULES)
            if (rule.files.test(fixture.name)) rule.apply(ours, ref, fixture.name);
          expect(ours[field], field).toEqual(ref[field]);
        };
        if (FINDINGS.has(key)) {
          // FINDING (see FINDINGS above): kept as an expected failure.
          it.fails(`${field} ${FINDINGS.get(key)}`, body);
        } else {
          it(field, body);
        }
      }
    });
  }

  it('Quarto itself fails only on the include cycles, and Writedown does not', () => {
    const failed = ALL.filter((f) => results.get(f.name)?.ref === null).map((f) => f.name);
    // Quarto 1.9.38 overflows its stack on an include cycle (allowed: quarto-cycle).
    expect(failed.sort()).toEqual([
      'quarto/_cycle-x.qmd',
      'quarto/_cycle-y.qmd',
      'quarto/cycle.qmd',
    ]);
  });

  it('Quarto never executes code: the side-effect fixture creates no file', () => {
    const copy = join(sandbox, 'flavors/quarto/side-effect.qmd');
    expect(readFileSync(copy, 'utf8')).toMatch(/^---\nengine: markdown\n/);
    expect(results.get('quarto/side-effect.qmd')?.refError).toBeNull();
    expect(results.get('quarto/side-effect.qmd')?.ref).not.toBeNull();
    const names = (dir: string) => listFiles(dir).map((f) => basename(f));
    for (const dir of [sandbox, FLAVORS]) {
      expect(
        names(dir).filter((n) => /SIDE_EFFECT_(R|PY)/.test(n)),
        dir,
      ).toEqual([]);
    }
    expect(readdirSync(ROOT).filter((n) => /SIDE_EFFECT_(R|PY)/.test(n))).toEqual([]);
  });
});
