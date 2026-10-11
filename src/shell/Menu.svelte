<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@/shell/icons/Icon.svelte';
  import type { MenuItem } from './menu';

  interface Props {
    items: MenuItem[];
    label: string;
    onClose: () => void;
    /** Which edge of the trigger the menu lines up with. */
    align?: 'left' | 'right';
    testId?: string;
  }

  let { items, label, onClose, align = 'left', testId }: Props = $props();

  let menu: HTMLDivElement | undefined = $state();

  function enabled(): HTMLButtonElement[] {
    return menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      : [];
  }

  onMount(() => {
    // The current radio entry gets the focus, else the first entry.
    const current = menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (current ?? enabled()[0])?.focus();
  });

  function onKeyDown(event: KeyboardEvent) {
    const buttons = enabled();
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (event.key === 'ArrowDown') buttons[(index + 1) % buttons.length]?.focus();
    else if (event.key === 'ArrowUp') {
      buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home') buttons[0]?.focus();
    else if (event.key === 'End') buttons[buttons.length - 1]?.focus();
    else if (event.key === 'Escape') onClose();
    else if (event.key === 'Tab') onClose();
    else return;
    if (event.key !== 'Tab') event.preventDefault();
  }

  /** A press outside the menu and its trigger (the parent element) closes it. */
  function onWindowPointerDown(event: PointerEvent) {
    const owner = menu?.parentElement;
    if (owner && event.target instanceof Node && !owner.contains(event.target)) onClose();
  }

  function choose(item: MenuItem) {
    if (item.disabled) return;
    onClose();
    item.onSelect();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
  bind:this={menu}
  role="menu"
  aria-label={label}
  data-testid={testId}
  tabindex="-1"
  onkeydown={onKeyDown}
  class="absolute top-full z-50 mt-1 min-w-52 rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-1 shadow-lg {align ===
  'right'
    ? 'right-0'
    : 'left-0'}"
>
  {#each items as item (item.id)}
    <button
      type="button"
      role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={item.checked === undefined ? undefined : item.checked}
      disabled={item.disabled}
      onclick={() => choose(item)}
      class="flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left font-label-md text-label-md text-on-surface hover:bg-surface-container-high focus-visible:bg-surface-container-high focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:text-on-surface-variant/60 disabled:hover:bg-transparent"
    >
      <span class="inline-flex w-4 shrink-0 text-primary">
        {#if item.checked}<Icon name="check" size={15} />{/if}
      </span>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{item.label}</span>
        {#if item.note}
          <span class="truncate text-on-surface-variant">{item.note}</span>
        {/if}
      </span>
      {#if item.shortcut}
        <kbd class="ml-4 shrink-0 font-label-sm text-label-sm text-on-surface-variant"
          >{item.shortcut}</kbd
        >
      {/if}
    </button>
  {/each}
</div>
