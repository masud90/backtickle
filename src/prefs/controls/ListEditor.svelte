<script lang="ts">
  import Icon from '@/shell/icons/Icon.svelte';

  interface Props {
    items: string[];
    onchange: (items: string[]) => void;
    labelledby: string;
    testid?: string;
  }
  let { items, onchange, labelledby, testid }: Props = $props();

  const MAX_NAMES = 200;

  let draft = $state('');
  let message = $state('');

  function add() {
    const name = draft.trim();
    if (!name) {
      message = 'Enter a file or folder name.';
      return;
    }
    if (name.includes('/')) {
      message = 'A name cannot contain a slash. Enter one name, such as node_modules.';
      return;
    }
    if (items.includes(name)) {
      message = `"${name}" is already in the list.`;
      return;
    }
    if (items.length >= MAX_NAMES) {
      message = `The list holds at most ${MAX_NAMES} names.`;
      return;
    }
    message = '';
    draft = '';
    onchange([...items, name]);
  }

  function remove(name: string) {
    if (items.length <= 1) {
      message = 'The list keeps at least one name. Use Reset to restore the defaults.';
      return;
    }
    message = '';
    onchange(items.filter((item) => item !== name));
  }
</script>

<div class="list" data-testid={testid}>
  <ul aria-labelledby={labelledby}>
    {#each items as name (name)}
      <li>
        <span class="name">{name}</span>
        <button type="button" aria-label={`Remove ${name}`} onclick={() => remove(name)}>
          <Icon name="close" size={14} />
        </button>
      </li>
    {/each}
  </ul>
  <div class="add">
    <input
      type="text"
      aria-label="Name to ignore"
      placeholder="Name to ignore"
      bind:value={draft}
      aria-invalid={message ? 'true' : undefined}
      aria-describedby={message ? `${testid ?? 'list'}-message` : undefined}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          add();
        }
      }}
    />
    <button type="button" class="addbtn" onclick={add}>Add</button>
  </div>
  {#if message}
    <p class="message" id={`${testid ?? 'list'}-message`} role="alert">{message}</p>
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 260px;
  }
  ul {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 2px 2px 10px;
    border-radius: 14px;
    background: var(--wd-surface-container-high);
    font-size: 13px;
    color: var(--wd-on-surface);
  }
  li button {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--wd-on-surface-variant);
    cursor: pointer;
  }
  .add {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    min-height: 28px;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--wd-outline-variant);
    background: var(--wd-surface-container-lowest);
    color: var(--wd-on-surface);
    font: inherit;
    font-size: 13px;
  }
  .addbtn {
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
  .message {
    margin: 0;
    font-size: 12px;
    color: var(--wd-error);
  }
</style>
