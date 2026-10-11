<script lang="ts">
  import { comboFromEvent, formatShortcut, parseShortcut } from '@/lib/shortcut-keys';
  import {
    checkChange,
    filterShortcuts,
    type Overrides,
    rowById,
    type ShortcutRow,
    shortcutGroups,
    withShortcut,
  } from './shortcuts';

  let {
    query = '',
    headings = false,
    overrides = {},
    onchange,
  }: {
    query?: string;
    headings?: boolean;
    /** The `shortcuts` setting: only what differs from the defaults. */
    overrides?: Overrides;
    /** Called with the whole new set of overrides. Without it the list is read-only. */
    onchange?: (next: Record<string, string | null>) => void;
  } = $props();

  const all = $derived(shortcutGroups(overrides));
  const groups = $derived(filterShortcuts(all, query));
  const anyChanged = $derived(Object.keys(overrides).length > 0);

  /** The row being recorded, and what is waiting for an answer about it. */
  let recording = $state<string | null>(null);
  let refused = $state<{ id: string; message: string } | null>(null);
  let conflict = $state<{
    id: string;
    shortcut: string;
    otherId: string;
    otherName: string;
  } | null>(null);
  let status = $state('');

  function stop() {
    recording = null;
    refused = null;
    conflict = null;
  }

  function apply(id: string, shortcut: string | null, replaceId?: string) {
    if (!onchange) return;
    const row = rowById(all, id);
    let next = withShortcut(overrides, id, shortcut, row?.defaultKeys ?? '');
    if (replaceId !== undefined) {
      const other = rowById(all, replaceId);
      next = withShortcut(next, replaceId, null, other?.defaultKeys ?? '');
    }
    onchange(next);
    status =
      shortcut === null ? `Removed the shortcut of ${row?.name}` : `${row?.name}: ${shortcut}`;
  }

  function onKey(event: KeyboardEvent) {
    if (recording === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.isComposing) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    if (plain && event.key === 'Escape') {
      stop();
      return;
    }
    if (conflict !== null) return;
    if (plain && (event.key === 'Delete' || event.key === 'Backspace')) {
      apply(recording, null);
      stop();
      return;
    }
    const combo = comboFromEvent(event);
    if (combo === null) return;
    const result = checkChange(all, recording, combo);
    if (result.kind === 'refused') {
      refused = { id: recording, message: result.message };
      return;
    }
    refused = null;
    const shortcut = formatShortcut(combo);
    if (result.kind === 'conflict') {
      conflict = { id: recording, shortcut, otherId: result.otherId, otherName: result.otherName };
      return;
    }
    apply(recording, shortcut);
    stop();
  }

  function replace() {
    if (!conflict) return;
    apply(conflict.id, conflict.shortcut, conflict.otherId);
    stop();
  }

  function reset(row: ShortcutRow) {
    if (!onchange) return;
    const result = checkReset(row);
    if (result) {
      // The default is taken by another command now: ask like for any other change.
      recording = row.id;
      conflict = result;
      return;
    }
    apply(row.id, row.defaultKeys === '' ? null : row.defaultKeys);
  }

  function checkReset(row: ShortcutRow) {
    if (row.defaultKeys === '') return null;
    const combo = parseShortcut(row.defaultKeys);
    if (!combo) return null;
    const result = checkChange(all, row.id, combo);
    if (result.kind !== 'conflict') return null;
    return {
      id: row.id,
      shortcut: formatShortcut(combo),
      otherId: result.otherId,
      otherName: result.otherName,
    };
  }

  function resetAll() {
    onchange?.({});
    stop();
    status = 'All shortcuts are back to the defaults';
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#each groups as group (group.title)}
  <section class="card-section" data-testid={`shortcuts-${group.title}`}>
    {#if headings}
      <h4 class="group">{group.title}</h4>
    {:else}
      <h3 class="group">{group.title}</h3>
    {/if}
    <ul class="card">
      {#each group.rows as row (row.id)}
        <li class="shortcut" data-testid="shortcut-row" data-command={row.id}>
          <div class="line">
            <span class="name">{row.name}</span>
            <span class="controls">
              {#if row.changed}
                <span class="changed" data-testid="shortcut-changed">Changed</span>
              {/if}
              <kbd data-testid="shortcut-keys" class:recording={recording === row.id}>
                {#if recording === row.id}
                  Type a shortcut
                {:else if row.keys === ''}
                  <span class="none">None</span>
                {:else}
                  {row.keys}
                {/if}
              </kbd>
              {#if onchange && row.editable}
                {#if recording === row.id}
                  <button type="button" class="small" data-testid="shortcut-cancel" onclick={stop}>
                    Cancel
                  </button>
                {:else}
                  <button
                    type="button"
                    class="small"
                    data-testid="shortcut-change"
                    aria-label={`Change the shortcut of ${row.name}`}
                    onclick={() => {
                      stop();
                      recording = row.id;
                    }}
                  >
                    Change
                  </button>
                {/if}
                {#if row.changed}
                  <button
                    type="button"
                    class="small"
                    data-testid="shortcut-reset"
                    aria-label={`Reset the shortcut of ${row.name}`}
                    onclick={() => reset(row)}
                  >
                    Reset
                  </button>
                {/if}
              {/if}
            </span>
          </div>
          {#if recording === row.id && !conflict}
            <p class="hint" data-testid="shortcut-hint">
              Press the new combination. Escape cancels, Delete removes the shortcut.
            </p>
          {/if}
          {#if refused && refused.id === row.id}
            <p class="problem" role="alert" data-testid="shortcut-refusal">{refused.message}</p>
          {/if}
          {#if conflict && conflict.id === row.id}
            <p class="problem" role="alert" data-testid="shortcut-conflict">
              <span>{conflict.shortcut} is used by {conflict.otherName}.</span>
              <span class="actions">
                <button type="button" class="small" data-testid="shortcut-replace" onclick={replace}>
                  Replace
                </button>
                <button type="button" class="small" data-testid="shortcut-conflict-cancel" onclick={stop}>
                  Cancel
                </button>
              </span>
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/each}

{#if onchange && !headings}
  <div class="resetall">
    <button
      type="button"
      class="small"
      data-testid="shortcuts-reset-all"
      disabled={!anyChanged}
      onclick={resetAll}
    >
      Reset all shortcuts
    </button>
  </div>
{/if}
<p class="sr-only" role="status" data-testid="shortcuts-status">{status}</p>

<style>
  .card-section {
    margin-bottom: 20px;
  }
  .group {
    margin: 0 0 6px 6px;
    font-family: var(--wd-font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--wd-on-surface-variant);
  }
  .card {
    margin: 0;
    padding: 0;
    list-style: none;
    border-radius: 12px;
    background: var(--wd-surface-container-lowest);
    border: 1px solid var(--wd-outline-variant);
  }
  .shortcut {
    padding: 8px 16px;
    border-top: 1px solid var(--wd-outline-variant);
    font-size: 14px;
    color: var(--wd-on-surface);
  }
  .shortcut:first-child {
    border-top: 0;
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  kbd {
    font-family: var(--wd-font-sans);
    font-size: 13px;
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--wd-surface-container-high);
    color: var(--wd-on-surface);
  }
  kbd.recording {
    outline: 2px solid var(--wd-primary);
  }
  .none {
    color: var(--wd-on-surface-variant);
  }
  .changed {
    font-size: 12px;
    color: var(--wd-on-surface-variant);
  }
  .small {
    font: inherit;
    font-size: 13px;
    padding: 2px 10px;
    min-height: 24px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    cursor: pointer;
  }
  .small:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .small:focus-visible {
    outline: 2px solid var(--wd-primary);
    outline-offset: 1px;
  }
  .hint,
  .problem {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--wd-on-surface-variant);
  }
  .problem {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--wd-error);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .resetall {
    margin: 4px 0 24px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
