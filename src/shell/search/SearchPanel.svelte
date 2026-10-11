<script lang="ts">
  /** The Search tab of the sidebar. */
  import { tick } from 'svelte';
  import type { Shell } from '../shell.svelte';
  import Icon from '../icons/Icon.svelte';
  import { getSearchModel } from './model.svelte';
  import { capsNote, hitSegments, resultPlace, summary } from './results';

  let { shell }: { shell: Shell } = $props();

  // The shell never changes for a mounted panel.
  // svelte-ignore state_referenced_locally
  const model = getSearchModel(shell);
  const folder = $derived(model.folder);
  const result = $derived(model.result);

  let input: HTMLInputElement | undefined = $state();
  let results: HTMLElement | undefined = $state();

  // A new folder means a new search (when there is a query).
  let lastFolder: string | null | undefined;
  $effect(() => {
    const current = folder;
    if (lastFolder !== undefined && lastFolder !== current && model.query !== '') model.schedule();
    lastFolder = current;
  });

  $effect(() => {
    if (model.focusPending && input) {
      input.focus();
      input.select();
      model.focusPending = false;
    }
  });

  function onInput() {
    model.schedule();
  }

  function items(): HTMLElement[] {
    return results ? [...results.querySelectorAll<HTMLElement>('[data-search-item]')] : [];
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.target === input) {
      event.preventDefault();
      void model.run();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (document.activeElement === input) {
      if (event.key === 'ArrowUp') return;
      next = 0;
    } else if (at < 0) {
      return;
    } else if (event.key === 'ArrowUp' && at === 0) {
      input?.focus();
      event.preventDefault();
      return;
    } else {
      next = at + (event.key === 'ArrowDown' ? 1 : -1);
    }
    const target = list[next];
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  async function open(path: string, line: number, text: string, start: number) {
    await shell.showSearchHit(path, line, text, start);
    await tick();
  }
</script>

<!-- Arrow keys move between the field and the results. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="search-panel"
  class="flex min-h-0 flex-1 flex-col"
  onkeydown={onKeyDown}
>
  {#if !folder}
    <div class="flex flex-1 flex-col items-center px-3 pt-10 text-center">
      <p
        data-testid="search-empty"
        class="mb-1 font-label-md text-label-md font-semibold text-on-surface"
      >
        Open a folder to search it
      </p>
      <button
        type="button"
        data-testid="search-open-folder"
        onclick={() => void shell.run('open-folder')}
        class="mt-2 flex items-center gap-1 rounded px-1 font-label-md text-label-md font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        Open Folder…
      </button>
    </div>
  {:else}
    <div class="mb-1 flex items-center gap-1 px-1">
      <input
        bind:this={input}
        bind:value={model.query}
        oninput={onInput}
        type="text"
        data-testid="search-input"
        aria-label="Search in folder"
        aria-invalid={result?.error ? true : undefined}
        aria-describedby={result?.error ? 'search-error' : undefined}
        placeholder="Search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        class="min-w-0 flex-1 rounded border border-outline-variant/50 bg-surface-container-lowest px-2 py-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
      />
      {#each [{ key: 'caseSensitive', label: 'Match case', text: 'Aa' }, { key: 'wholeWord', label: 'Whole word', text: 'ab' }, { key: 'regex', label: 'Regular expression', text: '.*' }] as const as toggle (toggle.key)}
        <button
          type="button"
          data-testid="search-toggle-{toggle.key}"
          aria-label={toggle.label}
          title={toggle.label}
          aria-pressed={model[toggle.key]}
          onclick={() => model.toggle(toggle.key)}
          class="shrink-0 rounded px-1.5 py-1 font-mono text-[length:calc(11px*var(--wd-scale,1))] leading-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary {model[
            toggle.key
          ]
            ? 'bg-primary/15 text-primary'
            : 'text-on-surface-variant hover:bg-surface-container-highest'}"
          >{toggle.text}</button
        >
      {/each}
    </div>

    {#if result?.error}
      <p
        id="search-error"
        role="alert"
        data-testid="search-error"
        class="px-2 pb-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-error"
      >
        {result.error}
      </p>
    {/if}

    <div
      bind:this={results}
      data-testid="search-results"
      class="min-h-0 flex-1 overflow-y-auto"
      aria-busy={model.searching}
    >
      {#if model.failure}
        <p data-testid="search-failure" class="px-2 py-2 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-error">
          {model.failure}
        </p>
      {:else if model.query === ''}
        <p
          data-testid="search-hint"
          class="px-2 py-2 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] leading-relaxed text-on-surface-variant"
        >
          Type to search the open folder.
        </p>
      {:else if !result}
        <p data-testid="search-status" class="px-2 py-2 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant">
          Searching…
        </p>
      {:else if result.error}
        <!-- The error above says what is wrong with the pattern. -->
      {:else if result.files.length === 0}
        <p data-testid="search-none" class="px-2 py-2 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant">
          No matches
        </p>
      {:else}
        {@const note = capsNote(result.matchCount, result.fileCount, result.truncated)}
        <p
          data-testid="search-summary"
          role="status"
          class="px-2 pb-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant"
        >
          {summary(result.matchCount, result.fileCount)}
        </p>
        {#if note}
          <p data-testid="search-caps" class="px-2 pb-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant">
            {note}
          </p>
        {/if}
        {#each result.files as file (file.path)}
          {@const place = resultPlace(model.resultFolder ?? '/', file.path)}
          {@const open_ = !model.collapsed.has(file.path)}
          <section data-testid="search-file" class="mb-0.5">
            <button
              type="button"
              data-search-item
              data-testid="search-file-header"
              aria-expanded={open_}
              onclick={() => model.toggleCollapsed(file.path)}
              class="flex w-full items-center gap-1 rounded px-1 py-1 text-left font-label-md text-label-md hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            >
              <span class="inline-flex shrink-0 text-on-surface-variant {open_ ? 'rotate-90' : ''}"
                ><Icon name="chevron-right" size={14} /></span
              >
              <span class="min-w-0 truncate font-medium text-on-surface">{place.name}</span>
              {#if place.folder}
                <span class="min-w-0 truncate text-[length:calc(11px*var(--wd-scale,1))] text-on-surface-variant">{place.folder}</span>
              {/if}
              <span
                data-testid="search-file-count"
                class="ml-auto shrink-0 rounded-full bg-surface-container-high px-1.5 text-[length:calc(11px*var(--wd-scale,1))] text-on-surface-variant"
                >{file.matches.length}</span
              >
            </button>
            {#if open_}
              <ul class="m-0 list-none p-0">
                {#each file.matches as match, index (index)}
                  <li>
                    <button
                      type="button"
                      data-search-item
                      data-testid="search-match"
                      onclick={() =>
                        void open(file.path, match.line, match.text, match.ranges[0]?.[0] ?? 0)}
                      class="flex w-full items-baseline gap-2 rounded py-0.5 pl-5 pr-1 text-left font-body-sm text-[length:calc(12px*var(--wd-scale,1))] hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    >
                      <span class="w-8 shrink-0 text-right text-[length:calc(11px*var(--wd-scale,1))] text-on-surface-variant"
                        >{match.line}</span
                      >
                      <span class="min-w-0 truncate text-on-surface"
                        >{#each hitSegments(match.text, match.ranges) as part}{#if part.marked}<mark
                              data-testid="search-mark"
                              class="search-hit rounded-sm bg-primary/20 font-semibold text-on-surface"
                              >{part.text}</mark
                            >{:else}{part.text}{/if}{/each}</span
                      >
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      {/if}
    </div>
  {/if}
</div>
