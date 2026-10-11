<script lang="ts">
  import type { Platform } from '@/lib/platform';
  import type { SettingMeta } from '@/lib/settings-meta';
  import ListEditor from './controls/ListEditor.svelte';
  import PathRow from './controls/PathRow.svelte';
  import Segmented from './controls/Segmented.svelte';
  import Select from './controls/Select.svelte';
  import Slider from './controls/Slider.svelte';
  import Stepper from './controls/Stepper.svelte';
  import Swatches from './controls/Swatches.svelte';
  import Switch from './controls/Switch.svelte';
  import { SLIDER_KEYS, SWATCH_KEYS } from './layout';
  import type { PrefsState } from './state.svelte';

  interface Props {
    meta: SettingMeta;
    prefs: PrefsState;
    platform: Platform;
  }
  let { meta, prefs, platform }: Props = $props();

  const slug = $derived(meta.key.replace(/\./g, '-'));
  const labelId = $derived(`lbl-${slug}`);
  const descId = $derived(`desc-${slug}`);
  const value = $derived(prefs.value(meta.key));

  let pathMessage = $state('');
  let found = $state<string | null>(null);

  const wpm = $derived(Number(prefs.value('readingWpm')) || 238);

  function format(v: number): string {
    if (meta.key === 'a11y.scale') return `${Math.round(v * 100)}%`;
    const unit = meta.kind === 'number' && meta.unit ? ` ${meta.unit}` : '';
    return `${v}${unit}`;
  }

  async function lookUpPandoc() {
    try {
      found = (await platform.pandocInfo())?.path ?? null;
    } catch {
      found = null;
    }
  }

  $effect(() => {
    if (meta.key === 'export.pandocPath' && value === null) void lookUpPandoc();
  });

  async function choose() {
    pathMessage = '';
    try {
      const chosen =
        meta.key === 'export.pandocPath'
          ? await platform.choosePandoc()
          : await platform.chooseDefaultFolder();
      // Rust stores the choice and announces it; this window only remembers it for Cancel.
      if (chosen !== null) prefs.track(meta.key);
    } catch (error) {
      // A PlatformError is a plain `{ code, message }` object.
      const message =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : '';
      pathMessage = message || 'That choice could not be used. Pick another.';
    }
  }

  function resetPath() {
    pathMessage = '';
    prefs.set(meta.key, null);
  }

  const pandocEmpty = $derived(
    found ? `Found automatically: ${found}` : 'Not found. Choose a Pandoc file.',
  );
</script>

<div class="row" data-testid={`setting-${meta.key}`} data-setting={meta.key}>
  <div class="text">
    <div class="label" id={labelId}>{meta.label}</div>
    <div class="desc" id={descId}>{meta.description}</div>
    {#if meta.key === 'readingWpm'}
      <div class="desc note" data-testid="reading-formula">
        Reading time: Words ÷ {wpm} words per minute, rounded up; source: Brysbaert 2019.
      </div>
    {/if}
  </div>
  <div class="control">
    {#if meta.kind === 'boolean'}
      <Switch
        checked={value === true}
        labelledby={labelId}
        describedby={descId}
        testid={`control-${meta.key}`}
        onchange={(next) => prefs.set(meta.key, next)}
      />
    {:else if meta.kind === 'choice'}
      {#if SWATCH_KEYS.has(meta.key)}
        <Swatches
          choices={meta.choices}
          value={String(value)}
          labelledby={labelId}
          testid={`control-${meta.key}`}
          onchange={(next) => prefs.set(meta.key, next)}
        />
      {:else if meta.choices.length <= 3}
        <Segmented
          choices={meta.choices}
          value={String(value)}
          labelledby={labelId}
          testid={`control-${meta.key}`}
          onchange={(next) => prefs.set(meta.key, next)}
        />
      {:else}
        <Select
          choices={meta.choices}
          value={String(value)}
          labelledby={labelId}
          testid={`control-${meta.key}`}
          onchange={(next) => prefs.set(meta.key, next)}
        />
      {/if}
    {:else if meta.kind === 'number'}
      {#if SLIDER_KEYS.has(meta.key)}
        <Slider
          value={Number(value)}
          min={meta.min}
          max={meta.max}
          step={meta.step}
          {format}
          labelledby={labelId}
          testid={`control-${meta.key}`}
          oninput={(next) => prefs.set(meta.key, next, true)}
          oncommit={(next) => prefs.set(meta.key, next)}
        />
      {:else}
        <Stepper
          value={Number(value)}
          min={meta.min}
          max={meta.max}
          step={meta.step}
          unit={meta.unit}
          labelledby={labelId}
          testid={`control-${meta.key}`}
          onchange={(next) => prefs.set(meta.key, next)}
        />
      {/if}
    {:else if meta.kind === 'list'}
      <ListEditor
        items={Array.isArray(value) ? (value as string[]) : []}
        labelledby={labelId}
        testid={`control-${meta.key}`}
        onchange={(next) => prefs.set(meta.key, next)}
      />
    {:else if meta.kind === 'path'}
      {#if meta.key === 'export.pandocPath'}
        <PathRow
          path={typeof value === 'string' ? value : null}
          emptyText={pandocEmpty}
          resetLabel="Find automatically"
          labelledby={labelId}
          testid={`control-${meta.key}`}
          message={pathMessage}
          onchoose={choose}
          onreset={resetPath}
        />
      {:else}
        <PathRow
          path={typeof value === 'string' ? value : null}
          emptyText="The Save dialog's own default"
          resetLabel="Use the Save dialog's default"
          labelledby={labelId}
          testid={`control-${meta.key}`}
          message={pathMessage}
          onchoose={choose}
          onreset={resetPath}
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 12px 16px;
    border-top: 1px solid var(--wd-outline-variant);
  }
  .row:first-child {
    border-top: 0;
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
  .note {
    margin-top: 2px;
  }
  .control {
    flex: none;
    display: flex;
    justify-content: flex-end;
    max-width: 55%;
  }
</style>
