<script lang="ts">
  /** The command palette: the enabled commands of the registry. */
  import Picker from '../Picker.svelte';
  import type { PickerItem } from '../picker';
  import type { Shell } from '../shell.svelte';
  import { listedCommands, paletteRows } from './rows';

  interface Props {
    shell: Shell;
    onClose: () => void;
  }

  let { shell, onClose }: Props = $props();

  let query = $state('');
  // The enabling is read once when the palette opens: a command does not appear or vanish under the pointer.
  // svelte-ignore state_referenced_locally
  const commands = listedCommands(shell.commands, shell.menuState);
  const items = $derived(paletteRows(commands, query));

  function choose(item: PickerItem) {
    const command = shell.command(item.id);
    onClose();
    if (command) void shell.enqueue(async () => command.run());
  }
</script>

<Picker
  {items}
  label="Command Palette"
  placeholder="Type a command"
  bind:query
  emptyText="No matching commands"
  onChoose={choose}
  {onClose}
/>
