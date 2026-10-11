<script lang="ts">
  import { flavorInfo } from '@/flavors';
  import { readingMinutes } from '@/preview/pipeline';
  import Icon from '@/shell/icons/Icon.svelte';
  import { zoomPercent } from './appearance';
  import { encodingLabel, formatCount, lineEndingLabel } from './document';
  import type { Shell } from './shell.svelte';

  let { shell }: { shell: Shell } = $props();

  const tab = $derived(shell.active);
  const words = $derived(tab?.stats?.words ?? 0);
  const characters = $derived(tab?.stats?.characters ?? 0);
  const noSpaces = $derived(tab?.stats?.charactersNoSpaces ?? 0);
  const zoom = $derived(zoomPercent(shell.settings.view.zoom));
  const syncOn = $derived(shell.settings.view.syncScroll);
</script>

<footer
  data-testid="status-bar"
  class="flex min-h-6 shrink-0 select-none flex-wrap items-center justify-between gap-x-3 whitespace-nowrap border-t border-outline-variant/30 bg-surface-container-low/90 px-space-md font-label-sm text-label-sm text-on-surface-variant"
>
  {#if tab}
    <div class="flex min-w-0 items-center gap-3">
      <span class="font-medium text-on-surface" data-testid="status-position"
        >Ln {shell.cursor.line}, Col {shell.cursor.column}</span
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <span data-testid="status-words"
        >Words: <strong class="font-semibold text-on-surface"
          >{shell.selection
            ? `${formatCount(shell.selection.words)} of ${formatCount(words)}`
            : formatCount(words)}</strong
        ></span
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <span data-testid="status-characters" title="{formatCount(noSpaces)} without spaces"
        >Characters: <strong class="font-semibold text-on-surface">{formatCount(characters)}</strong
        ></span
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <span class="flex items-center gap-1" data-testid="status-reading">
        <Icon name="schedule" size={12} />
        <span>Reading Time: {readingMinutes(words, shell.settings.readingWpm)}</span>
      </span>
    </div>

    <div
      data-testid="status-sync"
      class="hidden items-center gap-1.5 font-medium md:flex {syncOn
        ? 'text-primary'
        : 'text-on-surface-variant'}"
    >
      <span
        class="h-1.5 w-1.5 rounded-full {syncOn ? 'bg-primary' : 'bg-outline-variant'}"
        aria-hidden="true"
      ></span>
      <span>Sync Scroll: {syncOn ? 'On' : 'Off'}</span>
    </div>

    <div class="flex items-center gap-3">
      {#if shell.exactPreviewActive}
        <span
          data-testid="status-pandoc-preview"
          class="font-medium text-primary"
          title="Exact preview through Pandoc. Click to source and find in preview are off while it is on."
          >Pandoc preview</span
        >
        <span class="text-outline-variant" aria-hidden="true">•</span>
      {/if}
      <span data-testid="status-encoding"
        >{encodingLabel(tab.format.encoding, tab.legacyEncoding)}</span
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <button
        type="button"
        data-testid="status-line-ending"
        title="Switch the line ending used when saving"
        aria-label="Line ending: {lineEndingLabel(tab.format.lineEnding)}. Activate to switch."
        onclick={() => shell.toggleLineEnding()}
        class="-my-px inline-flex min-h-6 min-w-6 items-center justify-center rounded px-1 hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
        >{lineEndingLabel(tab.format.lineEnding)}</button
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <span class="font-medium text-on-surface" data-testid="status-flavor"
        >{flavorInfo(tab.flavor).short}</span
      >
      <span class="text-outline-variant" aria-hidden="true">•</span>
      <div class="flex items-center gap-1.5 pl-1">
        <Icon name="zoom-out" size={13} />
        <input
          type="range"
          data-testid="zoom-slider"
          aria-label="Zoom"
          min="50"
          max="200"
          step="10"
          value={zoom}
          oninput={(event) => void shell.setZoom(Number(event.currentTarget.value) / 100)}
          class="-my-px h-6 w-16 cursor-pointer accent-primary"
        />
        <Icon name="zoom-in" size={13} />
        <span data-testid="zoom-value" class="w-8 text-right">{zoom}%</span>
      </div>
    </div>
  {/if}
</footer>
