/**
 * Phase 4 acceptance D01 to D07 (WP4.8a1): the Preferences window on the mock platform. Expected
 * values come from src/lib/settings-meta.ts and
 * tests/fixtures/settings-defaults.json. D08 to D10 are in tests/unit/acceptance4 and
 * src-tauri/tests/acceptance4.rs.
 */
import { expect, type Page, test } from '@playwright/test';
import {
  SETTING_CATEGORIES,
  SETTINGS_META,
  type SettingCategory,
  type SettingMeta,
  settingsIn,
} from '../../../src/lib/settings-meta';
import { at, openPrefs, row, settingsNow } from '../prefs-helpers';

const CATEGORIES = SETTING_CATEGORIES.filter((c) => c.id !== 'shortcuts');
const gotoCategory = (page: Page, id: string) => page.getByTestId(`category-${id}`).click();
const control = (page: Page, key: string) => page.getByTestId(`control-${key}`);

test.describe('D01 the window', () => {
  test('D01 six categories in order, version pill, General selected', async ({ page }) => {
    await openPrefs(page);
    expect(SETTING_CATEGORIES).toHaveLength(6);
    for (const entry of SETTING_CATEGORIES) {
      await expect(page.getByTestId(`category-${entry.id}`)).toContainText(entry.label);
    }
    const ids = await page
      .locator('[data-testid^="category-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(ids).toEqual(SETTING_CATEGORIES.map((c) => `category-${c.id}`));
    await expect(page.getByTestId('app-version')).toHaveText(/\d+\.\d+\.\d+/);
    await expect(page.getByTestId('category-general')).toHaveAttribute('aria-current', 'true');
    for (const other of SETTING_CATEGORIES.slice(1)) {
      await expect(page.getByTestId(`category-${other.id}`)).not.toHaveAttribute(
        'aria-current',
        'true',
      );
    }
  });

  for (const category of CATEGORIES) {
    test(`D01 ${category.label} lists its settings with label, description and current value`, async ({
      page,
    }) => {
      // Seed non-default values so a default painted by mistake cannot pass.
      await openPrefs(page, {
        settings: {
          editor: { tabSize: 5, softWrap: false },
          preview: { fontSize: 18, codeCards: 'light' },
          a11y: { rulerTint: 'pink' },
          recentLimit: 33,
        },
      });
      await gotoCategory(page, category.id);
      const metas = settingsIn(category.id as SettingCategory);
      await expect(page.locator('[data-setting]')).toHaveCount(metas.length);
      const settings = await settingsNow(page);
      for (const meta of metas) {
        await expect(row(page, meta.key)).toContainText(meta.label);
        await expect(row(page, meta.key)).toContainText(meta.description);
        const value = at(settings, meta.key);
        const ctl = control(page, meta.key);
        if (meta.kind === 'boolean') {
          await expect(ctl).toHaveAttribute('aria-checked', String(value));
        } else if (meta.kind === 'number') {
          const spin = ctl.getByRole('spinbutton');
          if (await spin.count()) await expect(spin).toHaveValue(String(value));
          else await expect(ctl).toHaveValue(String(value));
        } else if (meta.kind === 'choice') {
          const label = meta.choices.find((c) => c.value === value)?.label as string;
          if ((await ctl.evaluate((el) => el.tagName)) === 'SELECT') {
            await expect(ctl).toHaveValue(String(value));
          } else {
            await expect(ctl.getByRole('radio', { name: label, exact: true })).toBeChecked();
          }
        }
      }
    });
  }
});

function toggledNumber(meta: Extract<SettingMeta, { kind: 'number' }>): number {
  return Math.min(meta.max, Math.round((meta.default + meta.step) * 100) / 100);
}

test.describe('D02 every control type, pointer and keyboard', () => {
  for (const meta of SETTINGS_META.filter((m) => m.kind === 'boolean')) {
    test(`D02 switch ${meta.key}: click flips it, Space flips it back`, async ({ page }) => {
      await openPrefs(page);
      await gotoCategory(page, meta.category);
      const sw = control(page, meta.key);
      await expect(sw).toHaveAttribute('role', 'switch');
      await sw.click();
      expect(at(await settingsNow(page), meta.key)).toBe(!meta.default);
      await sw.focus();
      await page.keyboard.press('Space');
      expect(at(await settingsNow(page), meta.key)).toBe(meta.default);
    });
  }

  for (const meta of SETTINGS_META.filter((m) => m.kind === 'choice')) {
    if (meta.kind !== 'choice') continue;
    test(`D02 choice ${meta.key}: every value by pointer`, async ({ page }) => {
      await openPrefs(page);
      await gotoCategory(page, meta.category);
      const ctl = control(page, meta.key);
      const isSelect = (await ctl.evaluate((el) => el.tagName)) === 'SELECT';
      for (const choice of meta.choices) {
        if (isSelect) await ctl.selectOption(choice.value);
        else await ctl.getByRole('radio', { name: choice.label, exact: true }).click();
        expect(at(await settingsNow(page), meta.key), choice.value).toBe(choice.value);
      }
    });

    test(`D02 choice ${meta.key}: arrow keys move through the values`, async ({ page }) => {
      await openPrefs(page);
      await gotoCategory(page, meta.category);
      const ctl = control(page, meta.key);
      if ((await ctl.evaluate((el) => el.tagName)) === 'SELECT') return; // keyboard: see D02 in prefs.spec
      const values = meta.choices.map((c) => c.value);
      const start = values.indexOf(meta.default);
      await ctl
        .getByRole('radio', { name: meta.choices[start]?.label as string, exact: true })
        .focus();
      await page.keyboard.press('ArrowRight');
      expect(at(await settingsNow(page), meta.key)).toBe(values[(start + 1) % values.length]);
    });
  }

  for (const meta of SETTINGS_META.filter((m) => m.kind === 'number')) {
    if (meta.kind !== 'number') continue;
    test(`D02 number ${meta.key}: ArrowUp steps by ${meta.step}, Home and End reach the range`, async ({
      page,
    }) => {
      await openPrefs(page);
      await gotoCategory(page, meta.category);
      const ctl = control(page, meta.key);
      const spin = ctl.getByRole('spinbutton');
      const target = (await spin.count()) ? spin : ctl;
      await target.focus();
      await page.keyboard.press('ArrowUp');
      const stepped = at(await settingsNow(page), meta.key) as number;
      expect(stepped).toBeCloseTo(toggledNumber(meta), 5);
      if (!(await spin.count())) {
        await page.keyboard.press('End');
        await expect.poll(async () => at(await settingsNow(page), meta.key)).toBe(meta.max);
        await page.keyboard.press('Home');
        await expect.poll(async () => at(await settingsNow(page), meta.key)).toBe(meta.min);
      }
    });
  }

  test('D02 the main window (a second page) receives what the window stored', async ({
    page,
    context,
  }) => {
    const main = await context.newPage();
    await main.addInitScript(() => {
      window.__WRITEDOWN_MOCK_SEED__ = { launch: { welcome: true } };
    });
    await main.goto('/');
    await expect(main.getByTestId('welcome')).toBeVisible();
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    const stored = at(await settingsNow(page), 'appearance');
    expect(stored).toBe('dark');
    // The two pages hold separate mocks; deliver the stored value as settings-changed would.
    await main.evaluate(
      (appearance) => window.__WRITEDOWN_MOCK__?.settingsChanged({ appearance } as never),
      stored,
    );
    await expect(main.locator('html')).toHaveAttribute('data-theme', 'dark');
    await main.close();
  });
});

test.describe('D03 search', () => {
  const search = (page: Page, text: string) => page.getByTestId('prefs-search').fill(text);

  test('D03 "dark" finds Appearance and the results sit under a category heading', async ({
    page,
  }) => {
    await openPrefs(page);
    await search(page, 'dark');
    await expect(row(page, 'appearance')).toBeVisible();
    await expect(page.getByTestId('results-general')).toBeVisible();
  });

  test('D03 "dyslexia" finds exactly the two dyslexia rows', async ({ page }) => {
    await openPrefs(page);
    await search(page, 'dyslexia');
    const keys = await page
      .locator('[data-setting]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-setting')));
    expect(keys.sort()).toEqual(['a11y.dyslexia', 'a11y.dyslexiaFont']);
  });

  test('D03 "cmd k" in Keyboard Shortcuts finds Link', async ({ page }) => {
    await openPrefs(page);
    await gotoCategory(page, 'shortcuts');
    await search(page, 'cmd k');
    await expect(
      page.getByTestId('results-shortcuts').getByTestId('shortcut-row').filter({ hasText: 'Link' }),
    ).toHaveCount(1);
  });

  test('D03 an unknown word shows the empty message; clearing returns to the category', async ({
    page,
  }) => {
    await openPrefs(page);
    await gotoCategory(page, 'saving');
    await search(page, 'xylophone');
    await expect(page.getByTestId('no-match')).toContainText('No settings match');
    await expect(page.getByTestId('no-match')).toContainText('xylophone');
    await search(page, '');
    await expect(page.getByTestId('category-saving')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-setting]')).toHaveCount(settingsIn('saving').length);
  });
});

test.describe('D04 Cancel, Done and the close button', () => {
  async function change(page: Page) {
    await page.getByRole('radio', { name: 'Dark' }).click();
    await gotoCategory(page, 'editor');
    await control(page, 'editor.autoPair').click();
    await gotoCategory(page, 'saving');
    await control(page, 'saving.autoSave').click();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ view: { zoom: 1.3 } }));
  }

  test('D04 Cancel puts back exactly the three keys and keeps the zoom', async ({ page }) => {
    await openPrefs(page);
    await change(page);
    await page.getByTestId('prefs-cancel').click();
    const s = await settingsNow(page);
    expect(at(s, 'appearance')).toBe('system');
    expect(at(s, 'editor.autoPair')).toBe(false);
    expect(at(s, 'saving.autoSave')).toBe(false);
    expect(at(s, 'view.zoom')).toBe(1.3);
  });

  test('D04 Done keeps them', async ({ page }) => {
    await openPrefs(page);
    await change(page);
    await page.getByTestId('prefs-done').click();
    const s = await settingsNow(page);
    expect(at(s, 'appearance')).toBe('dark');
    expect(at(s, 'editor.autoPair')).toBe(true);
    expect(at(s, 'saving.autoSave')).toBe(true);
  });

  test('D04 the close shortcut keeps them (the close button is the same path)', async ({
    page,
  }) => {
    await openPrefs(page);
    await change(page);
    await page.keyboard.press('ControlOrMeta+w');
    expect(at(await settingsNow(page), 'saving.autoSave')).toBe(true);
  });

  test('D04 Escape cancels', async ({ page }) => {
    await openPrefs(page);
    await change(page);
    await page.keyboard.press('Escape');
    const s = await settingsNow(page);
    expect(at(s, 'appearance')).toBe('system');
    expect(at(s, 'saving.autoSave')).toBe(false);
    expect(at(s, 'view.zoom')).toBe(1.3);
  });
});

test.describe('D05 reset', () => {
  const nonDefault = (meta: SettingMeta): unknown => {
    switch (meta.kind) {
      case 'boolean':
        return !meta.default;
      case 'number':
        return meta.default === meta.max ? meta.min : meta.max;
      case 'choice':
        return (meta.choices.find((c) => c.value !== meta.default) as { value: string }).value;
      case 'list':
        return ['zzz'];
      case 'path':
        // Pandoc paths must be named pandoc (Rust rule); a folder path is free.
        return meta.key === 'export.pandocPath'
          ? '/Users/mock/tools/pandoc'
          : '/Users/mock/elsewhere';
    }
  };
  const nested = (key: string, value: unknown) =>
    key.split('.').reduceRight<unknown>((inner, part) => ({ [part]: inner }), value) as object;

  for (const category of CATEGORIES) {
    test(`D05 Reset ${category.label} defaults resets only its keys`, async ({ page }) => {
      await openPrefs(page);
      // Put every settings key (all categories) off its default, as another window would.
      for (const meta of SETTINGS_META) {
        await page.evaluate(
          (patch) => window.__WRITEDOWN_MOCK__?.settingsChanged(patch as never),
          nested(meta.key, nonDefault(meta)),
        );
      }
      await gotoCategory(page, category.id);
      await page.getByTestId('reset-category').click();
      const s = await settingsNow(page);
      for (const meta of SETTINGS_META) {
        if (meta.category === category.id) {
          expect(at(s, meta.key), meta.key).toEqual(meta.default);
        } else {
          expect(at(s, meta.key), meta.key).toEqual(nonDefault(meta));
        }
      }
    });
  }
});

test.describe('D06 invalid input', () => {
  for (const meta of SETTINGS_META.filter((m) => m.kind === 'number')) {
    if (meta.kind !== 'number') continue;
    test(`D06 ${meta.key}: values outside ${meta.min} to ${meta.max} are clamped on blur`, async ({
      page,
    }) => {
      await openPrefs(page);
      await gotoCategory(page, meta.category);
      const spin = control(page, meta.key).getByRole('spinbutton');
      if (!(await spin.count())) return; // sliders cannot be typed into
      await spin.fill(String(meta.max * 10 + 7));
      await spin.blur();
      await expect.poll(async () => at(await settingsNow(page), meta.key)).toBe(meta.max);
      await spin.fill(String(meta.min - 5));
      await spin.blur();
      await expect.poll(async () => at(await settingsNow(page), meta.key)).toBe(meta.min);
    });
  }

  test('D06 an ignored name containing "/" is refused with a message and not stored', async ({
    page,
  }) => {
    await openPrefs(page);
    await gotoCategory(page, 'saving');
    const before = at(await settingsNow(page), 'files.ignore');
    const list = control(page, 'files.ignore');
    await list.getByLabel('Name to ignore').fill('docs/old');
    await list.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByRole('alert')).toBeVisible();
    expect(at(await settingsNow(page), 'files.ignore')).toEqual(before);
  });
});

test.describe('D07 Choose Pandoc', () => {
  const pandocBox = (page: Page) => control(page, 'export.pandocPath');
  const answer = (page: Page, value: string | null) =>
    page.evaluate((v) => window.__WRITEDOWN_MOCK__?.setPandocAnswers(v), value);

  test('D07 refuses a file not named pandoc, Cancel changes nothing, Find automatically stores null', async ({
    page,
  }) => {
    await openPrefs(page, {
      settings: { export: { pandocPath: '/Users/mock/tools/pandoc' } },
      pandoc: { path: '/opt/homebrew/bin/pandoc', version: '3.8.3' },
    });
    await gotoCategory(page, 'preview');
    const box = pandocBox(page);
    await answer(page, '/Users/mock/tools/not-pandoc');
    await box.getByRole('button', { name: 'Choose…' }).click();
    await expect(box.getByRole('alert')).toBeVisible();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBe('/Users/mock/tools/pandoc');
    await answer(page, null);
    await box.getByRole('button', { name: 'Choose…' }).click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBe('/Users/mock/tools/pandoc');
    await box.getByRole('button', { name: 'Find automatically' }).click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBeNull();
  });
});
