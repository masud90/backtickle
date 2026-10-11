/**
 * What the editor looks like in real WebKit (and the dual-pane mock): sizes that follow
 * CSS variables, colors built on the design tokens in light and dark, the Markdown colors, the
 * current line and the find bar. Behavior is in editor.spec.ts.
 *
 * Expected colors are read from the tokens on the page, so these tests check that the editor is
 * wired to the tokens and follows them into dark, not what the palette happens to be.
 */
import { expect, type Page, test } from '@playwright/test';

/** The part of the controller these tests use, as seen from the page. */
interface EditorApi {
  setText(text: string): void;
  scrollToLine(line: number, align: 'top' | 'nearest'): void;
  topVisibleLine(): number;
  openSearch(replace: boolean): void;
  view: { defaultLineHeight: number; dispatch(spec: unknown): void };
}

/** The harness globals, typed locally (editor.spec.ts types the same globals differently). */
type Harness = { __editor: EditorApi; __ready: boolean };

const HARNESS = '/tests/harness/editor.html';

async function openEditor(page: Page, text = ''): Promise<void> {
  await page.goto(HARNESS);
  await page.waitForFunction(() => (window as unknown as Harness).__ready === true);
  if (text)
    await page.evaluate((value) => (window as unknown as Harness).__editor.setText(value), text);
}

/** A token as the `rgb(r, g, b)` string a computed style uses. */
async function token(page: Page, name: string): Promise<string> {
  const hex = await page.evaluate(
    (variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(),
    name,
  );
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

interface Look {
  color: string;
  backgroundColor: string;
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
}

/** The computed look of the first element under `scope` whose text is exactly `text`. */
async function lookOf(page: Page, text: string, scope = '.cm-content'): Promise<Look | null> {
  return page.evaluate(
    ({ text, scope }) => {
      const root = document.querySelector(scope);
      if (!root) return null;
      const matches = [...root.querySelectorAll('span, div')].filter(
        (element) => element.textContent === text,
      );
      const element = matches.at(-1);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontWeight: style.fontWeight,
        fontStyle: style.fontStyle,
        textDecorationLine: style.textDecorationLine,
      };
    },
    { text, scope },
  );
}

/** The alpha of a computed color, whether WebKit writes it as rgba() or color(srgb ...). */
function alphaOf(color: string): number {
  const slash = /\/\s*([\d.]+)\s*\)/.exec(color);
  if (slash) return Number(slash[1]);
  const rgba = /^rgba\(\s*[\d.]+,\s*[\d.]+,\s*[\d.]+,\s*([\d.]+)\s*\)$/.exec(color);
  if (rgba) return Number(rgba[1]);
  return 1;
}

const SAMPLE = [
  '# Heading one',
  '',
  '- list item',
  '- [ ] open task',
  '- [x] done task',
  '',
  'Some **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.org).',
  '',
  '```ts',
  'const answer = 42;',
  '```',
].join('\n');

function longDocument(): string {
  const lines: string[] = [];
  for (let i = 0; i < 400; i++) {
    lines.push(
      i % 3 === 0 ? `L${i} ${'word '.repeat(40 + (i % 5) * 10)}`.trimEnd() : `L${i} a short line`,
    );
  }
  return lines.join('\n');
}

test.describe('size and zoom', () => {
  test('is 13px on a 22px line in JetBrains Mono by default', async ({ page }) => {
    await openEditor(page, 'one\ntwo');

    const scroller = page.locator('.cm-scroller');
    await expect(scroller).toHaveCSS('font-size', '13px');
    await expect(scroller).toHaveCSS('line-height', '22px');
    expect(await scroller.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
      'JetBrains Mono',
    );
    expect((await page.locator('.cm-line').first().boundingBox())?.height).toBe(22);
  });

  test('follows --wd-editor-font-size and --wd-editor-line-height without reconfiguration', async ({
    page,
  }) => {
    await openEditor(page, 'one\ntwo');

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--wd-editor-font-size', '26px');
      document.documentElement.style.setProperty('--wd-editor-line-height', '44px');
    });

    await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '26px');
    await expect(page.locator('.cm-scroller')).toHaveCSS('line-height', '44px');
    expect((await page.locator('.cm-line').first().boundingBox())?.height).toBe(44);
    // The gutter numbers scale with the text (11px at 13px).
    await expect(page.locator('.cm-lineNumbers .cm-gutterElement').nth(1)).toHaveCSS(
      'font-size',
      '22px',
    );

    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--wd-editor-font-size');
      document.documentElement.style.removeProperty('--wd-editor-line-height');
    });
    await expect(page.locator('.cm-scroller')).toHaveCSS('line-height', '22px');
    await expect(page.locator('.cm-lineNumbers .cm-gutterElement').nth(1)).toHaveCSS(
      'font-size',
      '11px',
    );
  });

  test('CodeMirror takes the new line height as its own, so heights stay right', async ({
    page,
  }) => {
    await openEditor(page, longDocument());
    expect(
      await page.evaluate(() => (window as unknown as Harness).__editor.view.defaultLineHeight),
    ).toBe(22);

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--wd-editor-font-size', '19.5px');
      document.documentElement.style.setProperty('--wd-editor-line-height', '33px');
    });

    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as Harness).__editor.view.defaultLineHeight),
      )
      .toBe(33);
  });

  test('jumping to a line is still exact after zooming', async ({ page }) => {
    await openEditor(page, longDocument());
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--wd-editor-font-size', '26px');
      document.documentElement.style.setProperty('--wd-editor-line-height', '44px');
    });
    await expect(page.locator('.cm-scroller')).toHaveCSS('line-height', '44px');

    for (const target of [120, 250.5, 3]) {
      await page.evaluate(
        (line) => (window as unknown as Harness).__editor.scrollToLine(line, 'top'),
        target,
      );
      await expect
        .poll(() => page.evaluate(() => (window as unknown as Harness).__editor.topVisibleLine()), {
          message: `line ${target}`,
        })
        .toBeCloseTo(target, 0);
    }
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`colors in ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openEditor(page, SAMPLE);
      await page.evaluate(() =>
        (window as unknown as Harness).__editor.view.dispatch({ selection: { anchor: 0 } }),
      );
    });

    test('the editor sits on the canvas in the text color, gutter numbers in on-surface-variant', async ({
      page,
    }) => {
      await expect(page.locator('.cm-editor')).toHaveCSS(
        'background-color',
        await token(page, '--wd-canvas'),
      );
      await expect(page.locator('.cm-editor')).toHaveCSS(
        'color',
        await token(page, '--wd-on-surface'),
      );
      // Line 3 is not the current line, so it shows the plain gutter color.
      await expect(page.locator('.cm-lineNumbers .cm-gutterElement').nth(3)).toHaveCSS(
        'color',
        await token(page, '--wd-on-surface-variant'),
      );
    });

    test('heading marks are primary and bold, heading text is bold', async ({ page }) => {
      const mark = await lookOf(page, '#');
      expect(mark?.color).toBe(await token(page, '--wd-primary'));
      expect(mark?.fontWeight).toBe('700');
      const text = await lookOf(page, ' Heading one');
      expect(text?.fontWeight).toBe('700');
      expect(text?.color).toBe(await token(page, '--wd-on-surface'));
    });

    test('list, task and emphasis markers are secondary', async ({ page }) => {
      const secondary = await token(page, '--wd-secondary');
      expect((await lookOf(page, '-'))?.color).toBe(secondary);
      expect((await lookOf(page, '[ ]'))?.color).toBe(secondary);
      expect((await lookOf(page, '**'))?.color).toBe(secondary);
    });

    test('a checked box is tertiary and bold', async ({ page }) => {
      const done = await lookOf(page, '[x]');
      expect(done?.color).toBe(await token(page, '--wd-tertiary'));
      expect(done?.fontWeight).toBe('700');
    });

    test('bold is semibold, italic is primary italic, strikethrough is struck out', async ({
      page,
    }) => {
      expect((await lookOf(page, 'bold'))?.fontWeight).toBe('600');

      const italic = await lookOf(page, 'italic');
      expect(italic?.fontStyle).toBe('italic');
      expect(italic?.color).toBe(await token(page, '--wd-primary'));

      const struck = await lookOf(page, 'gone');
      expect(struck?.textDecorationLine).toBe('line-through');
      // On-surface-variant, not outline: outline is below the 4.5:1 text contrast.
      expect(struck?.color).toBe(await token(page, '--wd-on-surface-variant'));
    });

    test('links are primary, inline code has the inline code background', async ({ page }) => {
      expect((await lookOf(page, 'a link'))?.color).toBe(await token(page, '--wd-primary'));
      const inline = await lookOf(page, 'code');
      expect(alphaOf(inline?.backgroundColor ?? '')).toBeCloseTo(
        scheme === 'light' ? 0.05 : 0.08,
        2,
      );
    });

    test('the language after the opening fence is on-surface-variant', async ({ page }) => {
      expect((await lookOf(page, 'ts'))?.color).toBe(await token(page, '--wd-on-surface-variant'));
    });

    test('code inside a fence is colored by the language grammar', async ({ page }) => {
      await expect
        .poll(async () => (await lookOf(page, 'const'))?.color, { timeout: 10_000 })
        .toBe(await token(page, '--wd-secondary'));
      expect((await lookOf(page, 'const'))?.fontWeight).toBe('600');
    });

    test('the current line is primary at 10% with a 2px primary edge, and its number is bold primary', async ({
      page,
    }) => {
      const primary = await token(page, '--wd-primary');
      const line = page.locator('.cm-activeLine');
      await expect(line).toHaveCount(1);
      const style = await line.evaluate((el) => {
        const computed = getComputedStyle(el);
        return { background: computed.backgroundColor, shadow: computed.boxShadow };
      });
      expect(alphaOf(style.background)).toBeCloseTo(0.1, 2);
      expect(style.shadow).toContain(primary);
      expect(style.shadow).toContain('inset');
      expect(style.shadow).toContain('2px');

      const number = page.locator('.cm-activeLineGutter');
      await expect(number).toHaveCount(1);
      await expect(number).toHaveCSS('color', primary);
      await expect(number).toHaveCSS('font-weight', '700');
    });

    test('the drawn caret is a 2px primary bar', async ({ page }) => {
      const caret = page.locator('.cm-cursor').first();
      await expect(caret).toHaveCSS('border-left-color', await token(page, '--wd-primary'));
      await expect(caret).toHaveCSS('border-left-width', '2px');
    });
  });
}

test.describe('light and dark', () => {
  test('dark media changes the editor colors', async ({ page }) => {
    await openEditor(page, SAMPLE);
    const background = () =>
      page.locator('.cm-editor').evaluate((el) => getComputedStyle(el).backgroundColor);
    const light = await background();

    await page.emulateMedia({ colorScheme: 'dark' });

    expect(await background()).not.toBe(light);
    expect(await background()).toBe(await token(page, '--wd-canvas'));
    expect(await background()).toBe('rgb(25, 25, 27)');
  });

  test('data-theme overrides the media in both directions', async ({ page }) => {
    await openEditor(page, SAMPLE);
    const background = () =>
      page.locator('.cm-editor').evaluate((el) => getComputedStyle(el).backgroundColor);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    expect(await background()).toBe('rgb(251, 251, 253)');

    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    expect(await background()).toBe('rgb(25, 25, 27)');
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`find bar in ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openEditor(page, 'one two three');
      await page.evaluate(() => (window as unknown as Harness).__editor.openSearch(false));
    });

    const bar = (page: Page) => page.locator('.cm-search');

    test('sits at the top, above the text, on the low surface with a hairline under it', async ({
      page,
    }) => {
      await expect(bar(page)).toBeVisible();
      const panels = page.locator('.cm-panels-top');
      await expect(panels).toHaveCSS(
        'background-color',
        await token(page, '--wd-surface-container-low'),
      );
      const panelsBox = await panels.boundingBox();
      const scrollerBox = await page.locator('.cm-scroller').boundingBox();
      expect(panelsBox && scrollerBox && panelsBox.y + panelsBox.height <= scrollerBox.y + 1).toBe(
        true,
      );
      expect(await panels.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('1px');
    });

    test('has 26px controls with a 6px radius', async ({ page }) => {
      for (const selector of ['input[name=search]', 'button[name=next]', 'button[name=prev]']) {
        const control = bar(page).locator(selector);
        expect((await control.boundingBox())?.height, selector).toBe(26);
        await expect(control, selector).toHaveCSS('border-radius', '6px');
      }
      expect((await bar(page).locator('[name=close]').boundingBox())?.height).toBe(26);
    });

    test('shows the find row only, with the replace row for Find and Replace', async ({ page }) => {
      await expect(bar(page).locator('input[name=replace]')).toBeHidden();
      await expect(bar(page).locator('button[name=replaceAll]')).toBeHidden();

      await page.evaluate(() => (window as unknown as Harness).__editor.openSearch(true));

      await expect(bar(page).locator('input[name=replace]')).toBeVisible();
      await expect(bar(page).locator('button[name=replace]')).toBeVisible();
      await expect(bar(page).locator('button[name=replaceAll]')).toBeVisible();
      expect((await bar(page).locator('input[name=replace]').boundingBox())?.height).toBe(26);
    });

    test('the field is on the lowest surface and gets a primary ring when focused', async ({
      page,
    }) => {
      const field = bar(page).locator('input[name=search]');
      await expect(field).toHaveCSS(
        'background-color',
        await token(page, '--wd-surface-container-lowest'),
      );
      await expect(field).toBeFocused();
      const primary = await token(page, '--wd-primary');
      await expect(field).toHaveCSS('border-color', primary);
      expect(await field.evaluate((el) => getComputedStyle(el).boxShadow)).toContain(primary);
    });

    test('text is readable: on-surface for the field, on-surface-variant for the labels', async ({
      page,
    }) => {
      await expect(bar(page).locator('input[name=search]')).toHaveCSS(
        'color',
        await token(page, '--wd-on-surface'),
      );
      await expect(bar(page).locator('label').first()).toHaveCSS(
        'color',
        await token(page, '--wd-on-surface-variant'),
      );
      await expect(bar(page).locator('button[name=next]')).toHaveCSS(
        'color',
        await token(page, '--wd-on-surface'),
      );
    });

    test('a button reached by keyboard has a visible primary focus ring', async ({ page }) => {
      // WebKit on macOS does not Tab to buttons, so focus it after a key press, which is what
      // makes :focus-visible apply.
      await page.keyboard.press('Shift+Tab');
      const next = bar(page).locator('button[name=next]');
      await next.focus();
      await expect(next).toBeFocused();
      await expect(next).toHaveCSS('outline-style', 'solid');
      await expect(next).toHaveCSS('outline-color', await token(page, '--wd-primary'));
      await expect(next).toHaveCSS('outline-width', '2px');
    });

    test('the buttons use the inline code fill and darken under the pointer', async ({ page }) => {
      const next = bar(page).locator('button[name=next]');
      const rest = await next.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(alphaOf(rest)).toBeCloseTo(scheme === 'light' ? 0.05 : 0.08, 2);

      await next.hover();
      const hover = await next.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(alphaOf(hover)).toBeGreaterThan(alphaOf(rest));
    });
  });
}
