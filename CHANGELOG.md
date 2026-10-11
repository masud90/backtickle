# Changelog

## 0.1.0 (2026-10-11)

First release.

- Markdown flavors: CommonMark, GitHub Flavored Markdown, Obsidian, Pandoc / MultiMarkdown,
  Quarto / R Markdown and MDX, detected per document and overridable. Nothing in a document is executed.
- Editor (CodeMirror 6) and preview in one window with tabs; Editor, Split and Preview views; synced scrolling;
  document outline; status bar with words, characters and reading time.
- Writing tools: formatting commands, list continuation, find and replace, smart paste (web, Word and
  Excel content becomes Markdown), snippets, typewriter scrolling, reading ruler, focus-line spotlight.
- Preview: math (KaTeX as MathML), Mermaid and Graphviz diagrams, code cards, citations and bibliographies,
  wikilinks, callouts, Quarto cross-references, exact preview through Pandoc.
- Files and search: folder sidebar with file operations, folder search, Quick Open, command palette,
  external change detection, session restore, crash recovery.
- Export: HTML, one-click PDF, print, Copy as HTML, Word through Pandoc, Render with Quarto.
- Windows and tabs: several document windows, Move Tab to New Window, Dock recents.
- Preferences window with editable keyboard shortcuts.
- Accessibility: dyslexia-friendly reading, reduce motion, high-contrast dividers, interface scale,
  keyboard access throughout; checked with axe against WCAG 2.2 AA.
- Safety and privacy: sanitized preview, strict content security policy, no network requests of its own,
  remote images can be turned off.
- Universal DMG (Apple Silicon and Intel), not signed or notarized. Requires macOS 26 or later.
