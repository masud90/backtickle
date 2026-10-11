<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import '@/preview/preview.css';
  import './shell.css';
  import { EDITOR_FONTS, editorMetrics } from './appearance';
  import { encodingLabel } from './document';
  import type { Shell } from './shell.svelte';
  import Splitter from './Splitter.svelte';
  import { gridColumns } from './split';
  import { WorkspaceController } from './workspace';

  let { shell }: { shell: Shell } = $props();

  let editorHost: HTMLDivElement | undefined = $state();
  let article: HTMLElement | undefined = $state();
  let previewScroll: HTMLDivElement | undefined = $state();
  let ratio = $state(untrack(() => shell.settings.view.splitRatio));

  const view = $derived(shell.active?.view ?? 'split');
  const tab = $derived(shell.active);
  const syncOn = $derived(shell.settings.view.syncScroll);
  const encoding = $derived(tab ? encodingLabel(tab.format.encoding, tab.legacyEncoding) : '');
  const fontPx = $derived(
    editorMetrics(
      shell.settings.editor.fontSize,
      shell.settings.view.zoom,
      shell.settings.editor.lineHeight,
    ).font,
  );
  const fontLabel = $derived(EDITOR_FONTS[shell.settings.editor.fontFamily].label);
  const headers = $derived(shell.settings.editor.paneHeaders);
  const tabSize = $derived(shell.settings.editor.tabSize);

  onMount(() => {
    if (!editorHost || !article || !previewScroll) return;
    const controller = new WorkspaceController(
      { editor: editorHost, preview: article, previewScroll },
      shell,
    );
    shell.attachWorkspace(controller);
    return () => {
      shell.detachWorkspace(controller);
      controller.destroy();
    };
  });

  // The ratio is also stored in the settings (and may change in another window).
  $effect(() => {
    const stored = shell.settings.view.splitRatio;
    if (Math.abs(stored - untrack(() => ratio)) > 0.0005) ratio = stored;
  });

  function changeRatio(next: number) {
    ratio = next;
    shell.setSplitRatio(next);
  }
</script>

<div
  class="grid min-h-0 flex-1"
  style:grid-template-columns={gridColumns(ratio, view)}
  data-testid="workspace"
  data-view={view}
>
  <section
    class="min-h-0 min-w-0 flex-col bg-canvas {view === 'preview' ? 'hidden' : 'flex'}"
    aria-label="Markdown source"
  >
    {#if headers}
    <div
      data-testid="editor-header"
      class="flex min-h-7 shrink-0 select-none items-center justify-between gap-2 border-b border-outline-variant/20 bg-surface-container-low/40 px-4 font-label-sm text-label-sm text-on-surface-variant"
    >
      <div class="flex items-center gap-2">
        <span class="font-medium text-on-surface">MARKDOWN SOURCE</span>
        <span aria-hidden="true">•</span>
        <span data-testid="editor-encoding">{encoding}</span>
      </div>
      <div class="hidden items-center gap-2 md:flex" data-testid="editor-font-info">
        <span>Font: {fontLabel} ({fontPx}px)</span>
        <span aria-hidden="true">•</span>
        <span>Tab: {tabSize} {tabSize === 1 ? 'Space' : 'Spaces'}</span>
      </div>
    </div>
    {/if}
    <div bind:this={editorHost} class="min-h-0 flex-1 select-text" data-testid="editor"></div>
  </section>

  {#if view === 'split'}
    <Splitter {ratio} onChange={changeRatio} />
  {/if}

  <section
    class="min-h-0 min-w-0 flex-col bg-surface-container-lowest {view === 'editor'
      ? 'hidden'
      : 'flex'}"
    aria-label="Preview"
  >
    {#if headers}
    <div
      data-testid="preview-header"
      class="flex min-h-7 shrink-0 select-none items-center border-b border-outline-variant/20 bg-surface-container-low/40 px-4 font-label-sm text-label-sm text-on-surface-variant"
    >
      <div class="flex items-center gap-2">
        <span class="font-medium text-on-surface">LIVE PREVIEW</span>
        {#if syncOn}
          <span aria-hidden="true">•</span>
          <span data-testid="synced-viewport" class="font-medium text-tertiary"
            >Synced Viewport</span
          >
        {/if}
      </div>
    </div>
    {/if}
    <!-- A scrolling region needs the keyboard to reach it (axe: scrollable-region-focusable). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={previewScroll}
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-space-xl py-space-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      data-testid="preview-scroll"
      tabindex="0"
    >
      <article bind:this={article} class="select-text" data-testid="preview"></article>
    </div>
  </section>
</div>
