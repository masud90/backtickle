<script lang="ts">
  import { FLAVORS, type FlavorId, type FlavorReason, flavorInfo } from '@/flavors';
  import Icon from '@/shell/icons/Icon.svelte';
  import Menu from './Menu.svelte';
  import type { MenuItem } from './menu';

  interface Props {
    flavor: FlavorId;
    /** Why this flavor: "auto" is shown unless it was chosen. Null for the default flavor. */
    reason: FlavorReason | null;
    /** `null` means "detect it again" (offered when the flavor was chosen for the document). */
    onChoose: (flavor: FlavorId | null) => void;
    label?: string;
  }

  let { flavor, reason, onChoose, label = 'Markdown flavor' }: Props = $props();

  let open = $state(false);
  let trigger: HTMLButtonElement | undefined = $state();

  const info = $derived(flavorInfo(flavor));
  const auto = $derived(reason !== null && reason !== 'chosen');

  const items = $derived<MenuItem[]>([
    ...FLAVORS.map((entry) => ({
      id: entry.id,
      label: entry.label,
      checked: entry.id === flavor,
      onSelect: () => onChoose(entry.id),
    })),
    ...(reason === 'chosen'
      ? [{ id: 'auto', label: 'Detect automatically', onSelect: () => onChoose(null) }]
      : []),
  ]);

  function close() {
    open = false;
    trigger?.focus();
  }
</script>

<div class="relative" data-testid="flavor-pill-wrap">
  <button
    bind:this={trigger}
    type="button"
    data-testid="flavor-pill"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="{label}: {info.short}{auto ? ', detected automatically' : ''}"
    onclick={() => (open = !open)}
    class="flex h-7 items-center gap-1.5 rounded-full border border-outline-variant/30 bg-surface-container-highest/60 px-2.5 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
  >
    <span class="h-2 w-2 rounded-full bg-secondary ring-2 ring-secondary/20" aria-hidden="true"
    ></span>
    <span class="font-medium">{info.short}</span>
    {#if auto}
      <span
        data-testid="flavor-auto"
        class="rounded-full bg-surface-container-low px-1.5 font-label-sm text-label-sm font-medium text-on-surface-variant"
        >auto</span
      >
    {/if}
    <span class="inline-flex text-on-surface-variant" aria-hidden="true">
      <Icon name="expand-more" size={14} />
    </span>
  </button>
  {#if open}
    <Menu {items} {label} align="right" testId="flavor-menu" onClose={close} />
  {/if}
</div>
