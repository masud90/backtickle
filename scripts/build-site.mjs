#!/usr/bin/env node
// Builds the project website (masud90.github.io/backtickle) from README.md.
//
//   node scripts/build-site.mjs [--out _site]
//
// The page is the README rendered with markdown-it, wrapped in a small template with the Backtickle
// palette. docs/media and docs/images are copied next to it, so the README's own relative image
// paths keep working; every other relative link (LICENSE, CONTRIBUTING.md, ...) points at the file
// on GitHub. Headings get GitHub-style ids, so #contributing and similar anchors work as they do on
// github.com. The Pages workflow runs this on every push to main, so the site follows the README.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const outDir = resolve(repoRoot, outArg > -1 ? process.argv[outArg + 1] : '_site');

const repoUrl = 'https://github.com/masud90/backtickle';
const siteUrl = 'https://masud90.github.io/backtickle/';
const releasesUrl = `${repoUrl}/releases/latest`;
const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
// The title and description are what search results show, so they carry the words people search
// for ("Markdown editor", "viewer", the platforms) as well as the tagline.
// The app's name in one place, so a rename only touches this line (and the README).
const appName = 'Backtickle';
const shareTitle = `${appName}: the open-source Markdown editor and reader`;
const title = `${appName}: free, open-source Markdown editor and reader for Mac, Windows and Linux`;
const description =
  'Free, open-source Markdown editor and viewer for macOS, Windows and Linux. GitHub, Obsidian, ' +
  'Pandoc and Quarto Markdown, math, Mermaid, PDF and Word export.';
const posterUrl = `${siteUrl}docs/media/backtickle-poster.png`;
const posterAlt = `${appName}: Markdown source on the left, the formatted document on the right`;

// Search engines read this to show Backtickle as an app (price, platforms) in results.
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: appName,
  description,
  url: siteUrl,
  applicationCategory: 'ProductivityApplication',
  applicationSubCategory: 'Markdown editor',
  operatingSystem: 'macOS 14 or later, Windows 10 or 11, Linux',
  softwareVersion: version,
  downloadUrl: releasesUrl,
  license: 'https://opensource.org/licenses/MIT',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  image: posterUrl,
  screenshot: `${siteUrl}docs/images/split-light.png`,
  author: { '@type': 'Person', name: 'Masud Rahman', url: 'https://github.com/masud90' },
  sameAs: [repoUrl],
};

// Paths published with the site; relative links into them stay relative.
const publishedDirs = ['docs/media', 'docs/images'];

const isRelative = (url) => url !== '' && !/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
const isPublished = (url) => publishedDirs.some((dir) => url.startsWith(`${dir}/`));

function rewriteUrl(url) {
  if (!isRelative(url) || isPublished(url)) return url;
  return `${repoUrl}/blob/main/${url.replace(/^\.\//, '')}`;
}

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, numbered repeats.
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

// Width and height from a PNG's header, so the browser can reserve the space before it loads.
function pngSize(path) {
  try {
    const header = readFileSync(path).subarray(0, 24);
    if (header.toString('latin1', 1, 4) !== 'PNG') return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  }
}

// The README's own images (the screenshots) load lazily and with their size known, so the page
// does not jump as they arrive. The hero icon and the badges above the fold load at once.
function sizeImages(html) {
  let first = true;
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const src = tag.match(/\bsrc="([^"]*)"/)?.[1] ?? '';
    if (!isPublished(src)) return tag;
    let out = tag;
    if (!/\bwidth=/.test(out) && src.endsWith('.png')) {
      const size = pngSize(join(repoRoot, src));
      if (size) out = out.replace('<img', `<img width="${size.width}" height="${size.height}"`);
    }
    if (!first && !/\bloading=/.test(out)) {
      out = out.replace('<img', '<img loading="lazy" decoding="async"');
    }
    first = false;
    return out;
  });
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function renderReadme(markdown) {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  const slug = slugger();

  md.core.ruler.push('heading_ids', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== 'heading_open') continue;
      const text = tokens[i + 1].children
        .filter((t) => t.type === 'text' || t.type === 'code_inline')
        .map((t) => t.content)
        .join('');
      tokens[i].attrSet('id', slug(text));
    }
  });

  md.core.ruler.push('rewrite_links', (state) => {
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type === 'link_open') token.attrSet('href', rewriteUrl(token.attrGet('href')));
        if (token.type === 'image') token.attrSet('src', rewriteUrl(token.attrGet('src')));
      }
    }
  });

  // Raw HTML in the README (the centered hero, the screenshot table) carries its own src/href.
  const rewriteHtml = (html) =>
    html.replace(
      /\b(src|href)="([^"]*)"/g,
      (_, attr, url) => `${attr}="${escapeAttr(rewriteUrl(url))}"`,
    );
  for (const rule of ['html_block', 'html_inline']) {
    md.renderer.rules[rule] = (tokens, idx) => rewriteHtml(tokens[idx].content);
  }

  let html = md.render(markdown);

  // The README shows the intro as a GIF because GitHub will not autoplay a video. The site can,
  // and the MP4 is a quarter of the size.
  html = html.replace(
    /<img src="docs\/media\/backtickle-intro\.gif"[^>]*alt="([^"]*)"[^>]*>/,
    (_, alt) =>
      `<video class="intro" src="docs/media/backtickle-intro.mp4" poster="docs/media/backtickle-poster.png" ` +
      `autoplay muted loop playsinline aria-label="${alt}"></video>`,
  );
  return sizeImages(html);
}

function page(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#0058bc">
<meta name="google-site-verification" content="hIaX0_6ekcrHBbs0jC7U26eNvEE7TsffvZdCypQ9tVQ">
<link rel="canonical" href="${siteUrl}">
<link rel="icon" type="image/png" href="docs/media/icon.png">
<link rel="apple-touch-icon" href="docs/media/icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${appName}">
<meta property="og:title" content="${escapeAttr(shareTitle)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${siteUrl}">
<meta property="og:image" content="${posterUrl}">
<meta property="og:image:width" content="1920">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="${escapeAttr(posterAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(shareTitle)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${posterUrl}">
<meta name="twitter:image:alt" content="${escapeAttr(posterAlt)}">
<script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="site.css">
</head>
<body>
<header class="bar">
  <a class="brand" href="./"><img src="docs/media/icon.png" width="28" height="28" alt="">${appName}</a>
  <nav>
    <a href="#features">Features</a>
    <a href="#contributing">Contribute</a>
    <a href="${repoUrl}">GitHub</a>
    <a class="cta" href="${releasesUrl}">Download</a>
  </nav>
</header>
<main class="readme">
${body}
</main>
<footer>
  <p>${appName} is free and open source under the <a href="${repoUrl}/blob/main/LICENSE">MIT License</a>.
  This page is built from the <a href="${repoUrl}#readme">README</a>.</p>
</footer>
</body>
</html>
`;
}

const css = `@font-face {
  font-family: 'Inter';
  font-weight: 100 900;
  font-display: swap;
  src: url('fonts/inter.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-weight: 100 800;
  font-display: swap;
  src: url('fonts/jetbrains-mono.woff2') format('woff2');
}
:root {
  --canvas: #fbfbfd;
  --surface: #ffffff;
  --text: #1d1d1f;
  --muted: #5f6368;
  --line: #e3e4ea;
  --blue: #0058bc;
  --indigo: #4c4aca;
  --green: #008733;
  --code-bg: #f1f2f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #141518;
    --surface: #1c1d21;
    --text: #ececf1;
    --muted: #a0a3ab;
    --line: #2e3036;
    --blue: #5a9cff;
    --indigo: #9b99ff;
    --green: #3fbf6a;
    --code-bg: #24262b;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--text);
  font: 16px/1.65 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--blue); text-decoration: none; }
a:hover { text-decoration: underline; }
.bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px max(16px, calc((100vw - 960px) / 2));
  background: color-mix(in srgb, var(--canvas) 82%, transparent);
  backdrop-filter: saturate(180%) blur(16px);
  -webkit-backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; color: var(--text); }
.brand:hover { text-decoration: none; }
.bar nav { display: flex; align-items: center; gap: 20px; font-size: 15px; }
.bar nav a { color: var(--muted); }
.bar nav a:hover { color: var(--text); text-decoration: none; }
.bar nav a.cta {
  color: #fff;
  background: var(--blue);
  padding: 6px 14px;
  border-radius: 999px;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) { .bar nav a.cta { color: #0b1220; } }
@media (max-width: 600px) { .bar nav a:not(.cta) { display: none; } }
.readme { max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }
.readme > div[align='center'] { text-align: center; padding: 24px 0 8px; }
.readme > div[align='center'] h1 {
  font-size: clamp(40px, 7vw, 64px);
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 16px 0 12px;
  border: 0;
  background: linear-gradient(90deg, var(--blue), var(--indigo));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.readme > div[align='center'] > p:first-of-type ~ p { margin: 10px 0; }
.readme > div[align='center'] strong { font-size: 1.25em; }
.readme > div[align='center'] p a img { margin: 3px 2px; vertical-align: middle; }
.readme .intro, .readme > div[align='center'] img[width='880'] {
  display: block;
  width: 100%;
  max-width: 880px;
  height: auto;
  margin: 24px auto 4px;
  border-radius: 14px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 12px 40px rgb(0 40 120 / 0.14);
}
h2 {
  font-size: 30px;
  letter-spacing: -0.02em;
  line-height: 1.2;
  margin: 64px 0 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
h3 { font-size: 20px; margin: 32px 0 12px; }
img { max-width: 100%; height: auto; }
code, pre { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
:not(pre) > code { background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 5px; }
pre {
  background: var(--code-bg);
  padding: 14px 16px;
  border-radius: 10px;
  overflow-x: auto;
  line-height: 1.5;
}
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: var(--surface); }
td img { border-radius: 8px; border: 1px solid var(--line); }
details {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 4px 18px;
  margin: 12px 0;
}
details[open] { padding-bottom: 8px; }
summary { cursor: pointer; padding: 10px 0; }
li { margin: 4px 0; }
li::marker { color: var(--indigo); }
footer {
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 24px 16px 40px;
}
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'fonts'), { recursive: true });
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
writeFileSync(join(outDir, 'index.html'), page(renderReadme(readme)));
writeFileSync(join(outDir, 'site.css'), css);
writeFileSync(join(outDir, '.nojekyll'), '');
// A project site cannot serve the domain's robots.txt, so the sitemap is submitted to search
// engines directly (Google Search Console, Bing Webmaster Tools) at this address.
writeFileSync(
  join(outDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`,
);
for (const dir of publishedDirs.filter((d) => existsSync(join(repoRoot, d)))) {
  cpSync(join(repoRoot, dir), join(outDir, dir), { recursive: true });
}
const fonts = join(repoRoot, 'node_modules', '@fontsource-variable');
cpSync(join(fonts, 'inter/files/inter-latin-wght-normal.woff2'), join(outDir, 'fonts/inter.woff2'));
cpSync(
  join(fonts, 'jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
  join(outDir, 'fonts/jetbrains-mono.woff2'),
);
console.log(`Site written to ${outDir}`);
