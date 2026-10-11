<script lang="ts">
  import Icon from '@/shell/icons/Icon.svelte';
  import TabMenu from './TabMenu.svelte';
  import type { Shell } from './shell.svelte';
  import { tabIsDirty } from './tab';
  import { rovingIndex } from './toolbar';

  let { shell }: { shell: Shell } = $props();

  /** The tab list is one tab stop (the selected tab); the arrow keys move to and open the others. */
  function onKeyDown(event: KeyboardEvent) {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    const buttons = Array.from(
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        : [],
    );
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    const next = rovingIndex(event.key, index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  }

  /** The context menu of a tab: where it opens, and which tab it belongs to. */
  let menu = $state<{ id: number; x: number; y: number } | null>(null);

  /** Right click, or the context menu key on a focused tab (then at the tab's corner). */
  function onContextMenu(event: MouseEvent, id: number) {
    event.preventDefault();
    const fromKeyboard = event.button === 0 && event.clientX === 0 && event.clientY === 0;
    if (fromKeyboard && event.currentTarget instanceof HTMLElement) {
      const box = event.currentTarget.getBoundingClientRect();
      menu = { id, x: box.left, y: box.bottom };
    } else {
      menu = { id, x: event.clientX, y: event.clientY };
    }
  }

  /** Middle-click closes a tab (the primary button activates it, through `onclick`). */
  function onAuxClick(event: MouseEvent, id: number) {
    if (event.button !== 1) return;
    event.preventDefault();
    void shell.closeTabById(id);
  }

  /** The middle button also starts an auto-scroll in some browsers: stop it. */
  function onMouseDown(event: MouseEvent) {
    if (event.button === 1) event.preventDefault();
  }
</script>

<!--
  The visual strip. The tab list for assistive technology is the empty `tablist` inside it, which
  owns the tab buttons by id (`aria-owns`): the close buttons sit beside the tabs, and a tablist
  may only contain tabs.
  The arrow-key handler sits on this layout element because it is the tabs' DOM ancestor (the
  owning tablist is not), so it has no role of its own.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="tab-strip"
  onkeydown={onKeyDown}
  class="flex h-8 shrink-0 select-none items-end gap-px overflow-x-auto border-b border-outline-variant/30 bg-surface-container-low/60 px-space-sm"
>
  <div
    role="tablist"
    aria-label="Open documents"
    aria-owns={shell.tabs.map((tab) => `wd-tab-${tab.id}`).join(' ')}
    class="absolute h-0 w-0 overflow-hidden"
  ></div>
  {#each shell.tabs as tab (tab.id)}
    {@const selected = tab.id === shell.activeId}
    <div
      role="presentation"
      class="group relative flex h-7 max-w-56 min-w-24 items-center rounded-t-md border border-b-0 {selected
        ? 'border-outline-variant/40 bg-canvas'
        : 'border-transparent hover:bg-surface-container-high'}"
    >
      <button
        type="button"
        role="tab"
        id="wd-tab-{tab.id}"
        data-testid="tab"
        aria-selected={selected}
        tabindex={selected ? 0 : -1}
        onclick={() => void shell.activateTab(tab.id)}
        onauxclick={(event) => onAuxClick(event, tab.id)}
        oncontextmenu={(event) => onContextMenu(event, tab.id)}
        onmousedown={onMouseDown}
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-t-md pr-6 pl-2.5 text-left font-label-md text-label-md focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary {selected
          ? 'font-semibold text-on-surface'
          : 'text-on-surface-variant'}"
      >
        <span class="truncate">{tab.name}</span>
        {#if tabIsDirty(tab)}
          <span
            role="img"
            aria-label="Unsaved changes"
            data-testid="tab-dirty"
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"
          ></span>
        {/if}
      </button>
      <button
        type="button"
        data-testid="tab-close"
        aria-label="Close {tab.name}"
        tabindex={selected ? 0 : -1}
        onclick={() => void shell.closeTabById(tab.id)}
        class="absolute right-1 inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant opacity-0 transition-opacity hover:bg-surface-container-highest hover:text-on-surface group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  {/each}
</div>

{#if menu}
  {@const target = menu}
  <TabMenu
    x={target.x}
    y={target.y}
    canMove={shell.tabs.length >= 2}
    onMove={() => void shell.moveTabToNewWindowQueued(target.id)}
    onCloseTab={() => void shell.closeTabById(target.id)}
    onClose={() => {
      menu = null;
    }}
  />
{/if}
