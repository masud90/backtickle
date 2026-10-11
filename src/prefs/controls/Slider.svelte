<script lang="ts">
  interface Props {
    value: number;
    min: number;
    max: number;
    step: number;
    /** Text for the shown value, such as "150%" or "720 px". */
    format: (value: number) => string;
    /** While dragging (the window throttles the calls). */
    oninput: (value: number) => void;
    /** On release or a key press. */
    oncommit: (value: number) => void;
    labelledby: string;
    testid?: string;
  }
  let { value, min, max, step, format, oninput, oncommit, labelledby, testid }: Props = $props();

  let drag = $state<number | null>(null);
  const current = $derived(drag ?? value);
</script>

<div class="slider">
  <input
    type="range"
    {min}
    {max}
    {step}
    value={current}
    aria-labelledby={labelledby}
    aria-valuetext={format(current)}
    data-testid={testid}
    oninput={(event) => {
      drag = Number(event.currentTarget.value);
      oninput(drag);
    }}
    onchange={(event) => {
      drag = null;
      oncommit(Number(event.currentTarget.value));
    }}
  />
  <output>{format(current)}</output>
</div>

<style>
  .slider {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  input {
    width: 160px;
    accent-color: var(--wd-primary);
  }
  output {
    min-width: 52px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--wd-on-surface);
  }
</style>
