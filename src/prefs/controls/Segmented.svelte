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
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
    onchange((choices[next] as SettingChoice).value);
  }
</script>

<div class="segmented" role="radiogroup" aria-labelledby={labelledby} data-testid={testid}>
  {#each choices as choice, index (choice.value)}
    <button
      type="button"
      role="radio"
      aria-checked={choice.value === value}
      tabindex={index === selected ? 0 : -1}
      bind:this={buttons[index]}
      onclick={() => onchange(choice.value)}
      onkeydown={(event) => onkeydown(event, index)}>{choice.label}</button
    >
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--wd-surface-container-high);
    border: 1px solid var(--wd-outline-variant);
  }
  button {
    min-height: 24px;
    padding: 3px 10px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    color: var(--wd-on-surface-variant);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button[aria-checked="true"] {
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    box-shadow: 0 0 0 1px var(--wd-outline-variant);
  }
</style>
