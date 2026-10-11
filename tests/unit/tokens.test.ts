import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Design Tokens', () => {
  let tokensCss: string;
  // The color roles come from the original design system (Native Markdown Workspace); the values
  // are kept in tests/fixtures/design-tokens.json.
  let roles: Record<string, string>;

  beforeAll(() => {
    tokensCss = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf-8');
    roles = JSON.parse(
      readFileSync(resolve(__dirname, '../fixtures/design-tokens.json'), 'utf-8'),
    ).colors;
  });

  it('should have all 47 light colors from the design system in :root', () => {
    const designColors: Record<string, string> = {};
    for (const [kebabName, value] of Object.entries(roles)) {
      const camelName = kebabName.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
      designColors[camelName] = value;
    }

    // Extract light colors from tokens.css :root block
    const rootMatch = tokensCss.match(/:root\s*\{([\s\S]*?)(?:color-scheme:|@media)/);
    if (!rootMatch?.[1]) {
      throw new Error('Could not find :root block in tokens.css');
    }

    const rootBlock = rootMatch[1];

    for (const [camelName, hexValue] of Object.entries(designColors)) {
      const kebabName = camelName.replace(/([A-Z])/g, '-$1').toLowerCase();
      const varName = `--wd-${kebabName}`;

      const varMatch = rootBlock.match(new RegExp(`${varName}:\\s*([^;]+);`));
      if (!varMatch?.[1]) {
        throw new Error(`Color ${camelName} not found in tokens.css :root`);
      }

      const tokenValue = varMatch[1].trim();
      const normalizedDesign = hexValue.toLowerCase();
      const normalizedToken = tokenValue.toLowerCase();

      expect(normalizedToken).toBe(normalizedDesign);
    }

    // Verify we found the right number of colors
    expect(Object.keys(designColors).length).toBe(47);
  });

  it('should have a dark value for every color role', () => {
    const colorNames = Object.keys(roles);

    const darkMediaMatch = tokensCss.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/,
    );
    if (!darkMediaMatch?.[1]) {
      throw new Error('Could not find dark media query in tokens.css');
    }

    const darkBlock = darkMediaMatch[1];

    // Check that every color role has a dark value
    for (const colorName of colorNames) {
      const kebabName = colorName;
      const darkVar = `--wd-${kebabName}`;

      const darkVarExists = darkBlock.includes(darkVar);
      expect(darkVarExists).toBe(true);
      if (!darkVarExists) {
        throw new Error(`Dark value for ${darkVar} not found in dark mode`);
      }
    }

    // Verify we checked 47 colors
    expect(colorNames.length).toBe(47);
  });
});
