<script lang="ts">
  interface Props {
    checked: boolean;
    onchange: (value: boolean) => void;
    labelledby: string;
    describedby?: string;
    testid?: string;
  }
  let { checked, onchange, labelledby, describedby, testid }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  data-testid={testid}
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative;
    width: 40px;
    height: 24px;
    flex: none;
    border-radius: 12px;
    border: 1px solid var(--wd-outline);
    background: var(--wd-surface-container-highest);
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .switch[aria-checked="true"] {
    background: var(--wd-primary);
    border-color: var(--wd-primary);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--wd-outline);
    transition: transform 0.15s, background-color 0.15s;
  }
  .switch[aria-checked="true"] .knob {
    transform: translateX(16px);
    background: var(--wd-on-primary);
  }
</style>
