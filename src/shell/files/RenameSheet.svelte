<script lang="ts">
  import { onMount } from 'svelte';
  import { stemOf } from './tree';

  /** A small modal sheet with a name field (File > Rename…). */
  interface Props {
    title: string;
    value: string;
    kind: 'folder' | 'file';
    /** Resolves to an error message to show (the sheet stays open), or null when it worked. */
    onSubmit: (typed: string) => Promise<string | null>;
    onClose: () => void;
  }

  let { title, value, kind, onSubmit, onClose }: Props = $props();

  let input: HTMLInputElement | undefined = $state();
  let typed = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let dialog: HTMLDivElement | undefined = $state();

  onMount(() => {
    typed = value;
    queueMicrotask(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(0, kind === 'file' ? stemOf(value).length : value.length);
    });
  });

  async function submit() {
    if (busy) return;
    if (typed.trim() === '' || typed === value) {
      onClose();
      return;
    }
    busy = true;
    error = await onSubmit(typed);
    busy = false;
    if (error === null) onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab' && dialog) {
      const items = Array.from(
        dialog.querySelectorAll<HTMLElement>('input, button:not(:disabled)'),
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[60] flex items-start justify-center bg-black/20 pt-24"
  data-testid="rename-sheet-backdrop"
  onkeydown={onKeyDown}
  onpointerdown={(event) => event.target === event.currentTarget && onClose()}
>
  <div
    bind:this={dialog}
    role="dialog"
    aria-modal="true"
    aria-labelledby="rename-sheet-title"
    data-testid="rename-sheet"
    class="w-[calc(360px*var(--wd-scale,1))] max-w-[90vw] rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 shadow-xl"
  >
    <h2 id="rename-sheet-title" class="mb-2 font-headline-sm text-headline-sm font-semibold text-on-surface">
      {title}
    </h2>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        bind:this={input}
        bind:value={typed}
        type="text"
        aria-label="Name"
        data-testid="rename-sheet-input"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'rename-sheet-error' : undefined}
        spellcheck="false"
        autocomplete="off"
        class="w-full rounded-md border border-outline-variant bg-surface px-2 py-1.5 font-body-md text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
      />
      {#if error}
        <p
          id="rename-sheet-error"
          role="alert"
          data-testid="rename-sheet-error"
          class="mt-1 text-[length:calc(12px*var(--wd-scale,1))] leading-snug text-error"
        >
          {error}
        </p>
      {/if}
      <div class="mt-3 flex justify-end gap-2">
        <button
          type="button"
          data-testid="rename-sheet-cancel"
          onclick={onClose}
          class="rounded-md border border-outline-variant/40 px-3 py-1 font-label-md text-label-md text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-primary"
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="rename-sheet-ok"
          disabled={busy}
          class="rounded-md bg-primary px-3 py-1 font-label-md text-label-md font-semibold text-on-primary hover:bg-primary-container focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50"
        >
          Rename
        </button>
      </div>
    </form>
  </div>
</div>
