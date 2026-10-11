import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VaultIndex } from '@/lib/platform';
import type { MockSeed } from '@/lib/platform-mock';
import type { ContextInputs } from '@/preview/types';

const VAULT_DIR = join(process.cwd(), 'tests/fixtures/flavors/obsidian/vault');
export const VAULT_ROOT = '/v';

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), relative));
    else out.push(relative);
  }
  return out;
}

/** The fixture vault as a mock platform seed: notes as files, the PNG as an image, the PDF as existing. */
export function vaultSeed(extra: Partial<MockSeed> = {}): MockSeed {
  const files: Record<string, string> = {};
  const images: Record<string, string> = {};
  const existing: string[] = [];
  for (const relative of walk(VAULT_DIR)) {
    const path = `${VAULT_ROOT}/${relative}`;
    if (relative.endsWith('.md')) files[path] = readFileSync(join(VAULT_DIR, relative), 'utf8');
    else if (relative.endsWith('.png')) images[path] = `asset://${relative}`;
    else existing.push(path);
  }
  return {
    files,
    images,
    existing,
    vault: { root: VAULT_ROOT },
    launch: { openPath: `${VAULT_ROOT}/Home.md` },
    ...extra,
  };
}

export function fixtureText(relative: string): string {
  return readFileSync(join(VAULT_DIR, relative), 'utf8');
}

/** The index the real backend would give for the fixture vault (hidden folders skipped). */
export const FIXTURE_VAULT: VaultIndex = {
  root: VAULT_ROOT,
  notes: [
    'Archive/Old/Plan.md',
    'Cycle A.md',
    'Cycle B.md',
    'Home.md',
    'Notes/Note A.md',
    'Projects/Plan.md',
  ],
  attachments: ['attachments/diagram.png', 'attachments/report.pdf'],
  truncated: false,
};

export function inputs(
  path: string | null,
  vault: VaultIndex | null = FIXTURE_VAULT,
): ContextInputs {
  return { path, bibliographies: [], includes: new Map(), vault, project: null };
}
