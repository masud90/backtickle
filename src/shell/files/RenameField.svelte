<script lang="ts">
  import { onMount } from 'svelte';
  import { stemOf } from './tree';

  /** The inline name field of a row. Return commits, Escape cancels, leaving the field commits. */
  interface Props {
    value: string;
    kind: 'folder' | 'file';
    error: string | null;
    onCommit: (typed: string) => void;
    onCancel: () => void;
  }

  let { value, kind, error, onCommit, onCancel }: Props = $props();

  let input: HTMLInputElement | undefined = $state();
  let typed = $state('');
  let done = false;

  onMount(() => {
    typed = value;
    // The extension stays out of the selection, so typing replaces just the name.
    queueMicrotask(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(0, kind === 'file' ? stemOf(value).length : value.length);
    });
  });

  function commit() {
    if (done) return;
    if (typed.trim() === '' || typed === value) {
      cancel();
      return;
    }
    onCommit(typed);
  }

  function cancel() {
    if (done) return;
    done = true;
    onCancel();
  }

  function onKeyDown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }
</script>

<span class="flex min-w-0 flex-1 flex-col">
  <input
    bind:this={input}
    bind:value={typed}
    type="text"
    data-testid="files-rename-input"
    aria-label="Name"
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? 'files-rename-error' : undefined}
    spellcheck="false"
    autocomplete="off"
    onkeydown={onKeyDown}
    onblur={commit}
    onclick={(event) => event.stopPropagation()}
    class="w-full min-w-0 rounded border border-primary bg-surface-container-lowest px-1 py-0.5 font-body-sm text-[length:calc(13px*var(--wd-scale,1))] text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
  />
  {#if error}
    <span
      id="files-rename-error"
      role="alert"
      data-testid="files-rename-error"
      class="mt-0.5 text-[length:calc(12px*var(--wd-scale,1))] leading-snug text-error">{error}</span
    >
  {/if}
</span>
