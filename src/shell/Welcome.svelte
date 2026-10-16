<script lang="ts">
  import { byOs } from '@/lib/os';
  import { displayShortcut } from '@/lib/shortcut-keys';
  import AppMark from '@/shell/icons/AppMark.svelte';
  import Icon from '@/shell/icons/Icon.svelte';
  import { formatBytes } from './document';
  import { shortcutOf } from './commands';
  import type { Shell } from './shell.svelte';
  import { relativeTime } from './time';

  let { shell }: { shell: Shell } = $props();

  const MAX_RECENTS = 8;
  const recents = $derived(shell.recents.filter((entry) => entry.exists).slice(0, MAX_RECENTS));
</script>

<!-- Shown instead of the panes while no document is open (the no-document mock). -->
<div
  data-testid="welcome"
  class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-bright text-on-surface"
>
  <div class="mx-auto my-auto flex w-full max-w-[calc(720px*var(--wd-scale,1))] flex-col items-center px-6 py-10">
    <div class="mb-6">
      <AppMark
        variant="tile"
        size={80}
        class="h-[calc(80px*var(--wd-scale,1))] w-[calc(80px*var(--wd-scale,1))]"
      />
    </div>

    <h1 class="mb-2 text-center font-headline-xl text-headline-xl tracking-tight">
      Welcome to Writedown
    </h1>
    <p class="mb-8 max-w-lg text-center font-body-lg text-body-lg text-on-surface-variant">
      Start a new Markdown document or pick up an existing file from your {byOs(
        'Mac or iCloud Drive',
        'PC',
        'computer',
      )}.
    </p>

    <div class="mb-10 flex items-center gap-3">
      <button
        type="button"
        data-testid="welcome-new"
        onclick={() => void shell.run('new')}
        class="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 font-label-md text-label-md font-semibold text-on-primary shadow-sm transition-all hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]"
      >
        <Icon name="add" size={18} />
        <span>New Document</span>
        {#if shortcutOf(shell, 'new', '⌘N')}<kbd class="ml-1 rounded bg-white/10 px-1.5 py-0.5 font-label-sm text-label-sm">{shortcutOf(shell, 'new', '⌘N')}</kbd>{/if}
      </button>
      <button
        type="button"
        data-testid="welcome-open"
        onclick={() => void shell.openFiles()}
        class="flex h-9 items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-high px-4 font-label-md text-label-md font-medium text-on-surface transition-all hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]"
      >
        <span class="inline-flex text-on-surface-variant"><Icon name="folder-open" size={18} /></span>
        <span>Open File…</span>
        {#if shortcutOf(shell, 'open', '⌘O')}
          <kbd
            class="ml-1 rounded border border-outline-variant/30 bg-surface-container-highest px-1.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant"
            >{shortcutOf(shell, 'open', '⌘O')}</kbd
          >
        {/if}
      </button>
      <button
        type="button"
        data-testid="welcome-open-folder"
        onclick={() => void shell.run('open-folder')}
        class="flex h-9 items-center gap-2 rounded-lg border border-outline-variant/30 bg-surface-container-high px-4 font-label-md text-label-md font-medium text-on-surface transition-all hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.98]"
      >
        <span class="inline-flex text-on-surface-variant"><Icon name="folder" size={18} /></span>
        <span>Open Folder…</span>
        {#if shortcutOf(shell, 'open-folder', '⌥⌘O')}
          <kbd
            class="ml-1 rounded border border-outline-variant/30 bg-surface-container-highest px-1.5 py-0.5 font-label-sm text-label-sm text-on-surface-variant"
            >{shortcutOf(shell, 'open-folder', '⌥⌘O')}</kbd
          >
        {/if}
      </button>
    </div>

    <section
      aria-labelledby="recent-heading"
      class="mb-8 w-full overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest/90 shadow-xs"
    >
      <div
        class="flex items-center justify-between border-b border-outline-variant/20 bg-surface-container-low/60 px-4 py-2.5"
      >
        <h2
          id="recent-heading"
          class="flex items-center gap-1.5 font-label-md text-label-md font-semibold text-on-surface-variant"
        >
          <Icon name="history" size={15} />
          Recent Documents
        </h2>
        {#if recents.length > 0}
          <button
            type="button"
            data-testid="clear-history"
            onclick={() => void shell.clearRecents()}
            class="rounded px-1 font-label-sm text-label-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Clear History
          </button>
        {/if}
      </div>
      {#if recents.length === 0}
        <p
          data-testid="recent-empty"
          class="px-4 py-6 text-center font-label-md text-label-md text-on-surface-variant"
        >
          No recent documents yet.
        </p>
      {:else}
        <ul data-testid="recent-list" class="divide-y divide-outline-variant/20">
          {#each recents as entry (entry.path)}
            <li>
              <button
                type="button"
                data-testid="recent-item"
                onclick={() => void shell.openRecentQueued(entry.path)}
                class="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-container-low/80 focus-visible:bg-surface-container-low/80 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <span class="flex min-w-0 items-center gap-3">
                  <span
                    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant transition-colors group-hover:bg-primary group-hover:text-on-primary"
                  >
                    <Icon name="description" size={18} />
                  </span>
                  <span class="flex min-w-0 flex-col">
                    <span
                      class="truncate font-headline-sm text-[length:calc(14px*var(--wd-scale,1))] text-on-surface transition-colors group-hover:text-primary"
                      data-testid="recent-name">{entry.name}</span
                    >
                    <span
                      class="flex items-center gap-1.5 truncate font-label-sm text-label-sm text-on-surface-variant"
                    >
                      <span class="truncate" data-testid="recent-folder">{entry.folder}</span>
                      <span aria-hidden="true">•</span>
                      <span class="shrink-0" data-testid="recent-time"
                        >{relativeTime(entry.openedAtMs, shell.now)}</span
                      >
                    </span>
                  </span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  {#if entry.bytes !== null}
                    <span
                      data-testid="recent-size"
                      class="rounded bg-surface-container px-2 py-0.5 font-label-sm text-label-sm text-on-surface-variant"
                      >{formatBytes(entry.bytes)}</span
                    >
                  {/if}
                  <span
                    class="inline-flex text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    aria-hidden="true"><Icon name="arrow-forward" size={18} /></span
                  >
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <div
      data-testid="shortcut-bar"
      class="flex flex-wrap items-center justify-center gap-2.5 rounded-full border border-outline-variant/30 bg-surface-container-low px-4 py-2 font-label-sm text-label-sm text-on-surface-variant shadow-xs"
    >
      <span class="flex items-center gap-1">
        {#if shortcutOf(shell, 'new', '⌘N')}
          <kbd
            class="rounded border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-0.5 font-medium text-on-surface"
            >{shortcutOf(shell, 'new', '⌘N')}</kbd
          >
        {/if}
        New
      </span>
      <span aria-hidden="true">•</span>
      <span class="flex items-center gap-1">
        {#if shortcutOf(shell, 'open', '⌘O')}
          <kbd
            class="rounded border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-0.5 font-medium text-on-surface"
            >{shortcutOf(shell, 'open', '⌘O')}</kbd
          >
        {/if}
        Open
      </span>
      <span aria-hidden="true">•</span>
      <span class="flex items-center gap-1">
        <kbd
          class="rounded border border-outline-variant/40 bg-surface-container-lowest px-1.5 py-0.5 font-medium text-on-surface"
          >{displayShortcut('⌘,')}</kbd
        >
        Preferences
      </span>
    </div>
  </div>
</div>
