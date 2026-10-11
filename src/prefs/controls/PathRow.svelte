<script lang="ts">
  import { tilde } from '../format';

  interface Props {
    /** The stored path, or null. */
    path: string | null;
    /** Shown when nothing is stored, such as "Found automatically" and the path found. */
    emptyText: string;
    chooseLabel?: string;
    resetLabel: string;
    onchoose: () => void;
    onreset: () => void;
    message?: string;
    labelledby: string;
    testid?: string;
  }
  let {
    path,
    emptyText,
    chooseLabel = 'Choose…',
    resetLabel,
    onchoose,
    onreset,
    message = '',
    labelledby,
    testid,
  }: Props = $props();
</script>

<div class="path" data-testid={testid}>
  <span class="value" class:empty={path === null} data-testid={testid ? `${testid}-value` : undefined}>
    {path === null ? emptyText : tilde(path)}
  </span>
  <div class="buttons">
    <button type="button" aria-describedby={labelledby} onclick={onchoose}>{chooseLabel}</button>
    <button type="button" aria-describedby={labelledby} onclick={onreset}
      >{resetLabel}</button
    >
  </div>
  {#if message}
    <p class="message" role="alert">{message}</p>
  {/if}
</div>

<style>
  .path {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    max-width: 320px;
  }
  .value {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--wd-font-mono);
    font-size: 12px;
    color: var(--wd-on-surface);
  }
  .value.empty {
    font-family: inherit;
    color: var(--wd-on-surface-variant);
  }
  .buttons {
    display: flex;
    gap: 6px;
  }
  button {
    min-height: 28px;
    padding: 3px 12px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .message {
    margin: 0;
    font-size: 12px;
    color: var(--wd-error);
    text-align: right;
  }
</style>
