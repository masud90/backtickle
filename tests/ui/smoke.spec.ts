import { expect, test } from '@playwright/test';

test('main page shows the app title and the welcome screen, and runs on the mock platform', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByTestId('app-title')).toHaveText('Writedown');
  await expect(page.getByTestId('welcome')).toContainText('Welcome to Writedown');
  await expect(page.locator('body')).toHaveAttribute('data-platform', 'mock');
});

test('preferences page shows the Preferences heading, platform and version', async ({ page }) => {
  await page.goto('/preferences.html');

  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-platform', 'mock');
  await expect(page.getByTestId('app-version')).toHaveText('0.0.0-mock');
});

// The design token checks use the category list (surface-container-low) and the title of the
// Preferences window (headline-sm: 16 px, weight 600, Inter). They used a sample element on the
// placeholder page before WP4.1; the radius and padding checks of that sample went with it.
test('Preferences surfaces and title have the token styles in light mode', async ({ page }) => {
  await page.goto('/preferences.html');

  const tokenSample = page.getByTestId('prefs-categories');
  await expect(tokenSample).toBeVisible();

  const bgColor = await tokenSample.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  expect(bgColor).toBe('rgb(246, 243, 245)');

  const title = page.getByRole('heading', { level: 1, name: 'Preferences' });
  const fontSize = await title.evaluate((el) => window.getComputedStyle(el).fontSize);
  expect(fontSize).toBe('16px');

  const fontWeight = await title.evaluate((el) => window.getComputedStyle(el).fontWeight);
  expect(fontWeight).toBe('600');

  const fontFamily = await title.evaluate((el) => window.getComputedStyle(el).fontFamily);
  expect(fontFamily).toContain('Inter');
});

test('Preferences surface changes colors in dark mode', async ({ page }) => {
  await page.goto('/preferences.html');

  // Switch to dark mode
  await page.emulateMedia({ colorScheme: 'dark' });

  const tokenSample = page.getByTestId('prefs-categories');
  const bgColor = await tokenSample.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  expect(bgColor).toBe('rgb(27, 27, 29)');
});

test('Preferences surface respects data-theme light override in dark media', async ({ page }) => {
  await page.goto('/preferences.html');

  // Switch to dark media query
  await page.emulateMedia({ colorScheme: 'dark' });

  // Override with data-theme light
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });

  const tokenSample = page.getByTestId('prefs-categories');
  const bgColor = await tokenSample.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  expect(bgColor).toBe('rgb(246, 243, 245)');
});

test('Preferences title icon renders as SVG', async ({ page }) => {
  await page.goto('/preferences.html');

  const tokenSample = page.getByTestId('prefs-title');
  const svg = tokenSample.locator('svg').first();
  await expect(svg).toBeVisible();

  // Check viewBox is correct Material Symbols coordinate system
  const viewBox = await svg.getAttribute('viewBox');
  expect(viewBox).toBe('0 -960 960 960');

  // Check size is as specified (18px)
  const width = await svg.getAttribute('width');
  const height = await svg.getAttribute('height');
  expect(width).toBe('18');
  expect(height).toBe('18');

  // Check no nested svg elements
  const nestedSvgs = await svg.locator('svg').count();
  expect(nestedSvgs).toBe(0);

  // Check path element exists and has valid bounds
  const path = await svg.locator('path').first();
  await expect(path).toBeVisible();

  // Verify path is within viewBox bounds using getBBox
  const bbox = await page.evaluate(() => {
    const svgElement = document.querySelector('[data-testid="prefs-title"] svg');
    const pathElement = svgElement?.querySelector('path');
    if (!pathElement) return null;
    const box = pathElement.getBBox();
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  });

  expect(bbox).not.toBeNull();
  if (bbox) {
    expect(bbox.x).toBeGreaterThanOrEqual(0);
    expect(bbox.y).toBeGreaterThanOrEqual(-960);
    expect(bbox.x + bbox.width).toBeLessThanOrEqual(960);
    expect(bbox.y + bbox.height).toBeLessThanOrEqual(0);
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  }
});
