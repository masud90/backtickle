<script lang="ts">
  import { onMount } from 'svelte';
  import { byOs } from '@/lib/os';
  import type { Platform } from '@/lib/platform';

  interface Props {
    platform: Platform;
  }
  let { platform }: Props = $props();

  interface DefaultApp {
    isWritedown: boolean;
    appName: string | null;
  }

  // Read once when Preferences opens (no polling); read again after a change.
  let current = $state<DefaultApp | null>(null);
  let readFailed = $state(false);
  let busy = $state(false);
  let message = $state('');

  const status = $derived.by(() => {
    if (readFailed) return 'The default app could not be read.';
    if (current === null) return 'Looking up the default app.';
    if (current.isWritedown) return 'Writedown is the default';
    return current.appName ? `Currently ${current.appName}` : 'No default app is set';
  });

  const canMake = $derived(current !== null && !current.isWritedown && !busy);

  // On Windows an app cannot make itself the default: the button opens the system's
  // "Open with" chooser for .md files, where the user picks Writedown.
  const description = byOs(
    'Opens .md, .markdown and related files in Writedown. .qmd, .Rmd and .mdx stay under Open With.',
    'Opens .md files in Writedown. The button shows the Windows "Open with" chooser: pick Writedown and choose Always.',
  );
  const buttonLabel = byOs('Make Writedown the default', 'Choose the default app…');

  async function read() {
    try {
      current = await platform.defaultMarkdownApp();
      readFailed = false;
    } catch {
      current = null;
      readFailed = true;
    }
  }

  async function make() {
    busy = true;
    message = '';
    try {
      await platform.makeDefaultMarkdownApp();
    } catch (error) {
      // A PlatformError is a plain `{ code, message }` object.
      const text =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';
      message = text || 'The default app could not be changed.';
    } finally {
      busy = false;
      await read();
    }
  }

  onMount(() => {
    void read();
  });
</script>

<div class="row" data-testid="setting-default-markdown-app" data-row="default-app">
  <div class="text">
    <div class="label" id="lbl-default-markdown-app">Default app for Markdown files</div>
    <div class="desc" id="desc-default-markdown-app">
      {description}
    </div>
  </div>
  <div class="control">
    <div class="action">
      <span class="status" data-testid="default-app-status">{status}</span>
      <button
        type="button"
        data-testid="make-default-app"
        disabled={!canMake}
        aria-describedby="desc-default-markdown-app"
        onclick={make}
      >
        {buttonLabel}
      </button>
      {#if message}
        <p class="message" role="alert" data-testid="default-app-message">{message}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 12px 16px;
  }
  .text {
    min-width: 0;
    flex: 1 1 220px;
  }
  .label {
    font-size: 15px;
    line-height: 22px;
    font-weight: 500;
    color: var(--wd-on-surface);
  }
  .desc {
    font-size: 13px;
    line-height: 20px;
    color: var(--wd-on-surface-variant);
  }
  .control {
    flex: none;
    display: flex;
    justify-content: flex-end;
    max-width: 55%;
  }
  .action {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .status {
    font-size: 13px;
    color: var(--wd-on-surface);
  }
  button {
    min-height: 28px;
    padding: 3px 12px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .message {
    margin: 0;
    font-size: 13px;
    color: var(--wd-error, var(--wd-on-surface));
  }
</style>
