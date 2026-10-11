<script lang="ts" module>
  export interface BannerButton {
    label: string;
    onclick: () => void;
    /** The one button that suggests the action to take (a slightly stronger look). */
    primary?: boolean;
  }
</script>

<script lang="ts">
  /**
   * A document banner: a message and up to three buttons. Used by the encoding notices and,
   * later, by external changes and missing files. `role="status"`, so a screen reader announces
   * it without taking the focus.
   */
  interface Props {
    message: string;
    buttons?: BannerButton[];
    testId?: string;
  }

  let { message, buttons = [], testId }: Props = $props();

  const shown = $derived(buttons.slice(0, 3));
</script>

<div
  role="status"
  data-testid={testId}
  class="flex shrink-0 select-none items-center justify-between gap-3 border-b border-outline-variant/30 bg-secondary-fixed px-space-md py-1.5 font-label-md text-label-md text-on-secondary-fixed"
>
  <span>{message}</span>
  <div class="flex shrink-0 items-center gap-1">
    {#each shown as button (button.label)}
      <button
        type="button"
        onclick={button.onclick}
        class="rounded px-1.5 py-0.5 hover:bg-secondary/10 focus-visible:outline-2 focus-visible:outline-secondary {button.primary
          ? 'font-semibold'
          : 'font-medium'}"
      >
        {button.label}
      </button>
    {/each}
  </div>
</div>
