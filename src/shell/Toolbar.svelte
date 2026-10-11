<script lang="ts">
  import type { MenuAction } from '@/lib/platform';
  import Icon from '@/shell/icons/Icon.svelte';
  import Menu from './Menu.svelte';
  import type { MenuItem } from './menu';
  import { shortcutOf } from './commands';
  import type { Shell } from './shell.svelte';
  import {
    BLOCK_GROUPS,
    HEADING_ENTRIES,
    rovingIndex,
    TEXT_BUTTONS,
    type ToolbarButton,
    tooltip,
    VIEW_BUTTONS,
  } from './toolbar';

  let { shell }: { shell: Shell } = $props();

  const tab = $derived(shell.active);
  const hasDocument = $derived(tab !== null);
  const canFormat = $derived(shell.menuState.canFormat);
  const view = $derived(tab?.view ?? null);
  const sidebarVisible = $derived(shell.settings.view.sidebarVisible);
  const syncOn = $derived(shell.settings.view.syncScroll);

  let insertOpen = $state(false);
  let insertTrigger: HTMLButtonElement | undefined = $state();
  let headingOpen = $state(false);
  let headingTrigger: HTMLButtonElement | undefined = $state();
  let viewGroup: HTMLDivElement | undefined = $state();

  const headingItems = $derived<MenuItem[]>(
    HEADING_ENTRIES.map((entry) => ({
      id: entry.action,
      label: entry.label,
      shortcut: shortcutOf(shell, entry.action, entry.shortcut),
      onSelect: () => void shell.run(entry.action),
    })),
  );

  const insertItems = $derived<MenuItem[]>(
    shell.inserts.map((entry) => ({
      id: entry.id,
      label: entry.label,
      onSelect: () => shell.runInsert(entry.id),
    })),
  );
  const hasInserts = $derived(hasDocument && shell.inserts.length > 0);

  function closeInsert() {
    insertOpen = false;
    insertTrigger?.focus();
  }

  function closeHeading() {
    headingOpen = false;
    headingTrigger?.focus();
  }

  function run(action: MenuAction) {
    void shell.run(action);
  }

  /** The segmented control is one tab stop; the arrow keys move between and choose the views. */
  function onViewKeyDown(event: KeyboardEvent) {
    const buttons = Array.from(viewGroup?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = rovingIndex(event.key, index < 0 ? 0 : index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    const button = buttons[next];
    button?.focus();
    button?.click();
  }

  const base =
    'inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant';
</script>

{#snippet tool(button: ToolbarButton)}
  <button
    type="button"
    data-testid="tool-{button.action}"
    aria-label={button.label}
    title={tooltip(button.label, shortcutOf(shell, button.action, button.shortcut))}
    disabled={!canFormat}
    onclick={() => run(button.action)}
    class="{base} font-label-md text-label-md"
  >
    {#if button.glyph === 'bold'}
      <strong class="font-bold" aria-hidden="true">B</strong>
    {:else if button.glyph === 'italic'}
      <em class="italic" aria-hidden="true">I</em>
    {:else if button.glyph === 'strike'}
      <span class="line-through" aria-hidden="true">S</span>
    {:else if button.icon}
      <Icon name={button.icon} size={16} />
    {/if}
  </button>
{/snippet}

{#snippet divider()}
  <span class="mx-1.5 h-3.5 w-px shrink-0 bg-outline-variant/40" aria-hidden="true"></span>
{/snippet}

<div
  role="toolbar"
  aria-label="Formatting and view"
  data-testid="toolbar"
  class="relative z-20 flex min-h-10 shrink-0 flex-wrap select-none items-center justify-between gap-x-2 gap-y-1 border-b border-outline-variant/30 bg-surface-container-lowest px-space-md"
>
  <div class="flex min-w-0 items-center gap-0.5">
    <button
      type="button"
      data-testid="toggle-sidebar"
      aria-label="Sidebar"
      aria-pressed={sidebarVisible}
      title={tooltip(sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar', shortcutOf(shell, 'toggle-sidebar', '⌃⌘S'))}
      onclick={() => run('toggle-sidebar')}
      class="{base} {sidebarVisible ? 'text-primary' : ''}"
    >
      <Icon name={sidebarVisible ? 'left-panel-close' : 'left-panel-open'} size={17} />
    </button>
    {@render divider()}

    {#each TEXT_BUTTONS as button (button.action)}
      {@render tool(button)}
    {/each}
    {@render divider()}

    <div class="relative" data-testid="heading-menu-wrap">
      <button
        bind:this={headingTrigger}
        type="button"
        data-testid="tool-heading"
        aria-haspopup="menu"
        aria-expanded={headingOpen}
        title="Heading"
        disabled={!canFormat}
        onclick={() => (headingOpen = !headingOpen)}
        class="{base} gap-0.5 pr-0.5 pl-2 font-label-md text-label-md text-on-surface"
      >
        <span>Heading</span>
        <Icon name="arrow-drop-down" size={18} />
      </button>
      {#if headingOpen}
        <Menu
          items={headingItems}
          label="Heading"
          testId="heading-menu"
          onClose={closeHeading}
        />
      {/if}
    </div>

    {#each BLOCK_GROUPS as group, index (index)}
      {#if index > 0}{@render divider()}{/if}
      {#each group as button (button.action)}
        {@render tool(button)}
      {/each}
    {/each}

    {#if hasInserts}
      {@render divider()}
      <div class="relative" data-testid="insert-menu-wrap">
        <button
          bind:this={insertTrigger}
          type="button"
          data-testid="tool-insert"
          aria-haspopup="menu"
          aria-expanded={insertOpen}
          title="Insert"
          disabled={!canFormat}
          onclick={() => (insertOpen = !insertOpen)}
          class="{base} gap-0.5 pr-0.5 pl-1.5 font-label-md text-label-md text-on-surface"
        >
          <Icon name="add-box" size={16} />
          <span>Insert</span>
          <Icon name="arrow-drop-down" size={18} />
        </button>
        {#if insertOpen && canFormat}
          <Menu items={insertItems} label="Insert" testId="insert-menu" onClose={closeInsert} />
        {/if}
      </div>
    {/if}
  </div>

  <div class="flex shrink-0 items-center gap-2">
    <div
      bind:this={viewGroup}
      role="radiogroup"
      aria-label="View"
      data-testid="view-switch"
      tabindex="-1"
      onkeydown={onViewKeyDown}
      class="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-high p-0.5 {hasDocument
        ? ''
        : 'opacity-60'}"
    >
      {#each VIEW_BUTTONS as button (button.mode)}
        {@const selected = view === button.mode}
        <button
          type="button"
          role="radio"
          data-testid="view-{button.mode}"
          aria-checked={selected}
          aria-label={button.label}
          title={tooltip(button.label, shortcutOf(shell, `view-${button.mode}`, button.shortcut))}
          disabled={!hasDocument}
          tabindex={selected || (view === null && button.mode === 'split') ? 0 : -1}
          onclick={() => run(`view-${button.mode}`)}
          class="inline-flex h-6 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary {selected
            ? 'bg-surface-container-lowest text-primary shadow-sm'
            : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'}"
        >
          <Icon name={button.icon} size={15} />
        </button>
      {/each}
    </div>

    {@render divider()}

    <button
      type="button"
      role="switch"
      data-testid="sync-scroll"
      aria-checked={syncOn}
      aria-label={syncOn ? 'Sync Scroll Active' : 'Sync Scroll Off'}
      title={tooltip(syncOn ? 'Sync Scroll is on: click to turn it off' : 'Sync Scroll is off: click to turn it on')}
      disabled={!hasDocument}
      onclick={() => run('toggle-sync-scroll')}
      class="inline-flex h-6 items-center gap-1.5 rounded border px-2 font-label-md text-label-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-40 {syncOn
        ? 'border-primary/20 bg-primary/10 text-primary'
        : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'}"
    >
      <Icon name={syncOn ? 'sync' : 'sync-disabled'} size={14} />
      <span class="hidden font-medium lg:inline">{syncOn ? 'Sync Scroll Active' : 'Sync Scroll Off'}</span>
      {#if syncOn}<span class="hidden lg:inline-flex"><Icon name="link" size={13} /></span>{/if}
    </button>

    <button
      type="button"
      data-testid="open-preferences"
      aria-label="Preferences"
      title={tooltip('Preferences', '⌘,')}
      onclick={() => void shell.openPreferences()}
      class={base}
    >
      <Icon name="tune" size={16} />
    </button>
  </div>
</div>
