/** One entry of a popup menu (`Menu.svelte`). */
export interface MenuItem {
  id: string;
  label: string;
  /** A second, quieter line (for example "Renders as GFM for now"). */
  note?: string;
  /** Makes the item a radio entry; true marks the current one. */
  checked?: boolean;
  disabled?: boolean;
  /** The keyboard shortcut, shown at the right edge. */
  shortcut?: string;
  onSelect: () => void;
}
