<script lang="ts">
  import type { SettingChoice } from '@/lib/settings-meta';

  interface Props {
    choices: SettingChoice[];
    value: string;
    onchange: (value: string) => void;
    labelledby: string;
    testid?: string;
  }
  let { choices, value, onchange, labelledby, testid }: Props = $props();

  let buttons: HTMLButtonElement[] = $state([]);
  const selected = $derived(
    Math.max(
      0,
      choices.findIndex((choice) => choice.value === value),
    ),
  );

  function onkeydown(event: KeyboardEvent, index: number) {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (index + 1) % choices.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + choices.length) % choices.length;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
    onchange((choices[next] as SettingChoice).value);
  }
</script>

<div class="swatches" role="radiogroup" aria-labelledby={labelledby} data-testid={testid}>
  {#each choices as choice, index (choice.value)}
    <button
      type="button"
      role="radio"
      class="swatch {choice.value}"
      aria-checked={choice.value === value}
      aria-label={choice.label}
      title={choice.label}
      tabindex={index === selected ? 0 : -1}
      bind:this={buttons[index]}
      onclick={() => onchange(choice.value)}
      onkeydown={(event) => onkeydown(event, index)}
    ></button>
  {/each}
</div>

<style>
  .swatches {
    display: inline-flex;
    gap: 8px;
  }
  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1px solid var(--wd-outline);
    cursor: pointer;
    padding: 0;
  }
  .swatch[aria-checked="true"] {
    box-shadow:
      0 0 0 2px var(--wd-surface-container-lowest),
      0 0 0 4px var(--wd-primary);
  }
  .yellow {
    background: #f5c542;
  }
  .blue {
    background: #6cc4f5;
  }
  .green {
    background: #5fdba7;
  }
  .pink {
    background: #f7b6c2;
  }
</style>
