<script lang="ts">
  interface Props {
    value: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    onchange: (value: number) => void;
    labelledby: string;
    testid?: string;
  }
  let { value, min, max, step, unit, onchange, labelledby, testid }: Props = $props();

  let text = $state<string | null>(null);

  const shown = $derived(text ?? String(value));

  /** In range and on the step grid (the controls snap; Rust only clamps). */
  function snap(raw: number): number {
    const clamped = Math.min(max, Math.max(min, raw));
    const snapped = min + Math.round((clamped - min) / step) * step;
    return Math.round(Math.min(max, snapped) * 1000) / 1000;
  }

  function commit() {
    if (text === null) return;
    const parsed = Number(text.trim());
    const next = text.trim() === '' || Number.isNaN(parsed) ? value : snap(parsed);
    text = null;
    if (next !== value) onchange(next);
  }

  function bump(direction: 1 | -1) {
    text = null;
    const next = snap(value + direction * step);
    if (next !== value) onchange(next);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      bump(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      bump(-1);
    } else if (event.key === 'Enter') {
      // Return in a number box applies the number; Done is a separate press.
      event.stopPropagation();
      commit();
    }
  }
</script>

<div class="stepper" data-testid={testid}>
  <button
    type="button"
    class="step"
    aria-label="Decrease"
    aria-describedby={labelledby}
    disabled={value <= min}
    onclick={() => bump(-1)}>−</button
  >
  <input
    type="text"
    inputmode="decimal"
    role="spinbutton"
    aria-labelledby={labelledby}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    value={shown}
    oninput={(event) => (text = event.currentTarget.value)}
    onblur={commit}
    {onkeydown}
  />
  <button
    type="button"
    class="step"
    aria-label="Increase"
    aria-describedby={labelledby}
    disabled={value >= max}
    onclick={() => bump(1)}>+</button
  >
  {#if unit}<span class="unit">{unit}</span>{/if}
  <span class="range">{min} to {max}</span>
</div>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  input {
    width: 56px;
    min-height: 28px;
    padding: 3px 6px;
    text-align: center;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 13px;
  }
  .step {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font-size: 15px;
    cursor: pointer;
  }
  .step:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .unit,
  .range {
    font-size: 12px;
    color: var(--wd-on-surface-variant);
  }
  .range {
    margin-left: 6px;
  }
</style>
