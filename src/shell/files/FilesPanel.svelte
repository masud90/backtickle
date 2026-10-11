<script lang="ts">
  import { tick, untrack } from 'svelte';
  import Icon from '@/shell/icons/Icon.svelte';
  import Menu from '../Menu.svelte';
  import type { MenuItem } from '../menu';
  import type { Shell } from '../shell.svelte';
  import { fileName } from '../document';
  import { getFilesModel } from './model.svelte';
  import RenameField from './RenameField.svelte';
  import { finalName, nameProblem, treeKey } from './tree';

  let { shell }: { shell: Shell } = $props();

  // svelte-ignore state_referenced_locally
  const model = getFilesModel(shell);

  let panel: HTMLDivElement | undefined = $state();
  let treeEl: HTMLDivElement | undefined = $state();
  /** The context menu: the row it is for (null for the empty area) and where it opens. */
  let menu = $state<{ path: string | null; x: number; y: number; align: 'left' | 'right' } | null>(
    null,
  );

  // Windowed list (WP3.11): only the rows in view, plus the tab stop and the focused row, are in
  // the DOM. Every row is ROW_HEIGHT tall, so the position of a row is its index times that.
  // The interface scale (Phase 4) makes the rows taller: h-7 follows the same factor.
  const ROW_HEIGHT = $derived(28 * shell.settings.a11y.scale);
  const OVERSCAN = 8;
  let scrollTop = $state(0);
  let viewHeight = $state(0);

  const activePath = $derived(shell.active?.path ?? null);
  const rootName = $derived(model.folder ? fileName(model.folder) : '');
  const tabStop = $derived(
    model.focused && model.rows.some((row) => row.path === model.focused)
      ? model.focused
      : (model.rows[0]?.path ?? null),
  );

  // Position among the siblings of each row (the rows of other levels are not all in the DOM).
  const siblings = $derived.by(() => {
    const sizes = new Map<string, number>();
    for (const row of model.rows) sizes.set(row.parent, (sizes.get(row.parent) ?? 0) + 1);
    const seen = new Map<string, number>();
    return model.rows.map((row) => {
      const pos = (seen.get(row.parent) ?? 0) + 1;
      seen.set(row.parent, pos);
      return { pos, size: sizes.get(row.parent) ?? pos };
    });
  });

  const shown = $derived.by(() => {
    const rows = model.rows;
    const height = viewHeight > 0 ? viewHeight : 600;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    const indices: number[] = [];
    for (let i = first; i < last; i++) indices.push(i);
    for (const path of [tabStop, model.focused, model.renaming?.path]) {
      if (!path) continue;
      const index = rows.findIndex((row) => row.path === path);
      if (index >= 0 && (index < first || index >= last) && !indices.includes(index)) {
        indices.push(index);
      }
    }
    return indices.flatMap((index) => {
      const row = rows[index];
      return row ? [{ row, index }] : [];
    });
  });

  /** Scrolls the tree just enough to bring a row into view, whether or not it is rendered. */
  function scrollToRow(path: string) {
    if (!treeEl) return;
    const index = model.rows.findIndex((row) => row.path === path);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    const height = treeEl.clientHeight || viewHeight || 600;
    if (top < treeEl.scrollTop) treeEl.scrollTop = top;
    else if (top + ROW_HEIGHT > treeEl.scrollTop + height) {
      treeEl.scrollTop = top + ROW_HEIGHT - height;
    }
    scrollTop = treeEl.scrollTop;
  }

  // The active document's row is revealed (its folders expanded) and scrolled into view.
  $effect(() => {
    const path = activePath;
    const folder = model.folder;
    if (!path || !folder) return;
    void untrack(async () => {
      if (!(await model.reveal(path))) return;
      scrollToRow(path);
      await tick();
    });
  });

  function rowElement(path: string): HTMLElement | null {
    if (!treeEl) return null;
    for (const el of treeEl.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
      if (el.dataset.path === path) return el;
    }
    return null;
  }

  async function focusRow(path: string) {
    model.focused = path;
    scrollToRow(path);
    await tick();
    if (model.renaming) return;
    rowElement(path)?.focus();
  }

  function openFile(path: string) {
    void shell.enqueue(() => shell.openPaths([path]));
  }

  function onRowClick(row: (typeof model.rows)[number]) {
    model.focused = row.path;
    if (row.kind === 'file') openFile(row.path);
    else void model.toggle(row.path);
  }

  function onTreeKeyDown(event: KeyboardEvent) {
    if (model.renaming) return;
    const rows = model.rows;
    const index = rows.findIndex((row) => row.path === tabStop);
    const row = rows[index];
    if (event.key === 'F2' && row) {
      event.preventDefault();
      model.startRename(row.path);
      return;
    }
    if (event.key === 'Backspace' && event.metaKey && row) {
      event.preventDefault();
      void model.trash(row.path);
      return;
    }
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && row) {
      event.preventDefault();
      openMenuFor(row.path);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = treeKey(event.key, rows, index < 0 ? 0 : index);
    if (!action) return;
    event.preventDefault();
    switch (action.kind) {
      case 'move': {
        const target = rows[action.to];
        if (target) void focusRow(target.path);
        break;
      }
      case 'expand':
        void model.expand(action.path);
        break;
      case 'collapse':
        model.collapse(action.path);
        break;
      case 'open':
        openFile(action.path);
        break;
      case 'toggle':
        void model.toggle(action.path);
        break;
    }
  }

  // ---- the context menu -------------------------------------------------------------------------

  function openMenuFor(path: string) {
    const el = rowElement(path);
    const box = panel?.getBoundingClientRect();
    const rect = el?.getBoundingClientRect();
    if (!box || !rect) return;
    model.focused = path;
    menu = { path, x: rect.right - box.left - 4, y: rect.bottom - box.top, align: 'right' };
  }

  function onContextMenu(event: MouseEvent, path: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const box = panel?.getBoundingClientRect();
    if (!box) return;
    if (path) model.focused = path;
    menu = { path, x: event.clientX - box.left, y: event.clientY - box.top, align: 'left' };
  }

  function closeMenu() {
    const path = menu?.path;
    menu = null;
    if (path) void focusRow(path);
  }

  const menuItems = $derived.by<MenuItem[]>(() => {
    if (!menu) return [];
    const path = menu.path;
    const row = path ? model.rows.find((candidate) => candidate.path === path) : null;
    const target = path ?? model.folder ?? '';
    const forRow = row !== null && row !== undefined;
    return [
      {
        id: 'new-file',
        label: 'New File',
        onSelect: () => void model.newFile(model.targetFolder(path)),
      },
      {
        id: 'new-folder',
        label: 'New Folder',
        onSelect: () => void model.newFolder(model.targetFolder(path)),
      },
      {
        id: 'rename',
        label: 'Rename',
        shortcut: 'F2',
        disabled: !forRow,
        onSelect: () => model.startRename(target),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        disabled: !forRow || row?.kind !== 'file',
        onSelect: () => void model.duplicate(target),
      },
      {
        id: 'trash',
        label: 'Move to Trash',
        shortcut: '⌘⌫',
        disabled: !forRow,
        onSelect: () => void model.trash(target),
      },
      {
        id: 'reveal',
        label: 'Reveal in Finder',
        onSelect: () => void model.revealInFinder(target),
      },
      { id: 'copy-path', label: 'Copy Path', onSelect: () => void model.copyPath(target) },
    ];
  });

  // ---- renaming ---------------------------------------------------------------------------------

  async function commitRename(path: string, kind: 'folder' | 'file', typed: string) {
    const current = model.renaming;
    if (!current || current.path !== path) return;
    const name = finalName(fileName(path), typed, kind);
    const problem = nameProblem(name);
    if (problem) {
      model.renaming = { ...current, error: problem };
      return;
    }
    const message = await model.rename(path, name);
    if (message === null) {
      await tick();
      rowElement(model.focused ?? '')?.focus();
    } else if (model.renaming?.path === path) {
      model.renaming = { ...model.renaming, error: message };
    } else {
      shell.showError(message);
    }
  }

  async function cancelRename(path: string) {
    model.cancelRename();
    await tick();
    rowElement(path)?.focus();
  }
</script>

{#if !model.folder}
  <div
    data-testid="files-empty"
    class="my-2 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/40 bg-surface-container-lowest/50 p-4 text-center"
  >
    <span
      class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
    >
      <Icon name="folder-open" size={20} />
    </span>
    <p class="mb-1 font-label-md text-label-md font-semibold text-on-surface">No folder open</p>
    <button
      type="button"
      data-testid="files-open-folder"
      onclick={() => void shell.run('open-folder')}
      class="mt-2 flex min-h-6 items-center gap-1 rounded px-1 font-label-md text-label-md font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      Open Folder…
    </button>
  </div>
{:else}
  <div bind:this={panel} data-testid="files-panel" class="relative flex min-h-0 flex-1 flex-col">
    <div class="mb-1 flex items-center gap-1 px-1">
      <span class="inline-flex text-on-surface-variant" aria-hidden="true"
        ><Icon name="folder-open" size={15} /></span
      >
      <span
        data-testid="files-root"
        title={model.folder}
        class="min-w-0 flex-1 truncate font-label-md text-label-md font-semibold text-on-surface"
        >{rootName}</span
      >
      <button
        type="button"
        data-testid="files-change-folder"
        aria-label="Open Folder…"
        title="Open Folder…"
        onclick={() => void shell.run('open-folder')}
        class="inline-flex h-6 w-6 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Icon name="folder" size={14} />
      </button>
    </div>

    {#if model.error}
      <p role="alert" data-testid="files-error" class="px-2 py-2 text-[length:calc(12px*var(--wd-scale,1))] text-error">
        {model.error}
      </p>
    {/if}

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={treeEl}
      role="tree"
      aria-label="Files in {rootName}"
      data-testid="files-tree"
      tabindex="-1"
      onkeydown={onTreeKeyDown}
      onscroll={() => (scrollTop = treeEl?.scrollTop ?? 0)}
      bind:clientHeight={viewHeight}
      oncontextmenu={(event) => onContextMenu(event, null)}
      class="min-h-0 flex-1 overflow-y-auto pb-2 outline-none"
    >
      <div class="relative" style:height="{model.rows.length * ROW_HEIGHT}px">
      {#each shown as { row, index } (row.path)}
        {@const isActive = row.path === activePath}
        {@const isRenaming = model.renaming?.path === row.path}
        <div
          role="none"
          style:top="{index * ROW_HEIGHT}px"
          class="group absolute inset-x-0 flex h-7 items-center"
        >
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            role="treeitem"
            tabindex={row.path === tabStop ? 0 : -1}
            aria-level={row.level}
            aria-setsize={siblings[index]?.size}
            aria-posinset={siblings[index]?.pos}
            aria-expanded={row.kind === 'folder' ? row.expanded : undefined}
            aria-selected={model.focused === row.path}
            aria-current={isActive ? 'true' : undefined}
            data-testid="files-row"
            data-path={row.path}
            data-kind={row.kind}
            data-active={isActive}
            onclick={() => !isRenaming && onRowClick(row)}
            onfocus={() => (model.focused = row.path)}
            oncontextmenu={(event) => onContextMenu(event, row.path)}
            class="wd-tree-indent-{Math.min(32, Math.max(1, row.level))} relative flex min-w-0 flex-1 h-full cursor-default items-center gap-1 rounded-md pr-7 font-body-sm text-[length:calc(13px*var(--wd-scale,1))] text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary {isActive
              ? 'bg-primary/10 font-medium text-primary'
              : ''}"
          >
            <span class="inline-flex w-4 shrink-0 justify-center text-on-surface-variant" aria-hidden="true">
              {#if row.kind === 'folder'}
                <Icon name={row.expanded ? 'expand-more' : 'chevron-right'} size={14} />
              {/if}
            </span>
            <span class="inline-flex shrink-0 text-on-surface-variant" aria-hidden="true">
              <Icon name={row.kind === 'folder' ? 'folder' : 'description'} size={15} />
            </span>
            {#if isRenaming && model.renaming}
              <RenameField
                value={row.name}
                kind={row.kind}
                error={model.renaming.error}
                onCommit={(typed) => void commitRename(row.path, row.kind, typed)}
                onCancel={() => void cancelRename(row.path)}
              />
            {:else}
              <span class="min-w-0 flex-1 truncate">{row.name}</span>
            {/if}
          {#if !isRenaming}
            <button
              type="button"
              tabindex="-1"
              data-testid="files-row-menu"
              aria-haspopup="menu"
              aria-label="Actions for {row.name}"
              onclick={(event) => {
                event.stopPropagation();
                openMenuFor(row.path);
              }}
              class="absolute right-0.5 inline-flex h-5 w-5 items-center justify-center rounded text-on-surface-variant hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-primary {model.focused ===
              row.path
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
            >
              <Icon name="more-horiz" size={14} />
            </button>
          {/if}
          </div>
        </div>
      {/each}
      </div>

      {#if model.rows.length === 0 && !model.error && !model.loading.has(model.folder)}
        <p data-testid="files-folder-empty" class="px-2 py-3 text-[length:calc(12px*var(--wd-scale,1))] text-on-surface-variant">
          No Markdown files in this folder
        </p>
      {/if}
    </div>

    {#if model.truncated}
      <p data-testid="files-truncated" class="px-2 pb-2 text-[length:calc(12px*var(--wd-scale,1))] leading-snug text-on-surface-variant">
        A folder has more than 5,000 items. Only the first 5,000 are shown.
      </p>
    {/if}

    {#if menu}
      <div class="absolute z-50 h-0 w-0" style:left="{menu.x}px" style:top="{menu.y}px">
        <Menu
          items={menuItems}
          label="File actions"
          testId="files-menu"
          align={menu.align}
          onClose={closeMenu}
        />
      </div>
    {/if}
  </div>
{/if}
