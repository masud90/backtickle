import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Settings } from '@/lib/platform';

/** The default settings, from the fixture shared with the Rust side (tests/fixtures/settings-defaults.json). */
export function DEFAULT_SETTINGS_FOR_TESTS(): Settings {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/settings-defaults.json'), 'utf8'),
  ) as Settings;
}
