<script lang="ts">
  import Icon from '@/shell/icons/Icon.svelte';
  import type { Shell } from '../shell.svelte';
  import { rovingIndex } from '../toolbar';
  import {
    currentSectionIndex,
    depthLabel,
    filterByDepth,
    OUTLINE_DEPTHS,
    type OutlineDepth,
    sectionCountLabel,
    shownCurrent,
  } from './index';

  let { shell }: { shell: Shell } = $props();

  /** The item that had the focus last, so Tab comes back to it. */
  let focused = $state<number | null>(null);

  const tab = $derived(shell.active);
  const headings = $derived(tab?.headings ?? []);
  const entries = $derived(filterByDepth(headings, shell.outlineDepth));
  const current = $derived(currentSectionIndex(headings, shell.outlineLine));
  const shownIndex = $derived(shownCurrent(entries, current));
  /** The one item that is a tab stop: the one that last had the focus, else the current one. */
  const stop = $derived(Math.min(focused ?? shownIndex ?? 0, entries.length - 1));

  let list: HTMLUListElement | undefined = $state();
  let depthGroup: HTMLDivElement | undefined = $state();

  // The current section stays in view when the caret or the preview moves to another one.
  $effect(() => {
    if (shownIndex === null || !list) return;
    const item = list.querySelectorAll<HTMLElement>('li > button')[shownIndex];
    item?.scrollIntoView({ block: 'nearest' });
  });

  /** Up and Down move through the outline, Home and End jump; Return and Space open an item. */
  function onListKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') return;
    const buttons = Array.from(list?.querySelectorAll<HTMLButtonElement>('li > button') ?? []);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = rovingIndex(event.key, index < 0 ? 0 : index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
  }

  function onDepthKeyDown(event: KeyboardEvent) {
    const buttons = Array.from(depthGroup?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = rovingIndex(event.key, index < 0 ? 0 : index, buttons.length);
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  }

  function badgeClass(level: number, isCurrent: boolean): string {
    if (isCurrent) return 'bg-primary text-on-primary font-semibold';
    if (level === 1) return 'bg-primary/10 text-primary font-bold';
    if (level === 2) return 'bg-secondary-fixed text-on-secondary-fixed-variant font-medium';
    return 'bg-surface-container-highest text-on-surface-variant font-medium';
  }

  function chooseDepth(depth: OutlineDepth) {
    shell.outlineDepth = depth;
  }
</script>

<div
  class="mb-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-outline-variant/30 px-1 pb-2"
>
  <div class="flex shrink-0 items-center gap-1.5">
    <span class="inline-flex text-primary"><Icon name="format-list-bulleted" size={17} /></span>
    <span class="whitespace-nowrap font-headline-sm text-[length:calc(12.5px*var(--wd-scale,1))] font-bold tracking-tight text-on-surface"
      >Document Outline</span
    >
  </div>
  {#if tab}
    <span
      data-testid="outline-count"
      class="whitespace-nowrap rounded bg-surface-container-highest px-1.5 py-0.5 font-body-sm text-[length:calc(10px*var(--wd-scale,1))] font-medium text-on-surface-variant"
      >{sectionCountLabel(entries.length, headings.length)}</span
    >
  {/if}
</div>

{#if !tab}
  <div
    data-testid="outline-no-document"
    class="my-2 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-lowest/50 p-4 text-center"
  >
    <span
      class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
    >
      <Icon name="subject" size={20} />
    </span>
    <p class="mb-1 font-label-md text-label-md font-semibold text-on-surface">
      No Active Document
    </p>
    <p class="font-body-sm text-[length:calc(12px*var(--wd-scale,1))] leading-relaxed text-on-surface-variant">
      Open or create a Markdown file to inspect its structure and headings.
    </p>
    <button
      type="button"
      data-testid="outline-open-guide"
      onclick={() => void shell.run('markdown-guide')}
      class="mt-3 flex items-center gap-1 rounded px-1 font-label-md text-label-md font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      <Icon name="add" size={14} />
      Open the Markdown guide
    </button>
  </div>
{:else if headings.length === 0}
  <p
    data-testid="outline-empty"
    class="flex-1 px-2 py-3 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] leading-relaxed text-on-surface-variant"
  >
    No headings yet. Start a line with # to add one.
  </p>
{:else}
  <!-- The list handles keys that bubble up from its buttons (a roving focus). -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    bind:this={list}
    data-testid="outline-list"
    class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
    onkeydown={onListKeyDown}
  >
    {#each entries as entry, position (entry.heading.line)}
      {@const isCurrent = position === shownIndex}
      <li>
        <button
          type="button"
          data-testid="outline-item"
          data-level={entry.heading.level}
          data-line={entry.heading.line}
          aria-current={isCurrent ? 'location' : undefined}
          tabindex={position === stop ? 0 : -1}
          onfocus={() => (focused = position)}
          onclick={() => shell.goToHeading(entry.heading)}
          class="wd-outline-indent-{Math.min(6, Math.max(1, entry.heading.level))} flex w-full cursor-pointer items-start gap-1.5 rounded-md py-1.5 pr-2 text-left font-label-md text-[length:calc(12px*var(--wd-scale,1))] leading-tight transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary {isCurrent
            ? 'border-l-2 border-primary bg-primary/10 font-semibold text-primary'
            : 'text-on-surface hover:bg-surface-container-highest'}"
        >
          <span
            class="mt-0.5 shrink-0 rounded px-1 py-0.5 font-mono text-[length:calc(10px*var(--wd-scale,1))] {badgeClass(
              entry.heading.level,
              isCurrent,
            )}">H{entry.heading.level}</span
          >
          <span class="min-w-0 break-words">{entry.heading.text}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if tab}
  <div
    class="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-outline-variant/30 px-2 pt-2 font-label-sm text-label-sm text-on-surface-variant"
  >
    <div class="flex items-center gap-1" aria-hidden="true">
      <Icon name="filter-list" size={14} />
      <span>Depth</span>
    </div>
    <div
      bind:this={depthGroup}
      role="radiogroup"
      aria-label="Depth"
      data-testid="outline-depth"
      tabindex="-1"
      onkeydown={onDepthKeyDown}
      class="flex max-w-full flex-wrap items-center gap-0.5 rounded-md bg-surface-container-high p-0.5"
    >
      {#each OUTLINE_DEPTHS as depth (depth)}
        {@const selected = shell.outlineDepth === depth}
        <button
          type="button"
          role="radio"
          data-testid="outline-depth-{depth}"
          aria-checked={selected}
          tabindex={selected ? 0 : -1}
          onclick={() => chooseDepth(depth)}
          class="min-h-6 min-w-6 rounded px-1.5 py-0.5 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary {selected
            ? 'bg-surface-container-lowest text-primary shadow-sm'
            : 'hover:bg-surface-container-highest hover:text-on-surface'}"
          >{depthLabel(depth)}</button
        >
      {/each}
    </div>
  </div>
{/if}

