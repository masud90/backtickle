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
</script>

<select
  class="select"
  aria-labelledby={labelledby}
  data-testid={testid}
  {value}
  onchange={(event) => onchange(event.currentTarget.value)}
>
  {#each choices as choice (choice.value)}
    <option value={choice.value} selected={choice.value === value}>{choice.label}</option>
  {/each}
</select>

<style>
  .select {
    min-height: 28px;
    padding: 3px 24px 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 13px;
  }
</style>
