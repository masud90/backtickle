/** The data side of `Picker.svelte` (Quick Open and the command palette). */

export interface PickerItem {
  id: string;
  label: string;
  /** A quieter second part: a folder path, a shortcut. */
  detail?: string;
  /** Indices (UTF-16 units) of the characters of `label` the query matched; they are marked. */
  matches?: readonly number[];
  disabled?: boolean;
}

export interface LabelSegment {
  text: string;
  marked: boolean;
}

/** Splits a label into runs of matched and unmatched characters. Indices out of range are ignored. */
export function labelSegments(
  label: string,
  matches: readonly number[] | undefined,
): LabelSegment[] {
  if (!matches || matches.length === 0) return [{ text: label, marked: false }];
  const marked = new Set(matches.filter((index) => index >= 0 && index < label.length));
  const segments: LabelSegment[] = [];
  for (let i = 0; i < label.length; i++) {
    const isMarked = marked.has(i);
    const last = segments[segments.length - 1];
    if (last && last.marked === isMarked) last.text += label.charAt(i);
    else segments.push({ text: label.charAt(i), marked: isMarked });
  }
  return segments;
}

/** The next selected row for an arrow key: wraps at both ends, skips disabled rows. */
export function nextRow(items: readonly PickerItem[], current: number, step: 1 | -1): number {
  const count = items.length;
  if (count === 0) return -1;
  let index = current;
  for (let tries = 0; tries < count; tries++) {
    index = (index + step + count) % count;
    if (!items[index]?.disabled) return index;
  }
  return current;
}
