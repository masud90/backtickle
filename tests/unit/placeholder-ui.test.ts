import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { LaunchOptions } from '@/lib/platform';
import { createMockPlatform } from '@/lib/platform-mock';
import Prefs from '@/prefs/Prefs.svelte';
import App from '@/shell/App.svelte';
import StatusBar from '@/shell/StatusBar.svelte';
import { Shell } from '@/shell/shell.svelte';
import TitleBar from '@/shell/TitleBar.svelte';
import { untitledTab } from '@/shell/tab';

const welcome: LaunchOptions = {
  openPath: null,
  welcome: true,
  perf: false,
  bench: false,
  view: null,
};

describe('main window shell', () => {
  it('shows the title bar, the welcome screen and an empty status bar without a document', async () => {
    render(App, { props: { platform: createMockPlatform({}), launch: welcome } });

    expect(screen.getByTestId('app-title').textContent?.trim()).toBe('Backtickle');
    expect(await screen.findByTestId('welcome')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome to Backtickle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /New Document/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open File/ })).toBeTruthy();
    expect(screen.queryByTestId('document-name')).toBeNull();
    expect(screen.getByTestId('status-bar').textContent?.trim()).toBe('');
  });

  it('lists the recent documents that still exist, most recent first, at most eight', async () => {
    const files: Record<string, string> = {};
    const recents: string[] = [];
    for (let i = 1; i <= 10; i++) {
      files[`/Users/mock/Notes/doc${i}.md`] = `# ${i}`;
      recents.push(`/Users/mock/Notes/doc${i}.md`);
    }
    recents.splice(1, 0, '/Users/mock/Notes/missing.md');
    render(App, {
      props: { platform: createMockPlatform({ files, recents }), launch: welcome },
    });

    const items = await screen.findAllByTestId('recent-item');
    expect(items).toHaveLength(8);
    expect(screen.getAllByTestId('recent-name')[0]?.textContent).toBe('doc1.md');
    expect(screen.queryByText('missing.md')).toBeNull();
    expect(screen.getAllByTestId('recent-folder')[0]?.textContent).toBe('~/Notes');
  });

  it('Clear History empties the list', async () => {
    const platform = createMockPlatform({
      files: { '/Users/mock/a.md': 'a' },
      recents: ['/Users/mock/a.md'],
    });
    render(App, { props: { platform, launch: welcome } });

    await fireEvent.click(await screen.findByTestId('clear-history'));

    expect(await screen.findByTestId('recent-empty')).toBeTruthy();
  });
});

describe('title bar', () => {
  async function started(seed = {}) {
    const platform = createMockPlatform(seed);
    const shell = new Shell(platform, welcome);
    await shell.start();
    return shell;
  }

  it('is a drag region for the whole header, with buttons left clickable', async () => {
    render(TitleBar, { props: { shell: await started() } });

    const header = screen.getByTestId('title-bar');
    expect(header.getAttribute('data-tauri-drag-region')).toBe('deep');
    // Text in the chrome is not selectable.
    expect(header.className).toContain('select-none');
    // A real <button> blocks dragging in Tauri's drag script, so New stays clickable.
    expect(screen.getByRole('button', { name: 'New' }).tagName).toBe('BUTTON');
  });

  it('shows the document name, the unsaved dot and the save status for the active tab', async () => {
    const shell = await started();
    const tab = untitledTab({
      id: 1,
      name: 'Untitled',
      text: '',
      view: 'split',
      flavor: 'gfm',
      reason: 'default',
    });
    shell.tabs = [tab];
    shell.activeId = 1;
    render(TitleBar, { props: { shell } });

    expect(screen.getByTestId('document-name').textContent?.trim()).toBe('Untitled');
    expect(screen.queryByTestId('dirty-dot')).toBeNull();
    expect(screen.getByTestId('save-status').textContent?.trim()).toBe('Not saved');

    shell.patchTab(1, { textDirty: true });
    await waitFor(() => expect(screen.getByTestId('dirty-dot')).toBeTruthy());
  });

  it('has no document name or flavor of a document when none is open', async () => {
    render(TitleBar, { props: { shell: await started() } });

    expect(screen.queryByTestId('document-name')).toBeNull();
    expect(screen.getByTestId('flavor-pill').textContent).toContain('GFM');
    expect((screen.getByTestId('save-button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('status bar', () => {
  it('formats counts with en-US grouping and shows "N of total" for a selection', async () => {
    const shell = new Shell(createMockPlatform({}), welcome);
    await shell.start();
    shell.tabs = [
      {
        ...untitledTab({
          id: 1,
          name: 'Untitled',
          text: '',
          view: 'split',
          flavor: 'gfm',
          reason: 'default',
        }),
        stats: { words: 1420, characters: 8842, charactersNoSpaces: 7400 },
      },
    ];
    shell.activeId = 1;
    render(StatusBar, { props: { shell } });

    expect(screen.getByTestId('status-words').textContent).toBe('Words: 1,420');
    expect(screen.getByTestId('status-characters').textContent).toBe('Characters: 8,842');
    expect(screen.getByTestId('status-characters').getAttribute('title')).toBe(
      '7,400 without spaces',
    );
    expect(screen.getByTestId('status-reading').textContent).toContain('Reading Time: 6 min');

    shell.selection = { words: 42, characters: 250 };
    await waitFor(() =>
      expect(screen.getByTestId('status-words').textContent).toBe('Words: 42 of 1,420'),
    );
  });
});

describe('placeholder windows', () => {
  it('Preferences window shows its heading and version', async () => {
    render(Prefs, { props: { platform: createMockPlatform() } });

    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect((await screen.findByTestId('app-version')).textContent).toBe('0.0.0-mock');
  });

  it('Preferences window has a drag strip for its overlay title bar', () => {
    const { container } = render(Prefs, { props: { platform: createMockPlatform() } });

    expect(container.querySelector('[data-tauri-drag-region]')).not.toBeNull();
  });
});
