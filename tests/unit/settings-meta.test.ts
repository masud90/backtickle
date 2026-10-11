import { describe, expect, it } from 'vitest';
import { defaultSettings, mergeSettings } from '@/lib/platform-mock';
import {
  INTERNAL_SETTING_KEYS,
  SETTING_CATEGORIES,
  SETTINGS_META,
  searchSettings,
  settingMeta,
} from '@/lib/settings-meta';
import fixture from '../fixtures/settings-defaults.json';

/** Leaf key paths of a settings object (arrays and null are leaves). */
function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [prefix];
  if (Object.keys(value).length === 0) return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    leaves(inner, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as never)?.[key], source);
}

describe('shared settings defaults (the fixture that settings.rs also checks)', () => {
  it('the mock defaults equal the fixture', () => {
    expect(defaultSettings()).toEqual(fixture);
  });

  it('merging the fixture over the defaults changes nothing', () => {
    expect(mergeSettings(defaultSettings(), fixture)).toEqual(defaultSettings());
  });
});

describe('mock validation of the new keys (same rules as settings.rs)', () => {
  const base = defaultSettings();

  it('clamps numbers and rejects wrong types', () => {
    const low = mergeSettings(base, {
      editor: { lineHeight: 0 },
      preview: { fontSize: 1, columnWidth: 1 },
      a11y: { scale: 0 },
    });
    expect([low.editor.lineHeight, low.preview.fontSize, low.preview.columnWidth]).toEqual([
      1.2, 12, 560,
    ]);
    expect(low.a11y.scale).toBe(1);

    const high = mergeSettings(base, {
      editor: { lineHeight: 10 },
      preview: { fontSize: 100, columnWidth: 9999 },
      a11y: { scale: 9 },
    });
    expect([high.editor.lineHeight, high.preview.fontSize, high.preview.columnWidth]).toEqual([
      2.4, 28, 1040,
    ]);
    expect(high.a11y.scale).toBe(1.5);

    const wrong = mergeSettings(base, {
      editor: { lineHeight: 'x', autoPair: 1, fontFamily: 'comic' },
      preview: { font: 'papyrus', math: 'no', codeCards: 'grey' },
      a11y: { reduceMotion: true, rulerTint: 'red', scale: null },
      saving: { autoSave: 'yes', newLineEnding: 'cr', defaultFolder: 'relative' },
    });
    expect(wrong).toEqual(base);
  });

  it('keeps an absolute default folder and clears it with null', () => {
    const set = mergeSettings(base, { saving: { defaultFolder: '/Users/x/Notes' } });
    expect(set.saving.defaultFolder).toBe('/Users/x/Notes');
    expect(mergeSettings(set, { saving: { defaultFolder: null } }).saving.defaultFolder).toBeNull();
    expect(mergeSettings(set, { saving: { defaultFolder: 'rel' } }).saving.defaultFolder).toBe(
      '/Users/x/Notes',
    );
  });
});

describe('settings meta table', () => {
  const defaults = defaultSettings();
  const stored = leaves(defaults);

  it('has every settings key except the internal ones, and nothing else', () => {
    const internal = new Set(INTERNAL_SETTING_KEYS);
    const expected = stored.filter((key) => !internal.has(key)).sort();
    const described = SETTINGS_META.map((meta) => meta.key).sort();

    expect(described).toEqual(expected);
    for (const key of INTERNAL_SETTING_KEYS) expect(stored).toContain(key);
    expect(new Set(described).size).toBe(described.length);
  });

  it('lists the internal keys', () => {
    expect([...INTERNAL_SETTING_KEYS].sort()).toEqual([
      'shortcuts',
      'version',
      'view.sidebarVisible',
      'view.sidebarWidth',
      'view.splitRatio',
      'view.syncScroll',
      'view.zoom',
    ]);
  });

  it('every default equals the default settings and lies in its range or choices', () => {
    for (const meta of SETTINGS_META) {
      expect(meta.default, meta.key).toEqual(valueAt(defaults, meta.key));
      if (meta.kind === 'number') {
        expect(meta.default).toBeGreaterThanOrEqual(meta.min);
        expect(meta.default).toBeLessThanOrEqual(meta.max);
        expect(meta.step).toBeGreaterThan(0);
      }
      if (meta.kind === 'choice') {
        expect(
          meta.choices.map((choice) => choice.value),
          meta.key,
        ).toContain(meta.default);
        expect(new Set(meta.choices.map((choice) => choice.value)).size).toBe(meta.choices.length);
      }
    }
  });

  it('the range and choices are the ones the mock enforces', () => {
    for (const meta of SETTINGS_META) {
      if (meta.kind === 'number') {
        const patch = (value: number) => {
          const [group, name] = meta.key.includes('.') ? meta.key.split('.') : [null, meta.key];
          return group ? { [group]: { [name]: value } } : { [name]: value };
        };
        const low = mergeSettings(defaults, patch(meta.min - 1000));
        const high = mergeSettings(defaults, patch(meta.max + 1000));
        expect(valueAt(low, meta.key), meta.key).toBe(meta.min);
        expect(valueAt(high, meta.key), meta.key).toBe(meta.max);
      }
      if (meta.kind === 'choice') {
        for (const choice of meta.choices) {
          const [group, name] = meta.key.includes('.') ? meta.key.split('.') : [null, meta.key];
          const patch = group ? { [group]: { [name]: choice.value } } : { [name]: choice.value };
          expect(valueAt(mergeSettings(defaults, patch), meta.key), meta.key).toBe(choice.value);
        }
      }
    }
  });

  it('has text for every setting: sentence case labels, no em-dashes or en-dashes', () => {
    const categories = new Set(SETTING_CATEGORIES.map((category) => category.id));
    for (const meta of SETTINGS_META) {
      expect(categories.has(meta.category), meta.key).toBe(true);
      expect(meta.label.length, meta.key).toBeGreaterThan(0);
      expect(meta.description.length, meta.key).toBeGreaterThan(0);
      expect(meta.keywords.length, meta.key).toBeGreaterThan(0);
      const text = [
        meta.label,
        meta.description,
        ...meta.keywords,
        ...(meta.kind === 'choice' ? meta.choices.map((choice) => choice.label) : []),
      ].join(' ');
      expect(text, meta.key).not.toMatch(/[–—]/);
      expect(meta.description, meta.key).not.toContain('\n');
    }
    for (const category of SETTING_CATEGORIES) expect(category.label).not.toMatch(/[–—]/);
  });

  it('has the six categories of the wireframe in order', () => {
    expect(SETTING_CATEGORIES.map((category) => category.label)).toEqual([
      'General',
      'Editor',
      'Markdown & Preview',
      'Accessibility',
      'Files & Saving',
      'Keyboard Shortcuts',
    ]);
  });

  it('puts each setting in the category of the spec table', () => {
    const expected: Record<string, string> = {
      appearance: 'general',
      readingWpm: 'general',
      'editor.fontFamily': 'editor',
      'editor.paneHeaders': 'editor',
      defaultFlavor: 'preview',
      'preview.codeCards': 'preview',
      'export.pandocPath': 'preview',
      'a11y.scale': 'accessibility',
      'saving.defaultFolder': 'saving',
      'files.ignore': 'saving',
    };
    for (const [key, category] of Object.entries(expected)) {
      expect(settingMeta(key)?.category, key).toBe(category);
    }
  });

  it('finds settings by label, keyword and category', () => {
    expect(searchSettings('dyslexia').map((meta) => meta.key)).toContain('a11y.dyslexia');
    expect(searchSettings('spell').map((meta) => meta.key)).toContain('editor.spellcheck');
    expect(searchSettings('files saving').map((meta) => meta.key)).toContain('saving.autoSave');
    expect(searchSettings('zzzz')).toEqual([]);
    expect(searchSettings('')).toHaveLength(SETTINGS_META.length);
  });
});

describe('the platform dialogs for Preferences (mock)', () => {
  it('choosePandoc stores a pandoc file and announces the change; Cancel changes nothing', async () => {
    const { createMockPlatform } = await import('@/lib/platform-mock');
    const platform = createMockPlatform({
      pandocDialog: ['/opt/tools/pandoc', null, '/opt/tools/other'],
    });
    const seen: Array<string | null> = [];
    await platform.onSettingsChanged((settings) => seen.push(settings.export.pandocPath));

    expect(await platform.choosePandoc()).toBe('/opt/tools/pandoc');
    expect((await platform.getSettings()).export.pandocPath).toBe('/opt/tools/pandoc');
    expect(seen).toEqual(['/opt/tools/pandoc']);

    expect(await platform.choosePandoc()).toBeNull();
    await expect(platform.choosePandoc()).rejects.toMatchObject({ code: 'io' });
    expect((await platform.getSettings()).export.pandocPath).toBe('/opt/tools/pandoc');
    expect(seen).toHaveLength(1);
  });

  it('chooseDefaultFolder stores the folder; Cancel changes nothing', async () => {
    const { createMockPlatform } = await import('@/lib/platform-mock');
    const platform = createMockPlatform({ defaultFolderDialog: ['/Users/x/Notes', null] });
    const seen: Array<string | null> = [];
    await platform.onSettingsChanged((settings) => seen.push(settings.saving.defaultFolder));

    expect(await platform.chooseDefaultFolder()).toBe('/Users/x/Notes');
    expect((await platform.getSettings()).saving.defaultFolder).toBe('/Users/x/Notes');
    expect(await platform.chooseDefaultFolder()).toBeNull();
    expect((await platform.getSettings()).saving.defaultFolder).toBe('/Users/x/Notes');
    expect(seen).toEqual(['/Users/x/Notes']);
  });

  it('setPandocAnswers and setDefaultFolderAnswers script later answers', async () => {
    const { createMockPlatform } = await import('@/lib/platform-mock');
    const platform = createMockPlatform();
    expect(await platform.choosePandoc()).toBeNull();
    window.__WRITEDOWN_MOCK__?.setPandocAnswers('/usr/local/bin/pandoc');
    window.__WRITEDOWN_MOCK__?.setDefaultFolderAnswers('/tmp/docs');
    expect(await platform.choosePandoc()).toBe('/usr/local/bin/pandoc');
    expect(await platform.chooseDefaultFolder()).toBe('/tmp/docs');
  });
});
