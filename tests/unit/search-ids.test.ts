import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shell/files/model.svelte', () => ({ getFilesModel: () => ({ folder: '/folder' }) }));

const { SearchModel } = await import('@/shell/search/model.svelte');

function shellWith(ids: number[]) {
  return {
    platform: {
      cancelSearch: async () => undefined,
      searchFolder: async (request: { id: number }) => {
        ids.push(request.id);
        return { cancelled: false, files: [], truncated: false };
      },
    },
  } as never;
}

describe('search ids', () => {
  it('start at the clock, so a new window never repeats an id Rust has seen', async () => {
    const before = Date.now();
    const ids: number[] = [];
    const model = new SearchModel(shellWith(ids));
    model.query = 'a';
    await model.run();
    model.query = 'b';
    await model.run();
    expect(ids[0]).toBeGreaterThanOrEqual(before);
    expect(ids[1]).toBe((ids[0] as number) + 1);
  });

  it('differ between two models created at different times', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const first: number[] = [];
      const a = new SearchModel(shellWith(first));
      vi.setSystemTime(2_000_000);
      const second: number[] = [];
      const b = new SearchModel(shellWith(second));
      a.query = 'x';
      b.query = 'x';
      await a.run();
      await b.run();
      expect(second[0] as number).toBeGreaterThan(first[0] as number);
    } finally {
      vi.useRealTimers();
    }
  });
});
