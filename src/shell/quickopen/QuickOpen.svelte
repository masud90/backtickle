<script lang="ts">
  /** Quick Open: the picker over open tabs, recents and the folder's files. */
  import { onMount } from 'svelte';
  import Picker from '../Picker.svelte';
  import type { PickerItem } from '../picker';
  import type { Shell } from '../shell.svelte';
  import { buildCandidates, type Candidate, pickerRows } from './candidates';

  interface Props {
    shell: Shell;
    folder: string | null;
    onClose: () => void;
  }

  let { shell, folder, onClose }: Props = $props();

  let query = $state('');
  let folderFiles = $state.raw<string[]>([]);

  onMount(() => {
    // The index of the open folder arrives after the picker is shown.
    if (!folder) return;
    let alive = true;
    void shell.platform
      .fileIndex(folder)
      .then((index) => {
        if (alive) folderFiles = index.paths;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  const candidates = $derived(
    buildCandidates({
      tabs: shell.tabs.flatMap((tab) => (tab.path ? [tab.path] : [])),
      recents: shell.recents,
      folder,
      folderFiles,
    }),
  );
  const byPath = $derived(new Map<string, Candidate>(candidates.map((item) => [item.path, item])));
  const items = $derived(pickerRows(candidates, query));

  function choose(item: PickerItem) {
    const picked = byPath.get(item.id);
    onClose();
    if (!picked) return;
    // A recent outside the granted folders is granted by `openRecent`.
    void shell.enqueue(() =>
      picked.source === 'recent' ? shell.openRecent(picked.path) : shell.openPaths([picked.path]),
    );
  }
</script>

<Picker
  {items}
  label="Quick Open"
  placeholder="Open a file by name"
  bind:query
  emptyText={candidates.length === 0 ? 'No files to open' : 'No matching files'}
  onChoose={choose}
  {onClose}
/>
