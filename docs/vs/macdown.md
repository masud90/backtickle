---
app: MacDown
website: https://macdown.uranusjr.com
title: "Backtickle vs MacDown: a maintained, free MacDown alternative for Apple silicon"
description: "MacDown has had no release since 2020 and is Intel-only. Backtickle is a free, open-source split-view Markdown editor for macOS (Apple silicon and Intel), Windows and Linux."
heading: "Backtickle vs MacDown"
summary: "MacDown has not been updated since 2020 and needs Rosetta; Backtickle is a maintained, free split-view editor that runs natively on Apple silicon."
order: 6
updated: 2026-10-20
gif: macdown.gif
gifAlt: "Animated comparison of Backtickle and MacDown: maintenance, Apple silicon, platforms, diagrams, Markdown flavors and export"
faq:
  - q: "What is the best replacement for MacDown?"
    a: "Backtickle is a free, open-source Markdown editor with the same split view, source on the left and the rendered document on the right, that runs natively on Apple silicon and Intel Macs as well as Windows and Linux. MacDown's last stable release was 0.7.3 in January 2020."
  - q: "Does MacDown work on Apple silicon Macs?"
    a: "Only through Rosetta 2, because MacDown is Intel-only. Apple has said macOS 27 is the last version with general Rosetta support, so Intel-only apps like MacDown are expected to stop launching on Apple silicon Macs with macOS 28."
  - q: "Is Backtickle free like MacDown?"
    a: "Yes. Both are free and MIT-licensed. Backtickle is actively developed, with releases in 2026."
---

**Short answer:** MacDown was the go-to free split-view Markdown editor for the Mac, but its last stable release was
in January 2020, it is Intel-only, and its Homebrew cask is disabled. Backtickle keeps what people liked about
MacDown (free, open source, source on the left and the result on the right) and runs natively on Apple silicon,
with current Markdown support and builds for Windows and Linux.

## At a glance

| | Backtickle | MacDown |
| --- | --- | --- |
| Price | Free | Free |
| Source code | Open source, MIT License | Open source, MIT License |
| Last release | 0.2.0, October 2026 | 0.7.3, January 2020 |
| Apple silicon | Native (universal build) | Intel-only, needs Rosetta 2 |
| Platforms | macOS 14+, Windows 10 and 11, Linux | macOS only |
| Editing | Editor, Split and Preview views with synced scrolling | Split source and preview |
| Markdown flavors | CommonMark, GFM, Obsidian, Pandoc / MultiMarkdown, Quarto / R Markdown, MDX | Hoedown with optional extensions |
| Math | KaTeX | TeX-style math |
| Diagrams | Mermaid and Graphviz | Not listed |
| Export | HTML, PDF, print, Word (through Pandoc), Render with Quarto | HTML, PDF |

MacDown details from [macdown.uranusjr.com](https://macdown.uranusjr.com), its
[GitHub repository](https://github.com/MacDownApp/macdown) and the
[Homebrew cask](https://formulae.brew.sh/cask/macdown), checked October 2026.

## Why switch from MacDown

- **It keeps working.** Backtickle is a universal macOS app, so the end of Rosetta does not affect it.
- **Modern Markdown.** GitHub alerts and task lists, footnotes, Mermaid and Graphviz diagrams, Obsidian callouts,
  Pandoc citations and Quarto documents.
- **The same split view, improved.** Synced scrolling, a document outline, and task boxes you can tick in the
  preview.
- **Safe by design.** The preview is sanitized under a strict content security policy, and the app makes no network
  requests of its own.

## Where MacDown still fits

- **Older Macs.** MacDown runs on old macOS versions; Backtickle needs macOS 14 Sonoma or later.

## Switching from MacDown

1. [Download Backtickle](https://github.com/masud90/backtickle/releases/latest) (the DMG is universal).
2. Open your files or folders; they are plain Markdown and need no conversion.
3. Pick the **Split** view for MacDown's layout. Preferences can make Backtickle the default app for `.md` files.
