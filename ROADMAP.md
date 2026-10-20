# Roadmap

Where Backtickle is going next. Each item has an issue with the details; comment there if you want to help
or have a view on how it should work. The order is a rough priority, not a promise of dates.

Four principles hold for everything below: nothing in a document is ever executed, the app makes no network
requests of its own besides the update check, memory use stays low, and dependencies use permissive licenses
([CONTRIBUTING.md](CONTRIBUTING.md)).

## Now

| | Item | Issue |
| --- | --- | --- |
| 1 | **Signed builds for macOS and Windows.** No more "Apple could not verify" or SmartScreen warnings on first launch. The release workflow already signs and notarizes for macOS once the Apple secrets exist; Windows needs a certificate and a signing step. | [#7](https://github.com/masud90/backtickle/issues/7) |
| 2 | **Complete live preview in the editor.** Tables, math, code blocks, wikilinks, callouts and footnotes drawn in place, as headings, emphasis, links and images already are. | [#8](https://github.com/masud90/backtickle/issues/8) |
| 3 | **Easy table editing.** Tab between cells, columns that line up by themselves, commands to add and remove rows and columns. | [#9](https://github.com/masud90/backtickle/issues/9) |
| 4 | **UI tests in CI, and no more flaky tests.** Run the Playwright and accessibility suite on every pull request and make the file-watcher tests deterministic. | [#10](https://github.com/masud90/backtickle/issues/10) |

## Next

| | Item | Issue |
| --- | --- | --- |
| 5 | **Package managers and ARM builds.** Homebrew, winget, the AUR, Flathub and Scoop, so installs and updates take one command and the app itself never touches the network. Windows on ARM and Linux ARM builds. | [#11](https://github.com/masud90/backtickle/issues/11) |
| 6 | **Linking between notes.** A backlinks panel, `[[` autocomplete for notes and headings, and link updates on rename. | [#12](https://github.com/masud90/backtickle/issues/12) |
| 7 | **Optional Vim mode.** Off by default, loaded only when turned on. | [#13](https://github.com/masud90/backtickle/issues/13) |
| 8 | **The interface in more languages.** Translatable menus, Preferences and messages, following the system language. | [#14](https://github.com/masud90/backtickle/issues/14) |

## Good places to start

Issues labeled [good first issue](https://github.com/masud90/backtickle/labels/good%20first%20issue) are small and
self-contained, and say where in the code to look. Packaging work is labeled
[packaging](https://github.com/masud90/backtickle/labels/packaging) and mostly needs no Rust or Svelte at all.

## Shipped

- **0.1.1 and 0.1.2** (October 2026): Windows and Linux builds alongside macOS in one release, paste and drop
  images, live preview in the editor, macOS 14 Sonoma support, and fixes for blank tabs and missing list
  markers.
- **0.1.0** (October 2026): first release, for macOS.

See [CHANGELOG.md](CHANGELOG.md) for the details.
