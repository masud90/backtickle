/** Helpers of the Phase 4 accessibility audit (WP4.5). */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import type { MockSeed } from '../../../src/lib/platform-mock';
import { expect, launch, menu, VAULT_ROOT, vaultSeed } from '../acceptance2/support-b2';
import { openPrefs } from '../prefs-helpers';

export { expect, launch, menu, openPrefs };

export const DOCS = '/Users/mock/docs';
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export interface Config {
  name: string;
  scheme: 'light' | 'dark';
  a11y: Record<string, unknown>;
}

/** Light and dark, each at scale 1.0, scale 1.5 and with dyslexia mode on. */
export const CONFIGS: Config[] = (['light', 'dark'] as const).flatMap((scheme) => [
  { name: `${scheme} 1.0`, scheme, a11y: { scale: 1 } },
  { name: `${scheme} 1.5`, scheme, a11y: { scale: 1.5 } },
  { name: `${scheme} dyslexia`, scheme, a11y: { dyslexia: true } },
]);

/** Zero violations of WCAG 2.0 to 2.2 A and AA. */
export async function violations(
  page: Page,
  include?: string,
  disable: string[] = [],
): Promise<string[]> {
  await expect
    .poll(() =>
      page
        .locator(
          '[data-testid="preview"] :is(.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-failed), .graphviz-diagram:not(.graphviz-rendered):not(.graphviz-failed))',
        )
        .count(),
    )
    .toBe(0);
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (disable.length > 0) builder = builder.disableRules(disable);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help} (${v.nodes.length} nodes, first: ${v.nodes[0]?.target.join(' ')})`,
  );
}

export const FLAVOR_DOCS: Record<string, string> = {
  gfm: `${DOCS}/start.md`,
  mdx: `${DOCS}/start.mdx`,
  quarto: `${DOCS}/start.qmd`,
};

/** Opens the main window with a document and the given settings. */
export async function openMain(
  page: Page,
  config: Config,
  options: { path?: string; view?: 'editor' | 'split' | 'preview'; seed?: MockSeed } = {},
): Promise<void> {
  await page.emulateMedia({ colorScheme: config.scheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 820 });
  const path = options.path ?? `${DOCS}/start.md`;
  const seed = options.seed ?? {
    files: {
      [path]:
        '# Title\n\nText with a [link](https://example.org).\n\n- [ ] task\n\n```js\nlet x = 1;\n```\n',
    },
  };
  await launch(page, {
    seed: { ...seed, settings: { a11y: config.a11y } },
    open: path,
    view: options.view ?? 'split',
  });
}

export async function openPrefsWith(page: Page, config: Config): Promise<void> {
  await page.emulateMedia({ colorScheme: config.scheme, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 960, height: 720 });
  await openPrefs(page, { settings: { a11y: config.a11y } } as MockSeed);
}

export { VAULT_ROOT, vaultSeed };
