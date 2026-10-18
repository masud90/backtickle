<script lang="ts">
  import { byOs, isMac } from '@/lib/os';
  import AppMark from '@/shell/icons/AppMark.svelte';
  import Icon from '@/shell/icons/Icon.svelte';
  import { shortcutOf } from './commands';
  import FlavorPill from './FlavorPill.svelte';
  import Menu from './Menu.svelte';
  import type { MenuItem } from './menu';
  import type { Shell } from './shell.svelte';
  import { tabIsDirty } from './tab';
  import { locationName, saveStatusText } from './time';

  let { shell }: { shell: Shell } = $props();

  /** Windows and Linux draw a native title bar above the page (see the comment on the header). */
  const nativeTitleBar = !isMac();

  const tab = $derived(shell.active);
  const dirty = $derived(tab ? tabIsDirty(tab) : false);
  const status = $derived(
    tab
      ? saveStatusText(
          { hasPath: tab.path !== null, dirty, savedAtMs: tab.savedAtMs, location: tab.location },
          shell.now,
        )
      : '',
  );
  const cloud = $derived(tab ? locationName(tab.location) : null);
  // With one document there is no tab strip, so its close button lives here.
  const showClose = $derived(tab !== null && shell.tabs.length === 1);

  let menuOpen = $state(false);
  let menuTrigger: HTMLButtonElement | undefined = $state();

  const menuItems = $derived<MenuItem[]>([
    {
      id: 'rename',
      label: 'Rename…',
      disabled: !tab?.path,
      onSelect: () => void shell.run('rename'),
    },
    {
      id: 'move-to',
      label: 'Move To…',
      disabled: !tab?.path,
      onSelect: () => void shell.run('move-to'),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      disabled: !tab?.path,
      onSelect: () => void shell.run('duplicate'),
    },
    {
      id: 'revert',
      label: 'Revert to Saved',
      disabled: !tab?.path,
      onSelect: () => void shell.run('revert'),
    },
    {
      id: 'reveal',
      label: byOs('Reveal in Finder', 'Show in File Explorer', 'Show in File Manager'),
      disabled: !tab?.path,
      onSelect: () => void shell.enqueue(() => shell.revealActive()),
    },
    {
      id: 'copy-path',
      label: 'Copy Path',
      disabled: !tab?.path,
      onSelect: () => void shell.enqueue(() => shell.copyActivePath()),
    },
  ]);

  // The centered app name is decorative: it is hidden (still laid out, so it can be measured) when
  // it would touch any other item in the bar, at any interface scale or window width.
  let header: HTMLElement | undefined = $state();
  let titleFits = $state(true);

  function measureTitle() {
    if (!header) return;
    const title = header.querySelector<HTMLElement>('[data-testid="app-title"]');
    if (!title) return;
    const t = title.getBoundingClientRect();
    const gap = 8;
    let fits = true;
    for (const child of Array.from(header.children)) {
      if (child === title) continue;
      const r = child.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < t.right + gap && r.right > t.left - gap) {
        fits = false;
        break;
      }
    }
    titleFits = fits;
  }

  $effect(() => {
    if (!header) return;
    const el = header;
    const observer = new ResizeObserver(measureTitle);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    measureTitle();
    return () => observer.disconnect();
  });

  // Content changes (document name, status text) resize the children; observe again after each one.
  $effect(() => {
    void tab?.name;
    void status;
    void shell.exporting;
    void dirty;
    void showClose;
    queueMicrotask(measureTitle);
  });

  function closeMenu() {
    menuOpen = false;
    menuTrigger?.focus();
  }
</script>

<!--
  The overlay title bar: the macOS traffic lights float over the left end of this header (their
  position is set in tauri.conf.json, trafficLightPosition). The left padding keeps the content
  clear of them. The header is a drag region for the whole subtree: buttons stay clickable, the
  rest drags the window. Text here is not selectable.
  On Windows and Linux the window has a native title bar and menu bar above the page: this header
  is a plain bar there, with no drag region and no space for traffic lights.
-->
<header
  bind:this={header}
  data-tauri-drag-region={nativeTitleBar ? undefined : 'deep'}
  data-testid="title-bar"
  class="relative flex h-[44px] shrink-0 cursor-default select-none items-center gap-3 border-b border-outline-variant/30 bg-surface-container-low/80 {nativeTitleBar
    ? 'pl-space-md'
    : 'pl-[84px]'} pr-space-md"
>
  {#if !nativeTitleBar}
    <span class="h-4 w-px bg-outline-variant/40" aria-hidden="true"></span>
  {/if}

  <button
    type="button"
    data-testid="new-button"
    onclick={() => void shell.run('new')}
    class="flex h-7 items-center gap-1 rounded-md border border-outline-variant/40 bg-surface-container px-2.5 font-label-md text-label-md transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary active:scale-95"
  >
    <span class="inline-flex text-primary"><Icon name="add" size={15} /></span>
    <span class="font-medium text-on-surface">New</span>
  </button>

  {#if tab}
    {#if showClose}
      <button
        type="button"
        data-testid="close-document-button"
        aria-label="Close document"
        title="Close document"
        onclick={() => void shell.run('close-tab')}
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Icon name="close" size={16} />
      </button>
    {/if}
    <div class="relative flex min-w-0 items-center" data-testid="document-menu-wrap">
      <div class="flex min-w-0 items-center gap-1.5 px-2" data-testid="document-name">
        <span class="inline-flex text-primary"><Icon name="description" size={17} /></span>
        <span
          class="truncate font-headline-sm text-headline-sm font-semibold tracking-tight text-on-surface"
          >{tab.name}</span
        >
        {#if dirty}
          <span
            data-testid="dirty-dot"
            role="img"
            aria-label="Unsaved changes"
            title="Unsaved changes"
            class="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-primary/70"
          ></span>
        {/if}
      </div>
      <button
        bind:this={menuTrigger}
        type="button"
        data-testid="document-menu-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Document menu"
        onclick={() => (menuOpen = !menuOpen)}
        class="inline-flex h-6 w-6 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Icon name="expand-more" size={14} />
      </button>
      {#if menuOpen}
        <Menu items={menuItems} label="Document menu" testId="document-menu" onClose={closeMenu} />
      {/if}
    </div>

    <div
      data-testid="save-status"
      class="hidden items-center gap-1.5 rounded-full bg-surface-container-highest/60 px-2 py-0.5 font-label-md text-label-md text-on-surface-variant lg:flex"
    >
      {#if cloud}
        <span class="inline-flex text-tertiary" aria-hidden="true"
          ><Icon name="cloud-done" size={13} /></span
        >
      {/if}
      <span>{shell.exporting ? 'Exporting…' : status}</span>
    </div>
  {/if}

  <!-- Centered on the window, not on the space left between the other items. -->
  <div
    data-testid="app-title"
    aria-hidden={titleFits ? undefined : 'true'}
    class:invisible={!titleFits}
    class="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap font-headline-sm text-headline-sm font-semibold text-on-surface"
  >
    <span class="inline-flex text-primary"><AppMark variant="glyph" size={16} /></span>
    <span>Backtickle</span>
  </div>

  <div class="ml-auto flex items-center gap-2">
    {#if tab}
      <FlavorPill
        flavor={tab.flavor}
        reason={shell.settings.preview.autoDetectFlavor || tab.reason === 'chosen'
          ? tab.reason
          : null}
        onChoose={(flavor) => void shell.chooseFlavorQueued(flavor)}
      />
    {:else}
      <FlavorPill
        flavor={shell.settings.defaultFlavor}
        reason={null}
        label="Default flavor for new documents"
        onChoose={(flavor) => flavor && void shell.setDefaultFlavor(flavor)}
      />
    {/if}
    <span class="h-4 w-px bg-outline-variant/40" aria-hidden="true"></span>
    <button
      type="button"
      data-testid="save-button"
      disabled={!tab}
      onclick={() => void shell.run('save')}
      class="flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 font-label-md text-label-md text-on-primary shadow-sm transition-all hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary active:scale-[0.98] disabled:opacity-50 disabled:hover:bg-primary"
    >
      <Icon name="save" size={15} />
      <span class="font-semibold">Save</span>
      {#if shortcutOf(shell, 'save', '⌘S')}
        <kbd class="ml-0.5 rounded bg-white/10 px-1 py-0.5 font-label-sm text-label-sm text-on-primary"
          >{shortcutOf(shell, 'save', '⌘S')}</kbd
        >
      {/if}
    </button>
  </div>
</header>
