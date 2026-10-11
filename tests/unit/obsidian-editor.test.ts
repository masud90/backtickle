import { syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { noteSource } from '@/editor/complete';
import { EditorController } from '@/editor/controller';
import { flavorEditor } from '@/editor/flavors/obsidian';
import { completionsObsidian, contextFor } from '@/preview/rules/obsidian/context';
import { FIXTURE_VAULT } from './obsidian-helpers';

const mounted: EditorController[] = [];
afterEach(() => {
  for (const c of mounted.splice(0)) c.destroy();
  document.body.replaceChildren();
});

async function mount(doc: string, from = 0, to = from) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const c = new EditorController({ parent, doc, flavor: 'obsidian', onChange() {}, onCursor() {} });
  mounted.push(c);
  await new Promise((r) => setTimeout(r, 20));
  c.view.dispatch({ selection: { anchor: from, head: to } });
  return c;
}

describe('Obsidian editor syntax', () => {
  it('parses wikilinks, embeds, highlights, comments, tags and callout headers', async () => {
    const c = await mount(
      '[[A|b]] ![[x.png]] ==hi== %%c%% #tag\n\n> [!note]- T\n> body\n\n%%\nblock\n\nmore\n%%\n',
    );
    const names = new Set<string>();
    syntaxTree(c.getState()).iterate({ enter: (n) => void names.add(n.name) });
    for (const name of [
      'Wikilink',
      'WikiEmbed',
      'Highlight',
      'ObsidianComment',
      'ObsidianTag',
      'CalloutMark',
      'ObsidianCommentBlock',
    ]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('does not take #2024 for a tag', async () => {
    const c = await mount('#2024 text\n');
    const names = new Set<string>();
    syntaxTree(c.getState()).iterate({ enter: (n) => void names.add(n.name) });
    expect(names.has('ObsidianTag')).toBe(false);
  });
});

describe('Obsidian inserts', () => {
  const run = async (id: string, doc: string, from: number, to: number) => {
    const c = await mount(doc, from, to);
    expect(flavorEditor.inserts.find((i) => i.id === id)?.run(c.view)).toBe(true);
    return c.getText();
  };
  it('has the six inserts and each changes the text', async () => {
    expect(flavorEditor.inserts.map((i) => i.label)).toEqual([
      'Wikilink',
      'Embed',
      'Callout',
      'Highlight',
      'Tag',
      'Comment',
    ]);
    expect(await run('obsidian-wikilink', 'abc', 0, 3)).toBe('[[abc]]');
    expect(await run('obsidian-embed', 'abc', 0, 3)).toBe('![[abc]]');
    expect(await run('obsidian-highlight', 'abc', 0, 3)).toBe('==abc==');
    expect(await run('obsidian-tag', '', 0, 0)).toBe('#tag');
    expect(await run('obsidian-comment', 'abc', 0, 3)).toBe('%%abc%%');
    expect(await run('obsidian-callout', '', 0, 0)).toBe('> [!note] Title\n> Content');
  });
  it('attaches the note completion, fed from the vault index', () => {
    expect(flavorEditor.completions).toContain(noteSource);
    const data = completionsObsidian(contextFor(FIXTURE_VAULT, '/v/Home.md'));
    expect(data.notes?.map((n) => n.name)).toContain('Note A');
    expect(data.notes?.filter((n) => n.name === 'Plan')).toHaveLength(2);
  });
});

describe('heading completion after [[# and [[Note# (3.L item 1, C38)', () => {
  // Obsidian offers the headings of the linked note (documented behavior of its link suggester).
  async function run(
    text: string,
    head: number,
    noteHeadings?: (name: string) => Promise<string[]>,
  ) {
    const { EditorState } = await import('@codemirror/state');
    const { CompletionContext } = await import('@codemirror/autocomplete');
    const { completionDataField, setCompletionDataEffect } = await import('@/editor/complete');
    const { headingSource } = await import('@/editor/flavors/obsidian');
    let state = EditorState.create({ doc: text, extensions: [completionDataField] });
    state = state.update({ effects: setCompletionDataEffect({ noteHeadings }) }).state;
    return (await headingSource(new CompletionContext(state, head, true))) as
      | import('@codemirror/autocomplete').CompletionResult
      | null;
  }

  it('offers the headings of the current note after [[#', async () => {
    const doc = '# One\n\n## Two ##\n\n```\n# not a heading\n```\n\nSee [[#';
    const result = await run(doc, doc.length);
    expect(result?.options.map((o) => o.label)).toEqual(['One', 'Two']);
    expect(result?.from).toBe(doc.length);
  });

  it('asks the shell for the headings of that note after [[Note#', async () => {
    const asked: string[] = [];
    const doc = 'x [[Note A#Sec';
    const result = await run(doc, doc.length, async (name) => {
      asked.push(name);
      return ['Section', 'Second'];
    });
    expect(asked).toEqual(['Note A']);
    expect(result?.options.map((o) => o.label)).toEqual(['Section', 'Second']);
    expect(result?.from).toBe('x [[Note A#'.length);
  });

  it('offers nothing without the hook or when it fails', async () => {
    expect(await run('[[Note A#', 9)).toBeNull();
    expect(
      await run('[[Note A#', 9, async () => {
        throw new Error('x');
      }),
    ).toBeNull();
  });
});
