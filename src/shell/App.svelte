<script lang="ts">
  import { onMount } from 'svelte';
  import type { LaunchOptions, Platform } from '@/lib/platform';
  import Banner from './Banner.svelte';
  import { encodingLabel, legacyEncodingLabel } from './document';
  import { Shell } from './shell.svelte';
  import Sidebar from './Sidebar.svelte';
  import StatusBar from './StatusBar.svelte';
  import TabStrip from './TabStrip.svelte';
  import TitleBar from './TitleBar.svelte';
  import Toolbar from './Toolbar.svelte';
  import Welcome from './Welcome.svelte';

  let { platform, launch }: { platform: Platform; launch: LaunchOptions } = $props();

  // The window is created once with its platform and launch options; they never change.
  // svelte-ignore state_referenced_locally
  const shell = new Shell(platform, launch);

  const tab = $derived(shell.active);
  const Workspace = $derived(shell.WorkspaceComponent);

  onMount(() => {
    void shell.start();
    return () => shell.destroy();
  });

  // Banners for the document on show: how it was read, and what saving will do.
  const banners = $derived.by(() => {
    if (!tab) return [];
    const list: Array<{ kind: 'legacy' | 'lossy' | 'readOnly'; text: string }> = [];
    if (tab.legacyEncoding && !tab.dismissed.legacy) {
      list.push({
        kind: 'legacy',
        text: `Opened as ${legacyEncodingLabel(tab.legacyEncoding)}. Saving converts it to ${encodingLabel('utf-8', null)}.`,
      });
    }
    if (tab.lossy && !tab.dismissed.lossy) {
      list.push({
        kind: 'lossy',
        text: 'Some characters in this file could not be read and were replaced. Writedown asks before saving it.',
      });
    }
    if (tab.readOnly && !tab.dismissed.readOnly) {
      list.push({
        kind: 'readOnly',
        text: 'This file is read-only. Save asks for a new name and leaves the original alone.',
      });
    }
    return list;
  });
</script>

<div class="wd-app-root flex h-full flex-col bg-canvas text-on-surface">
  <div class="wd-under flex shrink-0 flex-col">
  <TitleBar {shell} />

  {#if shell.tabs.length >= 2}
    <TabStrip {shell} />
  {/if}

  <Toolbar {shell} />

  {#each banners as banner (banner.kind)}
    <Banner
      message={banner.text}
      testId="banner-{banner.kind}"
      buttons={[{ label: 'Dismiss', onclick: () => shell.dismissBanner(banner.kind) }]}
    />
  {/each}

  {#if tab?.missing}
    <Banner
      message="This file is no longer on disk."
      testId="banner-missing"
      buttons={[
        { label: 'Save As…', onclick: () => void shell.run('save-as'), primary: true },
        { label: 'Close', onclick: () => void shell.run('close-tab') },
      ]}
    />
  {/if}

  {#if tab?.recovered}
    <Banner
      message="Recovered after Writedown closed unexpectedly. This text was not saved."
      testId="banner-recovered"
      buttons={[
        { label: 'Keep', onclick: () => shell.keepRecovered(tab.id), primary: true },
        { label: 'Discard', onclick: () => void shell.discardRecovered(tab.id) },
      ]}
    />
  {/if}

  {#if tab?.externalChange && !tab.missing}
    <Banner
      message="This file was changed by another app."
      testId="banner-external"
      buttons={[
        { label: 'Reload', onclick: () => void shell.reloadTab(tab.id), primary: true },
        { label: 'Keep Mine', onclick: () => shell.keepMine(tab.id) },
      ]}
    />
  {/if}

  {#if shell.notice}
    <div
      role="status"
      data-testid="notice-banner"
      class="flex shrink-0 select-none items-center justify-between gap-3 border-b border-outline-variant/30 bg-surface-container px-space-md py-1.5 font-label-md text-label-md text-on-surface-variant"
    >
      <span>{shell.notice}</span>
      <button
        type="button"
        onclick={() => shell.dismissNotice()}
        class="rounded px-1.5 py-0.5 font-medium hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-primary"
      >
        Dismiss
      </button>
    </div>
  {/if}

  {#if shell.error}
    <div
      role="alert"
      class="flex shrink-0 select-none items-center justify-between gap-3 border-b border-outline-variant/30 bg-error-container px-space-md py-1.5 font-label-md text-label-md text-on-error-container"
    >
      <span>{shell.error}</span>
      <button
        type="button"
        onclick={() => shell.dismissError()}
        class="rounded px-1.5 py-0.5 font-medium hover:bg-error/10 focus-visible:outline-2 focus-visible:outline-error"
      >
        Dismiss
      </button>
    </div>
  {/if}
  </div>

  <div class="flex min-h-0 flex-1">
    {#if shell.settings.view.sidebarVisible && (tab || shell.loaded)}
      <Sidebar {shell} />
    {/if}
    <main class="wd-under flex min-h-0 min-w-0 flex-1 flex-col">
      {#if tab}
        {#if Workspace}
          <Workspace {shell} />
        {/if}
      {:else if shell.loaded}
        <Welcome {shell} />
      {/if}
    </main>
  </div>

  <div class="wd-under shrink-0">
    <StatusBar {shell} />
  </div>
</div>
