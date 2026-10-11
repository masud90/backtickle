<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    /** Where the menu opens, in window coordinates (the pointer, or the tab for the keyboard). */
    x: number;
    y: number;
    /** The tab has company: Move Tab to New Window needs another tab to stay behind. */
    canMove: boolean;
    onMove: () => void;
    onCloseTab: () => void;
    onClose: () => void;
  }

  let { x, y, canMove, onMove, onCloseTab, onClose }: Props = $props();

  let menu: HTMLDivElement | undefined = $state();

  function enabled(): HTMLButtonElement[] {
    return menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      : [];
  }

  onMount(() => enabled()[0]?.focus());

  function onKeyDown(event: KeyboardEvent) {
    const buttons = enabled();
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus();
    else if (event.key === 'ArrowUp') {
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home') buttons[0]?.focus();
    else if (event.key === 'End') buttons[buttons.length - 1]?.focus();
    else if (event.key === 'Escape' || event.key === 'Tab') onClose();
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  }

  function onWindowPointerDown(event: PointerEvent) {
    if (menu && event.target instanceof Node && !menu.contains(event.target)) onClose();
  }

  function choose(action: () => void) {
    action();
    onClose();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  bind:this={menu}
  role="menu"
  aria-label="Tab"
  data-testid="tab-menu"
  tabindex="-1"
  onkeydown={onKeyDown}
  style:left="{x}px"
  style:top="{y}px"
  class="fixed z-50 min-w-52 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-1 shadow-lg"
>
  <button
    type="button"
    role="menuitem"
    data-testid="tab-menu-move"
    disabled={!canMove}
    onclick={() => choose(onMove)}
    class="flex w-full select-none items-center rounded-md px-2 py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:text-on-surface-variant/60 disabled:hover:bg-transparent"
  >
    Move Tab to New Window
  </button>
  <button
    type="button"
    role="menuitem"
    data-testid="tab-menu-close"
    onclick={() => choose(onCloseTab)}
    class="flex w-full select-none items-center rounded-md px-2 py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
  >
    Close Tab
  </button>
</div>
