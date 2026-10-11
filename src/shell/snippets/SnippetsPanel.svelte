<script lang="ts">
  /** The Snippets tab of the sidebar. */
  import { onMount, tick } from 'svelte';
  import { currentEditor } from '@/editor/controller';
  import { insertSnippet, useSnippets } from '@/editor/snippets';
  import type { Snippet } from '@/lib/platform';
  import Icon from '../icons/Icon.svelte';
  import type { Shell } from '../shell.svelte';
  import { draftProblem, type SnippetDraft, withDraft } from './form';

  let { shell }: { shell: Shell } = $props();

  let list = $state<Snippet[] | null>(null);
  let failure = $state<string | null>(null);
  let draft = $state<SnippetDraft | null>(null);
  let problem = $state<string | null>(null);
  let nameInput: HTMLInputElement | undefined = $state();
  let newButton: HTMLButtonElement | undefined = $state();

  // The editor is on show, so there is a caret to insert at.
  const canInsert = $derived(!!shell.active && shell.active.view !== 'preview');

  onMount(() => {
    void shell.platform
      .getSnippets()
      .then((loaded) => {
        list = loaded;
        useSnippets(loaded);
      })
      .catch(() => {
        failure = 'The snippets could not be read.';
      });
  });

  async function store(next: Snippet[]): Promise<boolean> {
    try {
      const saved = await shell.platform.setSnippets(next);
      list = saved;
      useSnippets(saved);
      failure = null;
      return true;
    } catch {
      failure = 'The snippets could not be saved.';
      return false;
    }
  }

  async function startDraft(value: SnippetDraft) {
    draft = value;
    problem = null;
    await tick();
    nameInput?.focus();
  }

  async function closeDraft() {
    draft = null;
    problem = null;
    await tick();
    newButton?.focus();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft || !list) return;
    problem = draftProblem(draft, list);
    if (problem) return;
    if (await store(withDraft(list, draft))) await closeDraft();
  }

  async function remove(entry: Snippet) {
    if (!list) return;
    const yes = await shell.platform.ask({
      title: `Delete the snippet "${entry.name}"?`,
      message: 'This cannot be undone.',
      ok: 'Delete',
      cancel: 'Cancel',
    });
    if (!yes) return;
    await store(list.filter((existing) => existing.id !== entry.id));
  }

  function insert(entry: Snippet) {
    const view = currentEditor()?.view;
    if (!view || !canInsert) return;
    insertSnippet(view, entry);
  }

  const FIELD =
    'w-full rounded border border-outline-variant/50 bg-surface-container-lowest px-2 py-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none';
  const SMALL = 'font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant';
  const ICON_BUTTON =
    'flex size-6 shrink-0 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary';
</script>

<div data-testid="snippets-panel" class="flex min-h-0 flex-1 flex-col">
  {#if draft}
    <form
      data-testid="snippet-form"
      aria-label={draft.id ? 'Edit snippet' : 'New snippet'}
      onsubmit={save}
      class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1"
    >
      <label class="flex flex-col gap-0.5 {SMALL}">
        Name
        <input
          bind:this={nameInput}
          bind:value={draft.name}
          type="text"
          data-testid="snippet-name"
          autocomplete="off"
          spellcheck="false"
          class={FIELD}
        />
      </label>
      <label class="flex flex-col gap-0.5 {SMALL}">
        Trigger (optional)
        <input
          bind:value={draft.trigger}
          type="text"
          data-testid="snippet-trigger"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          class={FIELD}
        />
      </label>
      <label class="flex flex-col gap-0.5 {SMALL}">
        Text
        <textarea
          bind:value={draft.body}
          data-testid="snippet-body"
          rows="8"
          spellcheck="false"
          class="{FIELD} font-mono"
        ></textarea>
      </label>
      <p class={SMALL}>Variables: {'{{date}}'}, {'{{time}}'}, {'{{selection}}'}.</p>
      {#if problem}
        <p
          role="alert"
          data-testid="snippet-error"
          class="font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-error"
        >
          {problem}
        </p>
      {/if}
      <div class="flex items-center gap-2">
        <button
          type="submit"
          data-testid="snippet-save"
          class="rounded bg-primary px-3 py-1 font-label-md text-label-md font-medium text-on-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >Save</button
        >
        <button
          type="button"
          data-testid="snippet-cancel"
          onclick={() => void closeDraft()}
          class="rounded px-2 py-1 font-label-md text-label-md font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >Cancel</button
        >
      </div>
    </form>
  {:else}
    <div class="mb-1 flex items-center justify-between px-1">
      <span class="font-label-md text-label-md font-semibold text-on-surface">Snippets</span>
      <button
        bind:this={newButton}
        type="button"
        data-testid="snippets-new"
        disabled={list === null}
        onclick={() => void startDraft({ id: '', name: '', trigger: '', body: '' })}
        class="flex items-center gap-1 rounded px-1 font-label-md text-label-md font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50"
      >
        <Icon name="add" size={14} />
        New
      </button>
    </div>
    {#if failure}
      <p
        role="alert"
        data-testid="snippets-failure"
        class="px-2 pb-1 font-body-sm text-[length:calc(12px*var(--wd-scale,1))] text-error"
      >
        {failure}
      </p>
    {/if}
    <ul data-testid="snippet-list" aria-label="Snippets" class="min-h-0 flex-1 overflow-y-auto">
      {#if list && list.length === 0}
        <li data-testid="snippets-empty" class="px-2 py-2 {SMALL}">
          No snippets yet. Choose New to add one.
        </li>
      {/if}
      {#each list ?? [] as entry (entry.id)}
        <li data-testid="snippet-row" data-id={entry.id} class="flex items-center gap-0.5">
          <button
            type="button"
            data-testid="snippet-insert"
            disabled={!canInsert}
            title={canInsert ? 'Insert at the cursor' : 'Switch to the editor to insert'}
            onclick={() => insert(entry)}
            class="flex min-w-0 flex-1 flex-col rounded px-1.5 py-1 text-left hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
          >
            <span class="truncate font-label-md text-label-md font-medium text-on-surface"
              >{entry.name}</span
            >
            {#if entry.trigger}
              <span class="truncate font-mono {SMALL}">{entry.trigger}</span>
            {/if}
          </button>
          <button
            type="button"
            data-testid="snippet-edit"
            aria-label="Edit {entry.name}"
            title="Edit"
            onclick={() => void startDraft({ ...entry })}
            class={ICON_BUTTON}
          >
            <Icon name="edit" size={14} />
          </button>
          <button
            type="button"
            data-testid="snippet-delete"
            aria-label="Delete {entry.name}"
            title="Delete"
            onclick={() => void remove(entry)}
            class={ICON_BUTTON}
          >
            <Icon name="delete" size={14} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
