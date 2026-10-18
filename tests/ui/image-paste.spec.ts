/**
 * Images pasted or dropped into the editor, on the mock platform: they are saved in the
 * `assets` folder next to the document and linked where the caret or the drop was.
 */
import { expect, type Page, test } from '@playwright/test';
import { editor, HOME, menu, preview, seedMock } from './helpers';

const DOCS = `${HOME}/Documents`;
const NOTE = `${DOCS}/note.md`;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];

async function openNote(page: Page, text = '# Note\n\nBody.\n') {
  await seedMock(page, {
    files: { [NOTE]: text },
    launch: { openPath: NOTE, view: 'split' },
  });
  await page.goto('/');
  await expect(editor(page)).toBeVisible();
}

/** Dispatches a paste of files (and optional text) on the editor. */
async function pasteFiles(
  page: Page,
  files: Array<{ name: string; type: string; bytes: number[] }>,
  plain = '',
) {
  await editor(page).evaluate(
    (element, [list, text]) => {
      const dt = new DataTransfer();
      for (const file of list as Array<{ name: string; type: string; bytes: number[] }>) {
        dt.items.add(new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      }
      if (text !== '') dt.setData('text/plain', text as string);
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    [files, plain] as const,
  );
}

const docText = (page: Page) =>
  page.evaluate(() => {
    const lines = [...document.querySelectorAll('[data-testid=editor] .cm-line')];
    return lines.map((line) => line.textContent ?? '').join('\n');
  });

const saved = (page: Page) => page.evaluate(() => window.__BACKTICKLE_MOCK__?.savedImages ?? []);

test.describe('image paste and drop', () => {
  test('a pasted screenshot is saved in assets and linked at the caret, with the alt text selected', async ({
    page,
  }) => {
    await openNote(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');

    await pasteFiles(page, [{ name: 'image.png', type: 'image/png', bytes: PNG }]);

    await expect
      .poll(() => docText(page))
      .toMatch(/^# Note\n\nBody\.\n!\[\]\(assets\/image-\d{8}-\d{6}\.png\)$/);
    const list = await saved(page);
    expect(list).toHaveLength(1);
    expect(list[0]?.path).toMatch(new RegExp(`^${DOCS}/assets/image-\\d{8}-\\d{6}\\.png$`));
    // The caret sits in the empty alt text: typing describes the image.
    await page.keyboard.type('Chart');
    await expect.poll(() => docText(page)).toContain('![Chart](assets/image-');
    // The mock serves no real file, so the preview shows the image's placeholder, named by its alt.
    await expect(preview(page).getByRole('img', { name: /Chart/ })).toHaveCount(1);
  });

  test('a paste with text is an ordinary paste', async ({ page }) => {
    await openNote(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+End');

    await pasteFiles(page, [{ name: 'image.png', type: 'image/png', bytes: PNG }], 'words');

    await expect.poll(() => docText(page)).toContain('words');
    expect(await saved(page)).toHaveLength(0);
  });

  test('an untitled document asks to be saved first and nothing is written', async ({ page }) => {
    await openNote(page);
    await menu(page, 'new');
    await expect(page.getByTestId('document-name')).toHaveText(/Untitled/);
    await editor(page).click();

    await pasteFiles(page, [{ name: 'image.png', type: 'image/png', bytes: PNG }]);

    await expect(page.getByRole('alert')).toContainText('Save the document first');
    expect(await saved(page)).toHaveLength(0);
  });

  test('images dropped from another folder are copied into assets and linked where dropped', async ({
    page,
  }) => {
    await openNote(page, '# Note\n\nFirst.\n\nSecond.\n');
    const line = editor(page).locator('.cm-line', { hasText: 'First.' });
    const box = await line.boundingBox();
    if (!box) throw new Error('no line box');

    await page.evaluate(
      ([x, y]) =>
        window.__BACKTICKLE_MOCK__?.dropImages(
          ['/Users/mock/Desktop/Team photo.jpg', '/Users/mock/Desktop/notes.txt'],
          x as number,
          y as number,
        ),
      [box.x + box.width - 4, box.y + box.height / 2],
    );

    await expect
      .poll(() => docText(page))
      .toBe('# Note\n\nFirst.\n![Team photo](assets/Team-photo.jpg)\n\nSecond.\n');
    expect((await saved(page))[0]).toMatchObject({
      path: `${DOCS}/assets/Team-photo.jpg`,
      from: '/Users/mock/Desktop/Team photo.jpg',
    });
  });

  test('an image dropped from inside the document folder is linked where it is', async ({
    page,
  }) => {
    await openNote(page, '');
    await editor(page).click();

    await page.evaluate(() =>
      window.__BACKTICKLE_MOCK__?.dropImages(['/Users/mock/Documents/pics/my chart.png'], 0, 0),
    );

    await expect.poll(() => docText(page)).toBe('![my chart](pics/my%20chart.png)');
    expect(await saved(page)).toHaveLength(0);
  });
});
