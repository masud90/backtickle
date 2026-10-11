/**
 * The built app runs under the content security policy of tauri.conf.json, and Tauri changes it
 * at runtime: it adds a nonce to `style-src`, and a nonce makes browsers ignore 'unsafe-inline'.
 * The dev server has no CSP at all, so this is the only place a style the policy blocks shows up
 * before the app is built. These tests build the frontend, serve it with the production policy
 * (plus a nonce, as Tauri adds one) and check that nothing is blocked.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import type { MockSeed } from '../../src/lib/platform-mock';

const projectRoot = new URL('../..', import.meta.url).pathname;
const tauriConf = JSON.parse(
  readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
) as { app: { security: { csp: Record<string, string> } } };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** The production policy as one header value, with Tauri's nonce added to the given directives. */
function policy(options: { withoutDirectives?: string[] } = {}): string {
  const directives = { ...tauriConf.app.security.csp };
  for (const name of options.withoutDirectives ?? []) delete directives[name];
  for (const name of ['script-src', 'style-src']) {
    directives[name] = `${directives[name]} 'nonce-0123456789'`;
  }
  return Object.entries(directives)
    .map(([name, value]) => `${name} ${value}`)
    .join('; ');
}

let distDir = '';
const servers: Server[] = [];

async function serve(csp: string): Promise<string> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = normalize(join(distDir, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(distDir)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = readFileSync(file);
      response.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server address');
  return `http://127.0.0.1:${address.port}`;
}

test.beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'writedown-csp-'));
  execFileSync('npx', ['vite', 'build', '--outDir', distDir, '--emptyOutDir'], {
    cwd: projectRoot,
    stdio: 'pipe',
  });
});

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  rmSync(distDir, { recursive: true, force: true });
});

const TABLE = '| left | center | right |\n| :--- | :----: | ----: |\n| a | b | c |\n';

async function openUnderPolicy(page: Page, baseUrl: string) {
  const seed: MockSeed = {
    files: {
      '/table.md': `# Table\n\n${TABLE}\n- [x] done\n- [ ] open\n\n\`\`\`typescript\nconst a = 1;\n\`\`\`\n`,
    },
    launch: { openPath: '/table.md', view: 'split' },
  };
  await page.addInitScript((value) => {
    // What Tauri's freezePrototype does, and a record of every policy violation.
    Object.freeze(Object.prototype);
    const records: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = records;
    document.addEventListener('securitypolicyviolation', (event) => {
      records.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
    window.__WRITEDOWN_MOCK_SEED__ = value;
  }, seed);
  await page.goto(`${baseUrl}/`);
  await expect(page.getByTestId('preview').getByRole('heading', { name: 'Table' })).toBeVisible();
  // The code block's language grammar loads lazily: wait for it so a blocked chunk would show.
  await page.waitForTimeout(500);
}

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test('under the production policy nothing is blocked and the editor is styled', async ({
  page,
}) => {
  const baseUrl = await serve(policy());
  await openUnderPolicy(page, baseUrl);

  expect(await violations(page)).toEqual([]);

  // CodeMirror's theme is injected as a <style> element: JetBrains Mono 13px on a 22px line.
  const scroller = page.locator('.cm-scroller');
  await expect(scroller).toHaveCSS('font-size', '13px');
  await expect(scroller).toHaveCSS('line-height', '22px');
  expect(await scroller.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
    'JetBrains Mono',
  );
  // The editor fills its pane and scrolls inside it (the theme's height: 100%).
  const heights = await page.evaluate(() => ({
    editor: document.querySelector('.cm-editor')?.getBoundingClientRect().height ?? 0,
    host: document.querySelector('[data-testid="editor"]')?.getBoundingClientRect().height ?? 0,
  }));
  expect(heights.editor).toBeLessThanOrEqual(heights.host + 1);
});

test('under the production policy table alignment and task boxes still render', async ({
  page,
}) => {
  const baseUrl = await serve(policy());
  await openUnderPolicy(page, baseUrl);

  const preview = page.getByTestId('preview');
  await expect(preview.locator('thead th').nth(1)).toHaveCSS('text-align', 'center');
  await expect(preview.locator('tbody td').nth(2)).toHaveCSS('text-align', 'right');
  // Task boxes are styled spans: the checked one is filled with the tertiary color, and its check
  // mark is a pseudo-element drawn with borders (no inline style, no data: image).
  const checked = preview.locator('.task-checkbox[aria-checked="true"]');
  await expect(checked).toHaveCount(1);
  expect(await checked.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(await checked.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('""');
  expect(await violations(page)).toEqual([]);
});

test('control: without the explicit style-src-elem the same page loses its editor styles', async ({
  page,
}) => {
  // This is the bug the directive prevents: a nonce in style-src voids 'unsafe-inline' for the
  // <style> elements CodeMirror injects. If this test starts failing, the browser no longer
  // behaves that way and the directive may be unnecessary.
  const baseUrl = await serve(policy({ withoutDirectives: ['style-src-elem'] }));
  await openUnderPolicy(page, baseUrl);

  expect((await violations(page)).some((entry) => entry.startsWith('style-src-elem'))).toBe(true);
  expect(
    await page.locator('.cm-scroller').evaluate((el) => getComputedStyle(el).fontFamily),
  ).not.toContain('JetBrains Mono');
});
