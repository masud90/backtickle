/** The data side of the command palette: which commands are listed and in what order. */
import type { MenuState } from '@/lib/platform';
import type { Command } from '../commands';
import { fuzzyRank } from '../fuzzy';
import type { PickerItem } from '../picker';

/** The commands the palette lists: enabled ones, without the palette itself. */
export function listedCommands(commands: readonly Command[], state: MenuState): Command[] {
  return commands.filter((command) => command.id !== 'command-palette' && command.enabled(state));
}

/** Rows for a query: the registry order when empty, the best fuzzy match of the label first otherwise. */
export function paletteRows(commands: readonly Command[], query: string): PickerItem[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return commands.map((command) => ({
      id: command.id,
      label: command.label,
      detail: command.shortcut,
    }));
  }
  return fuzzyRank(commands, trimmed, (command) => command.label).map(({ item, indices }) => ({
    id: item.id,
    label: item.label,
    detail: item.shortcut,
    matches: indices,
  }));
}
