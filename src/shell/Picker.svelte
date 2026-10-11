<script lang="ts">
  /**
   * A modal list with a text field (the combobox and listbox pattern) for Quick Open and the
   * command palette. The caller owns the filtering: it gets every change of the query through
   * `query` and passes the rows to show in `items`. Up and Down move through the rows (wrapping),
   * Return chooses the selected one, Escape closes, a click on a row chooses it. The focus stays
   * in the field; the selected row is announced through `aria-activedescendant`.
   */
  import { onMount, tick } from 'svelte';
  import { labelSegments, nextRow, type PickerItem } from './picker';

  interface Props {
    items: readonly PickerItem[];
    /** The accessible name of the dialog and the field. */
    label: string;
    placeholder?: string;
    query?: string;
    emptyText?: string;
    onChoose: (item: PickerItem) => void;
    onClose: () => void;
  }

  let {
    items,
    label,
    placeholder = '',
    query = $bindable(''),
    emptyText = 'No matches',
    onChoose,
    onClose,
  }: Props = $props();

  const uid = $props.id();
  let selected = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();

  // A new list starts at its first row that can be chosen.
  $effect(() => {
    const rows = items;
    selected = Math.max(
      0,
      rows.findIndex((row) => !row.disabled),
    );
  });

  // The selected row stays in view.
  $effect(() => {
    const row = selected;
    void tick().then(() => list?.children[row]?.scrollIntoView({ block: 'nearest' }));
  });

  onMount(() => {
    const previous = document.activeElement;
    input?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  });

  function choose(index: number) {
    const item = items[index];
    if (item && !item.disabled) onChoose(item);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = nextRow(items, selected, event.key === 'ArrowDown' ? 1 : -1);
      if (next >= 0) selected = next;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }
</script>

<!-- The backdrop closes on a click; Escape does the same from the keyboard. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  data-testid="picker-backdrop"
  class="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[calc(128px*var(--wd-scale,1))]"
  onclick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
>
  <div
    role="dialog"
    aria-modal="true"
    aria-label={label}
    data-testid="picker"
    class="flex max-h-[60vh] w-[min(calc(560px*var(--wd-scale,1)),92vw)] flex-col overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-[0_2px_6px_rgba(0,0,0,0.25),0_18px_48px_rgba(0,0,0,0.45)]"
  >
    <input
      bind:this={input}
      bind:value={query}
      type="text"
      role="combobox"
      data-testid="picker-input"
      aria-label={label}
      aria-expanded="true"
      aria-controls="{uid}-list"
      aria-autocomplete="list"
      aria-activedescendant={items.length > 0 ? `${uid}-row-${selected}` : undefined}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      {placeholder}
      onkeydown={onKeyDown}
      class="w-full border-b border-outline-variant/30 bg-transparent px-space-md py-2.5 font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant focus:outline-none"
    />
    <ul
      bind:this={list}
      id="{uid}-list"
      role="listbox"
      aria-label={label}
      data-testid="picker-list"
      class="min-h-0 flex-1 overflow-y-auto p-1"
    >
      {#each items as item, index (item.id)}
        <!-- Options are not focusable: the field keeps the focus (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{uid}-row-{index}"
          role="option"
          data-testid="picker-row"
          aria-selected={index === selected}
          aria-disabled={item.disabled ? true : undefined}
          onclick={() => choose(index)}
          onpointermove={() => {
            if (!item.disabled && selected !== index) selected = index;
          }}
          class="flex cursor-default items-baseline justify-between gap-3 rounded-md px-2 py-1.5 font-label-md text-label-md {index ===
          selected
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface'} {item.disabled ? 'opacity-50' : ''}"
        >
          <span class="min-w-0 truncate"
            >{#each labelSegments(item.label, item.matches) as segment}{#if segment.marked}<mark
                  data-testid="picker-match"
                  class="bg-transparent font-bold text-primary underline">{segment.text}</mark
                >{:else}{segment.text}{/if}{/each}</span
          >
          {#if item.detail}
            <span class="shrink-0 truncate text-on-surface-variant">{item.detail}</span>
          {/if}
        </li>
      {:else}
        <li data-testid="picker-empty" class="px-2 py-3 text-on-surface-variant font-body-sm text-body-sm">
          {emptyText}
        </li>
      {/each}
    </ul>
  </div>
</div>
