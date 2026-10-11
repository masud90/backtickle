import { describe, expect, it } from 'vitest';
import { type CloseAnswer, walkUnsaved } from '@/shell/closewalk';

/** A walk whose answers are given in order; records everything that happens. */
function harness(answers: CloseAnswer[], saveResults: boolean[] = []) {
  const events: string[] = [];
  const asked = [...answers];
  const saves = [...saveResults];
  return {
    events,
    deps: {
      activate: async (item: string) => {
        events.push(`activate ${item}`);
      },
      ask: async (item: string) => {
        events.push(`ask ${item}`);
        return asked.shift() ?? 'cancel';
      },
      save: async (item: string) => {
        events.push(`save ${item}`);
        return saves.shift() ?? true;
      },
    },
  };
}

describe('walkUnsaved', () => {
  it('completes at once when nothing is unsaved', async () => {
    const { deps, events } = harness([]);

    expect(await walkUnsaved([], deps)).toEqual({ completed: true, saved: [], discarded: [] });
    expect(events).toEqual([]);
  });

  it('activates each document in order and asks about it', async () => {
    const { deps, events } = harness(['discard', 'discard']);

    await walkUnsaved(['a', 'b'], deps);

    expect(events).toEqual(['activate a', 'ask a', 'activate b', 'ask b']);
  });

  it("saves on Save and discards on Don't Save", async () => {
    const { deps, events } = harness(['save', 'discard', 'save']);

    const result = await walkUnsaved(['a', 'b', 'c'], deps);

    expect(result).toEqual({ completed: true, saved: ['a', 'c'], discarded: ['b'] });
    expect(events.filter((event) => event.startsWith('save'))).toEqual(['save a', 'save c']);
  });

  it('stops at Cancel and leaves the rest alone', async () => {
    const { deps, events } = harness(['discard', 'cancel', 'save']);

    const result = await walkUnsaved(['a', 'b', 'c'], deps);

    expect(result).toEqual({ completed: false, saved: [], discarded: ['a'] });
    expect(events).not.toContain('activate c');
  });

  it('stops when a save does not happen (Save As cancelled, or an error)', async () => {
    const { deps, events } = harness(['save', 'save'], [false]);

    const result = await walkUnsaved(['a', 'b'], deps);

    expect(result.completed).toBe(false);
    expect(result.saved).toEqual([]);
    expect(events).not.toContain('ask b');
  });
});
