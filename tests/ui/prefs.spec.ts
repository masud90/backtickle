/**
 * Preferences window, WP4.1: D01 to D08 on the mock platform.
 * Expected values come from `src/lib/settings-meta.ts` and the spec, not from the window.
 */
import { expect, test } from '@playwright/test';
import {
  SETTING_CATEGORIES,
  SETTINGS_META,
  type SettingMeta,
  settingsIn,
} from '../../src/lib/settings-meta';
import { at, openPrefs, row, settingsNow } from './prefs-helpers';

const CATEGORY_IDS = SETTING_CATEGORIES.map((entry) => entry.id);

test.describe('D01 the window', () => {
  test('D01 shows six categories, the version, General selected', async ({ page }) => {
    await openPrefs(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Preferences' })).toBeVisible();
    await expect(page.getByTestId('app-version')).toHaveText('0.0.0-mock');
    for (const entry of SETTING_CATEGORIES) {
      await expect(page.getByTestId(`category-${entry.id}`)).toContainText(entry.label);
    }
    await expect(page.getByTestId('category-general')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByRole('heading', { level: 2, name: 'General' })).toBeVisible();
  });

  for (const category of CATEGORY_IDS.filter((id) => id !== 'shortcuts')) {
    test(`D01 ${category} lists every setting of the table with its value`, async ({ page }) => {
      await openPrefs(page);
      await page.getByTestId(`category-${category}`).click();
      const metas = settingsIn(category as never);
      expect(metas.length).toBeGreaterThan(0);
      await expect(page.locator('[data-setting]')).toHaveCount(metas.length);
      const settings = await settingsNow(page);
      for (const meta of metas) {
        const current = at(settings, meta.key);
        await expect(row(page, meta.key)).toBeVisible();
        await expect(row(page, meta.key)).toContainText(meta.label);
        await expectShowsValue(page, meta, current);
      }
    });
  }

  test('D01 every setting of the table is in some category list', async ({ page }) => {
    await openPrefs(page);
    let total = 0;
    for (const category of CATEGORY_IDS.filter((id) => id !== 'shortcuts')) {
      await page.getByTestId(`category-${category}`).click();
      total += await page.locator('[data-setting]').count();
    }
    expect(total).toBe(SETTINGS_META.length);
  });
});

async function expectShowsValue(
  page: import('@playwright/test').Page,
  meta: SettingMeta,
  value: unknown,
) {
  const control = page.getByTestId(`control-${meta.key}`);
  switch (meta.kind) {
    case 'boolean':
      await expect(control).toHaveAttribute('aria-checked', String(value));
      break;
    case 'choice': {
      const label = meta.choices.find((choice) => choice.value === value)?.label as string;
      const tag = await control.evaluate((el) => el.tagName);
      if (tag === 'SELECT') await expect(control).toHaveValue(String(value));
      else await expect(control.getByRole('radio', { name: label })).toBeChecked();
      break;
    }
    case 'number': {
      const spin = control.getByRole('spinbutton');
      if (await spin.count()) await expect(spin).toHaveValue(String(value));
      else
        await expect(
          control.locator('output').or(control.locator('..').locator('output')),
        ).toBeVisible();
      break;
    }
    case 'list':
      for (const name of value as string[]) {
        await expect(control.getByRole('listitem').filter({ hasText: name })).toHaveCount(1);
      }
      break;
    case 'path':
      await expect(page.getByTestId(`control-${meta.key}-value`)).toBeVisible();
      break;
  }
}

test.describe('D02 controls', () => {
  test('D02 switch: pointer and Space', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-editor').click();
    const sw = page.getByTestId('control-editor.softWrap');
    await expect(sw).toHaveAttribute('role', 'switch');
    const before = at(await settingsNow(page), 'editor.softWrap') as boolean;
    await sw.click();
    expect(at(await settingsNow(page), 'editor.softWrap')).toBe(!before);
    await sw.focus();
    await page.keyboard.press('Space');
    expect(at(await settingsNow(page), 'editor.softWrap')).toBe(before);
    await expect(sw).toHaveAttribute('aria-checked', String(before));
  });

  test('D02 segmented control: pointer and arrow keys', async ({ page }) => {
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    expect(at(await settingsNow(page), 'appearance')).toBe('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Dark' }).focus();
    await page.keyboard.press('ArrowLeft');
    expect(at(await settingsNow(page), 'appearance')).toBe('light');
    await expect(page.getByRole('radio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    expect(at(await settingsNow(page), 'appearance')).toBe('system');
    // Wraps around.
    await page.keyboard.press('ArrowLeft');
    expect(at(await settingsNow(page), 'appearance')).toBe('dark');
    // Only the selected radio is in the tab order.
    await expect(page.getByRole('radio', { name: 'Light' })).toHaveAttribute('tabindex', '-1');
  });

  test('D02 select: pointer and keyboard', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-preview').click();
    const select = page.getByTestId('control-defaultFlavor');
    await select.selectOption('commonmark');
    expect(at(await settingsNow(page), 'defaultFlavor')).toBe('commonmark');
    await select.focus();
    // Type-ahead changes a closed select without a pointer (ArrowDown opens the menu on macOS).
    await page.keyboard.type('Obsidian');
    await expect.poll(async () => at(await settingsNow(page), 'defaultFlavor')).toBe('obsidian');
  });

  test('D02 number stepper: buttons, arrow keys, typed value', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-editor').click();
    const box = page.getByTestId('control-editor.tabSize');
    const spin = box.getByRole('spinbutton');
    await expect(spin).toHaveValue('2');
    await box.getByRole('button', { name: 'Increase' }).click();
    expect(at(await settingsNow(page), 'editor.tabSize')).toBe(3);
    await spin.focus();
    await page.keyboard.press('ArrowUp');
    expect(at(await settingsNow(page), 'editor.tabSize')).toBe(4);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(at(await settingsNow(page), 'editor.tabSize')).toBe(2);
    await spin.fill('6');
    await spin.press('Enter');
    expect(at(await settingsNow(page), 'editor.tabSize')).toBe(6);
    await expect(spin).toHaveAttribute('aria-valuemin', '1');
    await expect(spin).toHaveAttribute('aria-valuemax', '8');
    // A one-decimal step.
    const line = page.getByTestId('control-editor.lineHeight');
    await line.getByRole('button', { name: 'Increase' }).click();
    expect(at(await settingsNow(page), 'editor.lineHeight')).toBe(1.8);
  });

  test('D02 slider shows its value; keyboard and pointer change it', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-preview').click();
    const slider = page.getByTestId('control-preview.fontSize');
    await expect(slider).toHaveAttribute('aria-valuetext', '15 px');
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => at(await settingsNow(page), 'preview.fontSize')).toBe(16);
    await expect(slider).toHaveAttribute('aria-valuetext', '16 px');
    // Pointer: click in the middle of the track (12 to 28: the middle is 20).
    const box = (await slider.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => at(await settingsNow(page), 'preview.fontSize') as number)
      .toBeGreaterThanOrEqual(19);
    await page.getByTestId('category-accessibility').click();
    const scale = page.getByTestId('control-a11y.scale');
    await expect(scale).toHaveAttribute('aria-valuetext', '100%');
    await scale.focus();
    await page.keyboard.press('End');
    await expect.poll(async () => at(await settingsNow(page), 'a11y.scale')).toBe(1.5);
    await expect(scale).toHaveAttribute('aria-valuetext', '150%');
  });

  test('D02 color swatches: named radios, pointer and arrow keys', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-accessibility').click();
    const group = page.getByTestId('control-a11y.rulerTint');
    for (const name of ['Yellow', 'Blue', 'Green', 'Pink']) {
      await expect(group.getByRole('radio', { name })).toBeVisible();
    }
    await group.getByRole('radio', { name: 'Green' }).click();
    expect(at(await settingsNow(page), 'a11y.rulerTint')).toBe('green');
    await page.keyboard.press('ArrowRight');
    expect(at(await settingsNow(page), 'a11y.rulerTint')).toBe('pink');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    expect(at(await settingsNow(page), 'a11y.rulerTint')).toBe('blue');
  });

  test('D02 ignored names: add with the button and Return, remove', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-saving').click();
    const list = page.getByTestId('control-files.ignore');
    await list.getByLabel('Name to ignore').fill('build');
    await list.getByRole('button', { name: 'Add' }).click();
    expect(at(await settingsNow(page), 'files.ignore')).toContain('build');
    await list.getByLabel('Name to ignore').fill('dist');
    await page.keyboard.press('Enter');
    expect(at(await settingsNow(page), 'files.ignore')).toContain('dist');
    await list.getByRole('button', { name: 'Remove build' }).click();
    expect(at(await settingsNow(page), 'files.ignore')).not.toContain('build');
    await expect(list.getByRole('listitem').filter({ hasText: 'build' })).toHaveCount(0);
  });

  test('D02 the main window hears the change through settings-changed', async ({ page }) => {
    await openPrefs(page);
    // On the mock the Preferences page and the "main window" share one platform.
    await page.getByRole('radio', { name: 'Light' }).click();
    expect(at(await settingsNow(page), 'appearance')).toBe('light');
    // A change made elsewhere shows up in the window.
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ appearance: 'dark' }));
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  });
});

test.describe('D03 search', () => {
  test('D03 "dark" finds Appearance', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('prefs-search').fill('dark');
    await expect(page.getByTestId('results-general')).toBeVisible();
    await expect(row(page, 'appearance')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible();
  });

  test('D03 "dyslexia" finds two rows', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('prefs-search').fill('dyslexia');
    await expect(page.locator('[data-setting]')).toHaveCount(2);
    await expect(row(page, 'a11y.dyslexia')).toBeVisible();
    await expect(row(page, 'a11y.dyslexiaFont')).toBeVisible();
    // Categories without a match are dimmed.
    await expect(page.getByTestId('category-general')).toHaveClass(/dimmed/);
    await expect(page.getByTestId('category-accessibility')).not.toHaveClass(/dimmed/);
  });

  test('D03 search ignores case and accents', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('prefs-search').fill('DYSLÉXIA');
    await expect(page.locator('[data-setting]')).toHaveCount(2);
  });

  test('D03 "cmd k" in Keyboard Shortcuts finds Link', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-shortcuts').click();
    await page.getByTestId('prefs-search').fill('cmd k');
    const results = page.getByTestId('results-shortcuts');
    await expect(results).toBeVisible();
    await expect(results.getByTestId('shortcut-row').filter({ hasText: 'Link' })).toHaveCount(1);
    await page.getByTestId('prefs-search').fill('⌘K');
    await expect(results.getByTestId('shortcut-row').filter({ hasText: 'Link' })).toHaveCount(1);
  });

  test('D03 an unknown word shows the empty message; clearing returns', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-editor').click();
    await page.getByTestId('prefs-search').fill('qqqzzz');
    await expect(page.getByTestId('no-match')).toHaveText('No settings match "qqqzzz"');
    await page.getByTestId('prefs-search').fill('');
    await expect(page.getByRole('heading', { level: 2, name: 'Editor' })).toBeVisible();
    await expect(page.getByTestId('category-editor')).toHaveAttribute('aria-current', 'true');
  });

  test('D03 Command-F focuses the search field', async ({ page }) => {
    await openPrefs(page);
    await page.keyboard.press('ControlOrMeta+f');
    await expect(page.getByTestId('prefs-search')).toBeFocused();
  });
});

test.describe('D04 Cancel and Done', () => {
  test('D04 Cancel restores the three changed keys and leaves a zoom change alone', async ({
    page,
  }) => {
    await openPrefs(page);
    const before = await settingsNow(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByTestId('category-editor').click();
    await page
      .getByTestId('control-editor.fontSize')
      .getByRole('button', { name: 'Increase' })
      .click();
    await page.getByTestId('category-accessibility').click();
    await page.getByTestId('control-a11y.ruler').click();
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.settingsChanged({ view: { zoom: 1.4 } }));
    const during = await settingsNow(page);
    expect(at(during, 'appearance')).toBe('dark');
    expect(at(during, 'editor.fontSize')).toBe((at(before, 'editor.fontSize') as number) + 1);
    expect(at(during, 'a11y.ruler')).toBe(true);
    await page.getByTestId('prefs-cancel').click();
    const after = await settingsNow(page);
    expect(at(after, 'appearance')).toBe(at(before, 'appearance'));
    expect(at(after, 'editor.fontSize')).toBe(at(before, 'editor.fontSize'));
    expect(at(after, 'a11y.ruler')).toBe(at(before, 'a11y.ruler'));
    expect(at(after, 'view.zoom')).toBe(1.4);
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'cancel');
  });

  test('D04 Cancel after a change and a change back sends nothing wrong', async ({ page }) => {
    await openPrefs(page);
    const before = await settingsNow(page);
    await page.getByTestId('control-restoreSession').click();
    await page.getByTestId('control-restoreSession').click();
    await page.getByTestId('prefs-cancel').click();
    expect(await settingsNow(page)).toEqual(before);
  });

  test('D04 Done keeps the changes', async ({ page }) => {
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByTestId('prefs-done').click();
    expect(at(await settingsNow(page), 'appearance')).toBe('dark');
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'done');
  });

  test('D04 the close button (window gone, no Cancel) and Command-W keep the changes', async ({
    page,
  }) => {
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Light' }).click();
    await page.keyboard.press('ControlOrMeta+w');
    expect(at(await settingsNow(page), 'appearance')).toBe('light');
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'done');
  });

  test('D04 Escape cancels', async ({ page }) => {
    await openPrefs(page);
    const before = await settingsNow(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.keyboard.press('Escape');
    expect(at(await settingsNow(page), 'appearance')).toBe(at(before, 'appearance'));
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'cancel');
  });

  test('D04 Return in a non-text control is Done', async ({ page }) => {
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.keyboard.press('Enter');
    expect(at(await settingsNow(page), 'appearance')).toBe('dark');
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'done');
  });
});

test.describe('D05 reset', () => {
  test('D05 "Reset Editor defaults" resets only the Editor keys', async ({ page }) => {
    await openPrefs(page);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByTestId('category-editor').click();
    await page.getByTestId('control-editor.softWrap').click();
    await page.getByTestId('control-editor.autoPair').click();
    await page
      .getByTestId('control-editor.tabSize')
      .getByRole('button', { name: 'Increase' })
      .click();
    await page
      .getByTestId('control-editor.lineHeight')
      .getByRole('button', { name: 'Increase' })
      .click();
    await page.getByRole('button', { name: 'Reset Editor defaults' }).click();
    const settings = await settingsNow(page);
    for (const meta of settingsIn('editor')) {
      expect(at(settings, meta.key), meta.key).toEqual(meta.default);
    }
    expect(at(settings, 'appearance')).toBe('dark');
    await expect(page.getByTestId('control-editor.autoPair')).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('D05 a reset puts a list and a path back too', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-saving').click();
    const list = page.getByTestId('control-files.ignore');
    await list.getByLabel('Name to ignore').fill('build');
    await list.getByRole('button', { name: 'Add' }).click();
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setDefaultFolderAnswers('/Users/mock/Docs'),
    );
    await page
      .getByTestId('control-saving.defaultFolder')
      .getByRole('button', { name: 'Choose…' })
      .click();
    expect(at(await settingsNow(page), 'saving.defaultFolder')).toBe('/Users/mock/Docs');
    await page.getByRole('button', { name: 'Reset Files & Saving defaults' }).click();
    const settings = await settingsNow(page);
    for (const meta of settingsIn('saving')) {
      expect(at(settings, meta.key), meta.key).toEqual(meta.default);
    }
  });
});

test.describe('D06 invalid input', () => {
  test('D06 a number outside its range is clamped on blur', async ({ page }) => {
    await openPrefs(page);
    const spin = page.getByTestId('control-readingWpm').getByRole('spinbutton');
    await spin.fill('5000');
    await page.getByTestId('category-editor').focus();
    await expect(spin).toHaveValue('1000');
    expect(at(await settingsNow(page), 'readingWpm')).toBe(1000);
    await spin.fill('3');
    await spin.blur();
    await expect(spin).toHaveValue('50');
    expect(at(await settingsNow(page), 'readingWpm')).toBe(50);
    // Text that is not a number puts the old value back.
    await spin.fill('abc');
    await spin.blur();
    await expect(spin).toHaveValue('50');
  });

  test('D06 an ignored name with a slash shows a message and is not stored', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-saving').click();
    const before = at(await settingsNow(page), 'files.ignore');
    const list = page.getByTestId('control-files.ignore');
    await list.getByLabel('Name to ignore').fill('a/b');
    await list.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByRole('alert')).toContainText('slash');
    expect(at(await settingsNow(page), 'files.ignore')).toEqual(before);
    await list.getByLabel('Name to ignore').fill('');
    await list.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByRole('alert')).toContainText('Enter a file or folder name');
    await list.getByLabel('Name to ignore').fill('node_modules');
    await list.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByRole('alert')).toContainText('already in the list');
  });
});

test.describe('D07 Pandoc path', () => {
  test('D07 a file not named pandoc is refused; Cancel changes nothing; Find automatically stores null', async ({
    page,
  }) => {
    await openPrefs(page, { pandoc: { path: '/opt/homebrew/bin/pandoc', version: '3.8.3' } });
    await page.getByTestId('category-preview').click();
    const box = page.getByTestId('control-export.pandocPath');
    await expect(box).toContainText('Found automatically: /opt/homebrew/bin/pandoc');
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setPandocAnswers('/Users/mock/bin/notpandoc'),
    );
    await box.getByRole('button', { name: 'Choose…' }).click();
    await expect(box.getByRole('alert')).toContainText('not Pandoc');
    expect(at(await settingsNow(page), 'export.pandocPath')).toBeNull();
    // Cancel in the file sheet.
    await page.evaluate(() => window.__WRITEDOWN_MOCK__?.setPandocAnswers(null));
    await box.getByRole('button', { name: 'Choose…' }).click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBeNull();
    await expect(box.getByRole('alert')).toHaveCount(0);
    // A real choice.
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setPandocAnswers('/Users/mock/tools/pandoc'),
    );
    await box.getByRole('button', { name: 'Choose…' }).click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBe('/Users/mock/tools/pandoc');
    await expect(page.getByTestId('control-export.pandocPath-value')).toHaveText('~/tools/pandoc');
    await box.getByRole('button', { name: 'Find automatically' }).click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBeNull();
    await expect(box).toContainText('Found automatically');
  });

  test('D07 Cancel in Preferences puts back a Pandoc chosen here', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-preview').click();
    await page.evaluate(() =>
      window.__WRITEDOWN_MOCK__?.setPandocAnswers('/Users/mock/tools/pandoc'),
    );
    await page
      .getByTestId('control-export.pandocPath')
      .getByRole('button', { name: 'Choose…' })
      .click();
    await expect
      .poll(async () => at(await settingsNow(page), 'export.pandocPath'))
      .toBe('/Users/mock/tools/pandoc');
    await page.getByTestId('prefs-cancel').click();
    expect(at(await settingsNow(page), 'export.pandocPath')).toBeNull();
  });
});

test.describe('D08 Keyboard Shortcuts', () => {
  test('D08 lists the menu accelerators and the editing keys, grouped', async ({ page }) => {
    await openPrefs(page);
    await page.getByTestId('category-shortcuts').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Keyboard Shortcuts' })).toBeVisible();
    const rows = page.getByTestId('shortcut-row');
    await expect(rows.filter({ hasText: 'Quick Open' }).locator('kbd')).toHaveText('⇧⌘O');
    await expect(rows.filter({ hasText: 'Show or Hide Sidebar' }).locator('kbd')).toHaveText('⌃⌘S');
    await expect(rows.filter({ hasText: 'Settings' }).locator('kbd')).toHaveText('⌘,');
    await expect(rows.filter({ hasText: 'Move line up' }).locator('kbd')).toHaveText('⌥↑');
    for (const group of ['File', 'Edit', 'Format', 'View', 'Window', 'Editing']) {
      await expect(page.getByTestId(`shortcuts-${group}`)).toBeVisible();
    }
  });

  test('D08 General shows the reading-time formula', async ({ page }) => {
    await openPrefs(page);
    await expect(page.getByTestId('reading-formula')).toContainText('Words ÷ 238 words per minute');
    await expect(page.getByTestId('reading-formula')).toContainText('Brysbaert');
  });
});

test.describe('WP4.6 search field and category list', () => {
  test('Escape in the search field with text clears it and keeps the focus; empty it cancels', async ({
    page,
  }) => {
    await openPrefs(page);
    const search = page.getByTestId('prefs-search');
    await search.click();
    await search.fill('font');
    await expect(page.getByTestId('no-match')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator('body')).not.toHaveAttribute('data-prefs-closed', /.*/);
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-prefs-closed', 'cancel');
  });

  test('"Markdown & Preview" stays on one line at the default 960 px window', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await openPrefs(page);
    const label = page.getByTestId('category-preview').locator('span');
    const box = await label.boundingBox();
    const line = await label.evaluate((el) => Number.parseFloat(getComputedStyle(el).lineHeight));
    expect(box?.height ?? 0).toBeLessThanOrEqual(line + 1);
  });
});
