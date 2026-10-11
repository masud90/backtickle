<script lang="ts">
  import { type Component, untrack } from 'svelte';
  import type { IconName } from '@/shell/icons';
  import Icon from '@/shell/icons/Icon.svelte';
  import type { SidebarTab } from './commands';
  import Outline from './outline/Outline.svelte';
  import type { Shell } from './shell.svelte';
  import { clampSidebarWidth, DEFAULT_SIDEBAR_WIDTH, SIDEBAR_KEY_STEP } from './sidebar';
  import { rovingIndex } from './toolbar';

  let { shell }: { shell: Shell } = $props();

  const TABS: ReadonlyArray<{ id: SidebarTab; label: string; icon: IconName }> = [
    { id: 'outline', label: 'Outline', icon: 'format-list-bulleted' },
    { id: 'files', label: 'Files', icon: 'folder' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'snippets', label: 'Snippets', icon: 'text-snippet' },
  ];

  const selected = $derived(shell.sidebarTab);

  // The Files panel is a lazy chunk: the welcome screen and a GFM document never load it.
  let FilesPanel = $state.raw<Component<{ shell: Shell }> | null>(null);
  $effect(() => {
    if (selected === 'files' && !FilesPanel) {
      void import('./files/FilesPanel.svelte').then((module) => {
        FilesPanel = module.default;
      });
    }
  });

  // Same for the Search panel.
  let SearchPanel = $state.raw<Component<{ shell: Shell }> | null>(null);
  $effect(() => {
    if (selected === 'search' && !SearchPanel) {
      void import('./search/SearchPanel.svelte').then((module) => {
        SearchPanel = module.default;
      });
    }
  });

  // Same for the Snippets panel.
  let SnippetsPanel = $state.raw<Component<{ shell: Shell }> | null>(null);
  $effect(() => {
    if (selected === 'snippets' && !SnippetsPanel) {
      void import('./snippets/SnippetsPanel.svelte').then((module) => {
        SnippetsPanel = module.default;
      });
    }
  });

  let nav: HTMLElement | undefined = $state();
  let tabList: HTMLDivElement | undefined = $state();
  let width = $state(untrack(() => clampSidebarWidth(shell.settings.view.sidebarWidth)));
  let dragging = $state(false);

  // The width is also stored in the settings (and may change in another window).
  $effect(() => {
    const stored = clampSidebarWidth(shell.settings.view.sidebarWidth);
    if (!untrack(() => dragging) && stored !== untrack(() => width)) width = stored;
  });

  function setWidth(next: number) {
    width = clampSidebarWidth(next);
    shell.setSidebarWidth(width);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging = true;
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging || !nav) return;
    setWidth(event.clientX - nav.getBoundingClientRect().left);
  }

  function onPointerEnd(event: PointerEvent) {
    dragging = false;
    const target = event.currentTarget;
    if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  }

  function onHandleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') setWidth(width - SIDEBAR_KEY_STEP);
    else if (event.key === 'ArrowRight') setWidth(width + SIDEBAR_KEY_STEP);
    else if (event.key === 'Enter' || event.key === 'Home') setWidth(DEFAULT_SIDEBAR_WIDTH);
    else return;
    event.preventDefault();
  }

  /** Left and Right (and Home and End) move between the tabs and select the one reached. */
  function onTabKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') return;
    const index = TABS.findIndex((entry) => entry.id === selected);
    const next = rovingIndex(event.key, index < 0 ? 0 : index, TABS.length);
    if (next === null) return;
    event.preventDefault();
    const entry = TABS[next];
    if (!entry) return;
    shell.setSidebarTab(entry.id);
    tabList?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  const NAV_LABEL: Record<SidebarTab, string> = {
    outline: 'Document outline',
    files: 'Folder files',
    search: 'Folder search',
    snippets: 'Snippets',
  };
</script>

<nav
  bind:this={nav}
  aria-label={NAV_LABEL[selected]}
  data-testid="sidebar"
  style:width="{width}px"
  class="wd-vibrant relative flex shrink-0 select-none flex-col border-r border-outline-variant/30 bg-surface-container-low/70 p-space-sm"
>
  <!-- The keys of the tab buttons bubble up to the tab list (a roving focus). -->
  <!-- svelte-ignore a11y_interactive_supports_focus -->
  <div
    bind:this={tabList}
    role="tablist"
    aria-label="Sidebar"
    data-testid="sidebar-tabs"
    onkeydown={onTabKeyDown}
    class="mb-2 flex flex-wrap items-center gap-0.5 rounded-md bg-surface-container-high p-0.5 font-label-md text-label-md"
  >
    {#each TABS as entry (entry.id)}
      {@const isSelected = selected === entry.id}
      <button
        type="button"
        role="tab"
        id="sidebar-tab-{entry.id}"
        data-testid="sidebar-tab-{entry.id}"
        aria-selected={isSelected}
        aria-label={entry.label}
        title={entry.label}
        aria-controls="sidebar-panel"
        tabindex={isSelected ? 0 : -1}
        onclick={() => shell.setSidebarTab(entry.id)}
        class="flex min-h-[calc(24px*var(--wd-scale,1))] min-w-fit flex-1 items-center justify-center gap-1 rounded px-1.5 py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary {isSelected
          ? 'bg-surface-container-lowest text-primary shadow-sm'
          : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'}"
      >
        <Icon name={entry.icon} size={14} />
        {#if isSelected}
          <span class="whitespace-nowrap">{entry.label}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div
    role="tabpanel"
    id="sidebar-panel"
    aria-labelledby="sidebar-tab-{selected}"
    data-testid="sidebar-panel"
    class="flex min-h-0 flex-1 flex-col"
  >
    {#if selected === 'outline'}
      <Outline {shell} />
    {:else if selected === 'files'}
      {#if FilesPanel}<FilesPanel {shell} />{/if}
    {:else if selected === 'search'}
      {#if SearchPanel}<SearchPanel {shell} />{/if}
    {:else if SnippetsPanel}
      <SnippetsPanel {shell} />
    {/if}
  </div>

  <!-- A focusable separator, the same pattern as the splitter between the panes. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    data-testid="sidebar-resize"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuemin={180}
    aria-valuemax={480}
    aria-valuenow={Math.round(width)}
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerEnd}
    onpointercancel={onPointerEnd}
    ondblclick={() => setWidth(DEFAULT_SIDEBAR_WIDTH)}
    onkeydown={onHandleKeyDown}
    data-dragging={dragging}
    class="group absolute inset-y-0 right-0 z-10 flex w-6 translate-x-1/2 cursor-col-resize touch-none justify-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
  >
    <!-- The highlight stays 6 px wide; the element around it is the 24 px hit area. -->
    <span
      class="h-full w-1.5 transition-colors group-hover:bg-primary/30 group-focus-visible:bg-primary/30 group-data-[dragging=true]:bg-primary/30"
      aria-hidden="true"
    ></span>
  </div>
</nav>
