import { describe, expect, it } from 'vitest';

// The raw text of every source file, so the rules also cover .svelte files.
const sources = import.meta.glob<string>('/src/**/*.{ts,svelte}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const files = Object.entries(sources);
const PLATFORM = '/src/lib/platform.ts';
const MOCK = '/src/lib/platform-mock.ts';

describe('architecture rules', () => {
  it('sees the source files (so the checks below are not vacuous)', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(sources[PLATFORM]).toContain('@tauri-apps/api/core');
  });

  it('only src/lib/platform.ts imports from @tauri-apps', () => {
    const offenders = files
      .filter(([path, text]) => path !== PLATFORM && text.includes('@tauri-apps/'))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it('the mock platform is reached only through a dynamic import in platform.ts', () => {
    const offenders = files
      .filter(
        ([path, text]) => path !== PLATFORM && path !== MOCK && text.includes('platform-mock'),
      )
      .map(([path]) => path);
    const platform = sources[PLATFORM] ?? '';

    expect(offenders).toEqual([]);
    expect(platform).toMatch(/import\(\s*['"]\.\/platform-mock['"]\s*\)/);
    expect(platform).not.toMatch(/^import\s[^;]*from\s+['"]\.\/platform-mock['"]/m);
  });
});
