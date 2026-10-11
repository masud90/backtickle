/**
 * Source lines in the DOM of the preview.
 *
 * The HTML of a block never contains absolute line numbers, so it stays the same when the block
 * moves (see `engine.ts`). List items and table rows carry their line relative to the block
 * (`data-wd-rl`), task checkboxes likewise (`data-wd-trl`). When a block is shown, or when it
 * stays and only its position in the source changed, the absolute lines are written from the
 * line of the block: `data-line` on the block, its list items and table rows, `data-task-line`
 * on task checkboxes. Writing them is idempotent, so a block can be updated any number of times.
 */

const INNER = '[data-wd-rl], [data-wd-trl]';

/** True if the HTML of a block has elements that need `applyInnerLines`. */
export function hasInnerLines(html: string): boolean {
  return html.includes(' data-wd-');
}

function setIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Writes `data-line` and `data-task-line` of the elements inside a block. */
export function applyInnerLines(wrapper: Element, line: number): void {
  for (const element of wrapper.querySelectorAll(INNER)) {
    const relative = element.getAttribute('data-wd-rl');
    if (relative !== null) setIfChanged(element, 'data-line', String(line + Number(relative)));
    const taskRelative = element.getAttribute('data-wd-trl');
    if (taskRelative !== null) {
      setIfChanged(element, 'data-task-line', String(line + Number(taskRelative)));
    }
  }
}

/** Writes the lines of a block wrapper and of the elements inside it. */
export function applyBlockLines(
  wrapper: Element,
  line: number,
  endLine: number,
  withInner: boolean,
): void {
  setIfChanged(wrapper, 'data-line', String(line));
  setIfChanged(wrapper, 'data-end-line', String(endLine));
  if (withInner) applyInnerLines(wrapper, line);
}
