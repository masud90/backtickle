import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Picker from '@/shell/Picker.svelte';
import { labelSegments, nextRow, type PickerItem } from '@/shell/picker';

const items: PickerItem[] = [
  { id: 'a', label: 'Alpha', detail: 'notes', matches: [0, 1] },
  { id: 'b', label: 'Beta', disabled: true },
  { id: 'c', label: 'Gamma' },
];

describe('labelSegments', () => {
  it('marks runs of matched characters', () => {
    expect(labelSegments('Alpha', [0, 1, 4])).toEqual([
      { text: 'Al', marked: true },
      { text: 'ph', marked: false },
      { text: 'a', marked: true },
    ]);
  });

  it('returns the label whole without matches and ignores indices out of range', () => {
    expect(labelSegments('Beta', undefined)).toEqual([{ text: 'Beta', marked: false }]);
    expect(labelSegments('Beta', [-1, 9])).toEqual([{ text: 'Beta', marked: false }]);
  });
});

describe('nextRow', () => {
  it('wraps and skips disabled rows', () => {
    expect(nextRow(items, 0, 1)).toBe(2);
    expect(nextRow(items, 2, 1)).toBe(0);
    expect(nextRow(items, 0, -1)).toBe(2);
    expect(nextRow([], 0, 1)).toBe(-1);
  });
});

describe('Picker', () => {
  function mount(extra: Partial<{ items: PickerItem[] }> = {}) {
    const onChoose = vi.fn();
    const onClose = vi.fn();
    render(Picker, { props: { items, label: 'Quick Open', onChoose, onClose, ...extra } });
    return { onChoose, onClose, input: screen.getByRole('combobox') };
  }

  it('is a combobox over a listbox, with the first row selected and the focus in the field', () => {
    const { input } = mount();
    const rows = screen.getAllByRole('option');

    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(rows[0]?.id);
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByTestId('picker-match').map((el) => el.textContent)).toEqual(['Al']);
  });

  it('moves with the arrows (skipping the disabled row), chooses with Return, closes with Escape', async () => {
    const { input, onChoose, onClose } = mount();

    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]?.getAttribute('aria-selected')).toBe('true');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith(items[2]);

    await fireEvent.keyDown(input, { key: 'ArrowUp' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChoose).toHaveBeenLastCalledWith(items[0]);

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('chooses a row on click but not a disabled one, and shows the empty text without rows', async () => {
    const { onChoose } = mount();
    const rows = screen.getAllByRole('option');

    await fireEvent.click(rows[1] as HTMLElement);
    expect(onChoose).not.toHaveBeenCalled();
    await fireEvent.click(rows[2] as HTMLElement);
    expect(onChoose).toHaveBeenCalledWith(items[2]);
  });

  it('shows the empty text when there are no rows', () => {
    mount({ items: [] });
    expect(screen.getByTestId('picker-empty').textContent?.trim()).toBe('No matches');
  });
});
