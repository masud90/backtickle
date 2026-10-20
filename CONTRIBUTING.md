# Contributing

Issues and pull requests are welcome.

## Finding something to work on

- The [roadmap](ROADMAP.md) lists what is planned next, with an issue for each item.
- Issues labeled [good first issue](https://github.com/masud90/backtickle/labels/good%20first%20issue) are small
  and say where in the code to look. [packaging](https://github.com/masud90/backtickle/labels/packaging) issues
  mostly need no Rust or Svelte.
- Comment on an issue before you start, so two people don't do the same work. For a larger change, agree on the
  approach in the issue first.
- Bug reports, rendering problems and feature ideas each have a form under
  [New issue](https://github.com/masud90/backtickle/issues/new/choose).

## Principles

- Nothing in a document is ever executed: no MDX components, no R or Python chunks, no scripts.
- The app makes no network requests of its own, with one exception: the daily update check
  (`src/shell/update.ts`), which asks GitHub for the newest release and can be turned off in Preferences.
  Don't add another.
- Keep memory use low. Load heavy features lazily, only when a document needs them.
- New dependencies must be under MIT, Apache-2.0, ISC, BSD or a similar permissive license.
  Regenerate `THIRD_PARTY_NOTICES.md` with `node scripts/third-party-notices.mjs` when they change.

## Before opening a pull request

```sh
npm ci
node scripts/gen-large-doc.mjs --size 100k   # fixtures used by some tests
npm run check          # typecheck, lint, unit tests
npm run test:rust      # Rust tests
npm run test:ui        # Playwright on WebKit (needs: npx playwright install webkit)
```

`npm run test:fidelity` and `npm run test:pandoc` compare output with Pandoc and need Pandoc installed.
Visual baselines under `tests/ui` are regenerated with `--update-snapshots` after a deliberate change;
review the images before committing them.

Run the UI tests with the screen unlocked. A locked screen or sleeping display suspends WebKit
timers and makes runs invalid.
