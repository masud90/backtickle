// Writes THIRD_PARTY_NOTICES.md: production npm packages and Rust crates with their licenses.
// Usage: node scripts/third-party-notices.mjs   (run after `npm ci`; needs cargo)
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// npm packages (production, whole tree)
const tree = JSON.parse(run('npm', ['ls', '--omit=dev', '--all', '--long', '--json']));
const npm = new Map();
function walk(deps) {
  for (const [name, info] of Object.entries(deps ?? {})) {
    if (info.version && !npm.has(`${name}@${info.version}`)) {
      let license = 'UNKNOWN';
      try {
        const pkg = JSON.parse(
          readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
        );
        const l = pkg.license ?? pkg.licenses;
        license =
          typeof l === 'string'
            ? l
            : Array.isArray(l)
              ? l.map((x) => x.type ?? x).join(' OR ')
              : (l?.type ?? 'UNKNOWN');
        if (license === 'UNKNOWN') {
          // No license field: recognize the MIT text in the license file.
          for (const f of ['license', 'LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
            try {
              const text = readFileSync(join(root, 'node_modules', name, f), 'utf8');
              if (/^\s*(The )?MIT License/i.test(text)) license = 'MIT (from license file)';
              break;
            } catch {
              // try the next name
            }
          }
        }
      } catch {
        // keep UNKNOWN
      }
      npm.set(`${name}@${info.version}`, {
        name,
        version: info.version,
        license,
        dir: info.path ?? join(root, 'node_modules', name),
      });
    }
    walk(info.dependencies);
  }
}
walk(tree.dependencies);

// @viz-js/viz publishes no license file; its MIT text and that of the Graphviz build inside it are
// kept in licenses/ (copied from github.com/mdaines/viz-js and gitlab.com/graphviz/graphviz).
const vizjs = [...npm.values()].find((x) => x.name === '@viz-js/viz');
if (vizjs) vizjs.dir = join(root, 'licenses', 'viz-js');
const graphvizVersion = '16.0.0';

// Fonts and icons are devDependencies, but the build copies them into the app.
const BUNDLED_DEV = [
  '@fontsource-variable/inter',
  '@fontsource-variable/jetbrains-mono',
  '@fontsource-variable/lexend-deca',
  '@fontsource-variable/literata',
  '@fontsource/atkinson-hyperlegible',
  '@fontsource/opendyslexic',
  '@material-symbols/svg-400',
];
const bundled = BUNDLED_DEV.map((name) => {
  const dir = join(root, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return { name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', dir };
});

// Rust crates: normal dependencies reachable from the backtickle package
const meta = JSON.parse(
  run('cargo', ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml']),
);
const byId = new Map(meta.packages.map((p) => [p.id, p]));
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
const start = meta.packages.find((p) => p.name === 'backtickle');
const seen = new Set();
const stack = [start.id];
while (stack.length) {
  const id = stack.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const d of nodes.get(id)?.deps ?? []) {
    if (d.dep_kinds.some((k) => k.kind === null)) stack.push(d.pkg);
  }
}
const crates = [...seen]
  .filter((id) => id !== start.id)
  .map((id) => byId.get(id))
  .map((p) => ({
    name: p.name,
    version: p.version,
    license: p.license ?? 'UNKNOWN',
    dir: dirname(p.manifest_path),
  }));

const cmp = (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
const npmList = [...npm.values()].sort(cmp);
crates.sort(cmp);

const count = (list) => {
  const c = {};
  for (const x of list) c[x.license] = (c[x.license] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
};
const table = (list) =>
  [
    '| Package | Version | License |',
    '|---|---|---|',
    ...list.map((x) => `| ${x.name} | ${x.version} | ${x.license} |`),
  ].join('\n');
const counts = (list) =>
  count(list)
    .map(([l, n]) => `- ${l}: ${n}`)
    .join('\n');

// License texts: the license, notice and copying files in each package folder.
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)/i;
function licenseFiles(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8').trimEnd() }));
}
const sources = [
  ...bundled.map((x) => ({ id: `${x.name}@${x.version}`, dir: x.dir, license: x.license })),
  {
    id: `Graphviz@${graphvizVersion} (inside @viz-js/viz)`,
    dir: join(root, 'licenses', 'graphviz'),
    license: 'EPL-2.0',
  },
  ...npmList.map((x) => ({ id: `${x.name}@${x.version}`, dir: x.dir, license: x.license })),
  ...crates.map((x) => ({ id: `${x.name}@${x.version}`, dir: x.dir, license: x.license })),
];
const byText = new Map();
const noFile = [];
for (const s of sources) {
  const files = licenseFiles(s.dir);
  if (files.length === 0) {
    noFile.push(s);
    continue;
  }
  const text = files
    .map((f) => (files.length > 1 ? `--- ${f.file} ---\n${f.text}` : f.text))
    .join('\n\n');
  if (!byText.has(text)) byText.set(text, []);
  byText.get(text).push(s.id);
}
const groups = [...byText.entries()]
  .map(([text, ids]) => ({ text, ids: ids.sort() }))
  .sort((a, b) => a.ids[0].localeCompare(b.ids[0]));
const textBlocks = groups.map((g, i) =>
  [
    `==== License text ${i + 1} ====`,
    `Used by ${g.ids.length} package${g.ids.length === 1 ? '' : 's'}: ${g.ids.join(', ')}.`,
    '',
    g.text,
  ].join('\n'),
);
const noFileLines = noFile
  .sort((a, b) => a.id.localeCompare(b.id))
  .map((s) => `- ${s.id}: No license file in the package; license per its manifest: ${s.license}`);
const licenseText = `THIRD-PARTY LICENSE TEXTS
This file is generated by \`node scripts/third-party-notices.mjs\`. It accompanies THIRD_PARTY_NOTICES.md.

Full texts of the license, notice and copying files found in each package folder. Identical texts are
printed once, followed by the packages that use them.

${textBlocks.join('\n\n')}

==== Packages without a license file ====
${noFileLines.join('\n')}
`;
writeFileSync(join(root, 'THIRD_PARTY_LICENSES.txt'), licenseText);
console.log(`license texts: ${groups.length} distinct, packages without a file: ${noFile.length}`);

const out = `# Third-party notices

Backtickle is released under the MIT License (see LICENSE). It includes the following third-party software.
This file is generated by \`node scripts/third-party-notices.mjs\`.

## Fonts and icons

Inter, JetBrains Mono, Literata, Atkinson Hyperlegible, Lexend Deca and OpenDyslexic are bundled under the
SIL Open Font License 1.1 ("OpenDyslexic" is a Reserved Font Name of its author). The interface icons are
Material Symbols by Google, under the Apache License 2.0.

${table(bundled)}

## Graphviz

Graphviz ${graphvizVersion}, compiled to WebAssembly inside the npm package @viz-js/viz, is under the
Eclipse Public License 2.0.

## Source code

The source code of Backtickle is at https://github.com/masud90/backtickle. Every package listed here is
used unmodified, and its source code is available from its public registry (npmjs.com for npm packages,
crates.io for Rust crates) at the version listed, and from the project's own repository. This includes the
packages under the Eclipse Public License (Graphviz from https://gitlab.com/graphviz/graphviz, elkjs from
https://github.com/kieler/elkjs) and the Mozilla Public License (for example cssparser and selectors from
https://github.com/servo/rust-cssparser and https://github.com/servo/stylo). If you cannot get a source
from there, open an issue at https://github.com/masud90/backtickle/issues and it will be provided.

## Linux AppImage

The AppImage also bundles system libraries from Ubuntu, some under the GNU LGPL or GPL. The file
\`<AppImage name>.sources.txt\`, published next to each AppImage on the release page, lists their Ubuntu
source packages and versions and carries the written offer to provide their source code for at least three
years. Their copyright notices are in usr/share/doc inside the AppImage.

## npm packages (production), ${npmList.length}

${counts(npmList)}

${table(npmList)}

## Rust crates (normal dependencies), ${crates.length}

${counts(crates)}

${table(crates)}

The full license texts for these packages are in THIRD_PARTY_LICENSES.txt.
`;
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), out);
console.log(`npm: ${npmList.length}`, JSON.stringify(Object.fromEntries(count(npmList))));
console.log(`rust: ${crates.length}`, JSON.stringify(Object.fromEntries(count(crates))));
