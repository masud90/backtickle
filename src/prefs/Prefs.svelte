<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Platform } from '@/lib/platform';
  import {
    SETTING_CATEGORIES,
    type SettingCategory,
    type SettingMeta,
    settingsIn,
  } from '@/lib/settings-meta';
  import { applyDocumentAppearance } from '@/shell/appearance';
  import Icon from '@/shell/icons/Icon.svelte';
  import type { IconName } from '@/shell/icons';
  import { fold } from './format';
  import { CATEGORY_DESCRIPTIONS, cardsFor } from './layout';
  import SettingRow from './SettingRow.svelte';
  import DefaultAppRow from './DefaultAppRow.svelte';
  import { PrefsState } from './state.svelte';

  let { platform }: { platform: Platform } = $props();

  type CategoryId = SettingCategory | 'shortcuts';

  const ICON_NAMES: Record<CategoryId, IconName> = {
    general: 'tune',
    editor: 'edit-note',
    preview: 'code-blocks',
    accessibility: 'accessibility-new',
    saving: 'save',
    shortcuts: 'keyboard',
  };

  // svelte-ignore state_referenced_locally
  const prefs = new PrefsState(platform);
  // svelte-ignore state_referenced_locally
  const version = platform.appVersion().catch(() => 'unavailable');

  let ready = $state(false);
  let selected = $state<CategoryId>('general');
  let query = $state('');
  let search: HTMLInputElement | undefined = $state();
  let ShortcutsPanel = $state<typeof import('./Shortcuts.svelte').default | null>(null);

  const searching = $derived(query.trim() !== '');

  /** Settings that match the query: every word in the label, description, keywords or category. */
  const matches = $derived.by(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return SETTINGS.filter((meta) => {
      const category = SETTING_CATEGORIES.find((entry) => entry.id === meta.category)?.label ?? '';
      const haystack = fold([meta.label, meta.description, category, ...meta.keywords].join(' '));
      return words.every((word) => haystack.includes(word));
    });
  });

  // The one table, read through `settingsIn` per category, so a new setting appears here too.
  const SETTINGS: SettingMeta[] = SETTING_CATEGORIES.flatMap((entry) =>
    entry.id === 'shortcuts' ? [] : settingsIn(entry.id),
  );

  const matchedCategories = $derived(
    SETTING_CATEGORIES.filter((entry) =>
      entry.id === 'shortcuts' ? false : matches.some((meta) => meta.category === entry.id),
    ),
  );

  // Shortcut matches are counted by the panel; this tells the list whether any exist.
  let shortcutMatches = $state(0);

  const nothing = $derived(searching && matches.length === 0 && shortcutMatches === 0);

  function categoryDimmed(id: CategoryId): boolean {
    if (!searching) return false;
    if (id === 'shortcuts') return shortcutMatches === 0;
    return !matches.some((meta) => meta.category === id);
  }

  async function loadShortcuts() {
    if (ShortcutsPanel) return;
    ShortcutsPanel = (await import('./Shortcuts.svelte')).default;
  }

  $effect(() => {
    if (selected === 'shortcuts' || searching) void loadShortcuts();
  });

  $effect(() => {
    if (!searching) {
      shortcutMatches = 0;
      return;
    }
    let cancelled = false;
    void import('./shortcuts').then(({ filterShortcuts, shortcutGroups }) => {
      if (cancelled) return;
      shortcutMatches = filterShortcuts(shortcutGroups(), query).reduce(
        (sum, group) => sum + group.rows.length,
        0,
      );
    });
    return () => {
      cancelled = true;
    };
  });

  // The window follows `appearance` and the accessibility settings (scale, motion, contrast).
  $effect(() => {
    if (prefs.settings) applyDocumentAppearance(document.documentElement, prefs.settings);
  });

  function pickCategory(id: CategoryId) {
    selected = id;
    query = '';
  }

  async function closeWindow(how: 'done' | 'cancel') {
    document.body.dataset.prefsClosed = how;
    try {
      await platform.closeSelf();
    } catch {
      // The window stays open and the user can close it.
    }
  }

  async function done() {
    await prefs.commit();
    await closeWindow('done');
  }

  async function cancel() {
    await prefs.cancel();
    await closeWindow('cancel');
  }

  async function resetCategory(id: SettingCategory) {
    await prefs.setMany(settingsIn(id).map((meta) => [meta.key, structuredClone(meta.default)]));
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      search?.focus();
      search?.select();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      void done();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      // In the search field with text, Escape clears the search and keeps the focus there.
      if (event.target === search && query !== '') {
        query = '';
        return;
      }
      void cancel();
      return;
    }
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const decision =
        target.matches('[role="switch"], [role="radio"], select, input[type="range"]') ||
        target === document.body;
      if (decision) {
        event.preventDefault();
        void done();
      }
    }
  }

  onMount(async () => {
    await prefs.start();
    ready = true;
    window.addEventListener('pagehide', flushOnHide);
  });

  function flushOnHide() {
    void prefs.commit();
  }

  onDestroy(() => {
    prefs.dispose();
    window.removeEventListener('pagehide', flushOnHide);
  });

  const category = $derived(SETTING_CATEGORIES.find((entry) => entry.id === selected));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="window">
  <!-- The overlay title bar floats over this strip; dragging it moves the window. -->
  <header data-tauri-drag-region class="strip">
    <div class="titlebox" data-testid="prefs-title">
      <Icon name="settings" size={18} />
      <h1>Preferences</h1>
      <span class="pill">v<span data-testid="app-version"
          >{#await version then value}{value}{/await}</span
        ></span
      >
    </div>
    <div class="searchbox">
      <Icon name="search" size={16} />
      <input
        bind:this={search}
        bind:value={query}
        type="search"
        aria-label="Search settings"
        placeholder="Search…"
        data-testid="prefs-search"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
  </header>

  <div class="body">
    <nav class="categories wd-vibrant wd-vibrant-solid" aria-label="Categories" data-testid="prefs-categories">
      <div class="catlabel" aria-hidden="true">Categories</div>
      {#each SETTING_CATEGORIES as entry (entry.id)}
        <button
          type="button"
          class="cat"
          class:selected={!searching && selected === entry.id}
          class:dimmed={categoryDimmed(entry.id)}
          aria-current={!searching && selected === entry.id ? 'true' : undefined}
          data-testid={`category-${entry.id}`}
          onclick={() => pickCategory(entry.id)}
        >
          <Icon name={ICON_NAMES[entry.id]} size={20} />
          <span>{entry.label}</span>
        </button>
      {/each}
    </nav>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <main class="content" tabindex="0" aria-label="Settings" data-testid="prefs-content">
      {#if !ready}
        <p class="empty">Loading settings…</p>
      {:else if searching}
        <h2 class="title">Search results</h2>
        {#if nothing}
          <p class="empty" role="status" data-testid="no-match">
            No settings match "{query.trim()}"
          </p>
        {/if}
        {#each matchedCategories as entry (entry.id)}
          {@const inCategory = matches.filter((meta) => meta.category === entry.id)}
          <section class="result" data-testid={`results-${entry.id}`}>
            <h3 class="group">{entry.label}</h3>
            <div class="card">
              {#each inCategory as meta (meta.key)}
                <SettingRow {meta} {prefs} {platform} />
              {/each}
            </div>
          </section>
        {/each}
        {#if ShortcutsPanel && shortcutMatches > 0}
          <section class="result" data-testid="results-shortcuts">
            <h3 class="group">Keyboard Shortcuts</h3>
            <ShortcutsPanel
              {query}
              headings
              overrides={prefs.settings?.shortcuts ?? {}}
              onchange={(next) => prefs.set('shortcuts', next)}
            />
          </section>
        {/if}
      {:else if selected === 'shortcuts'}
        <h2 class="title">{category?.label}</h2>
        <p class="lead">{CATEGORY_DESCRIPTIONS.shortcuts}</p>
        {#if ShortcutsPanel}
          <ShortcutsPanel
            overrides={prefs.settings?.shortcuts ?? {}}
            onchange={(next) => prefs.set('shortcuts', next)}
          />
        {/if}
      {:else}
        <h2 class="title">{category?.label}</h2>
        <p class="lead">{CATEGORY_DESCRIPTIONS[selected]}</p>
        {#each cardsFor(selected) as card (card.title)}
          <section class="cardsection">
            <h3 class="group">{card.title}</h3>
            <div class="card">
              {#each card.settings as meta (meta.key)}
                <SettingRow {meta} {prefs} {platform} />
              {/each}
            </div>
          </section>
        {/each}
        {#if selected === 'general'}
          <section class="cardsection">
            <h3 class="group">Markdown files</h3>
            <div class="card">
              <DefaultAppRow {platform} />
            </div>
          </section>
        {/if}
        <div class="reset">
          <button
            type="button"
            class="resetbtn"
            data-testid="reset-category"
            onclick={() => resetCategory(selected as SettingCategory)}
          >
            Reset {category?.label} defaults
          </button>
        </div>
      {/if}
      {#if prefs.error}
        <p class="error" role="alert">{prefs.error}</p>
      {/if}
    </main>
  </div>

  <footer class="footer">
    <button type="button" class="btn" data-testid="prefs-cancel" onclick={cancel}>Cancel</button>
    <button type="button" class="btn primary" data-testid="prefs-done" onclick={done}>Done</button>
  </footer>
</div>

<style>
  .window {
    display: flex;
    height: 100%;
    flex-direction: column;
    background: var(--wd-surface);
    color: var(--wd-on-surface);
    font-size: 15px;
  }
  /* Translucent sidebar: the window is clear behind the category list; the rest paints itself. */
  :global(:root[data-vibrancy='on']) .window {
    background: transparent;
  }
  .strip {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 48px;
    background: var(--wd-surface);
    padding: 0 16px 0 84px;
    border-bottom: 1px solid var(--wd-outline-variant);
    user-select: none;
  }
  .titlebox {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    line-height: 24px;
    font-weight: 600;
  }
  .pill {
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--wd-surface-container-high);
    color: var(--wd-on-surface-variant);
    font-size: 12px;
  }
  .searchbox {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 200px;
    padding: 0 8px;
    border-radius: 8px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-low);
    color: var(--wd-on-surface-variant);
  }
  .searchbox input {
    flex: 1;
    min-width: 0;
    min-height: 28px;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 14px;
  }
  .searchbox:focus-within {
    outline: 2px solid var(--wd-primary);
    outline-offset: 1px;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .categories {
    display: flex;
    flex: none;
    width: 232px;
    flex-direction: column;
    gap: 2px;
    padding: 16px 12px;
    border-right: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-low);
    overflow-y: auto;
  }
  .catlabel {
    padding: 0 8px 8px;
    font-family: var(--wd-font-mono);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--wd-on-surface-variant);
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 36px;
    padding: 6px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }
  .cat.selected {
    background: color-mix(in srgb, var(--wd-primary) 14%, transparent);
    color: var(--wd-primary);
    font-weight: 500;
  }
  .cat.dimmed {
    opacity: 0.8;
  }
  .content:focus-visible {
    outline: 2px solid var(--wd-primary);
    outline-offset: -2px;
  }
  .content {
    background: var(--wd-surface);
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 24px 32px 16px;
  }
  .title {
    margin: 0;
    font-size: 26px;
    line-height: 34px;
    font-weight: 650;
    letter-spacing: -0.019em;
  }
  .lead {
    margin: 4px 0 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--wd-outline-variant);
    color: var(--wd-on-surface-variant);
    font-size: 15px;
  }
  .cardsection,
  .result {
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
    border-radius: 12px;
    background: var(--wd-surface-container-lowest);
    border: 1px solid var(--wd-outline-variant);
  }
  .empty {
    margin-top: 16px;
    color: var(--wd-on-surface-variant);
  }
  .error {
    color: var(--wd-error);
  }
  .reset {
    padding: 4px 0 8px;
  }
  .resetbtn {
    min-height: 28px;
    padding: 3px 12px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: transparent;
    color: var(--wd-on-surface-variant);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .footer {
    display: flex;
    flex: none;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-low);
  }
  .btn {
    min-height: 28px;
    min-width: 76px;
    padding: 3px 16px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .btn.primary {
    border-color: var(--wd-primary);
    background: var(--wd-primary);
    color: var(--wd-on-primary);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--wd-primary);
    outline-offset: 2px;
  }
</style>
