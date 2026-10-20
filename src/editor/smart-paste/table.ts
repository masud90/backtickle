/** Tables from spreadsheet cells (rule 3). */
import type { FlavorId } from '../flavor';

/** The cell rows of the first table in Excel's HTML, or null when it has none. */
export function rowsFromHtml(html: string): string[][] | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
    if (cells.length === 0) continue;
    rows.push(
      cells.map((cell) =>
        (cell.textContent ?? '')
          .replace(/ /g, ' ')
          .replace(/\s*\n\s*/g, '\n')
          .trim(),
      ),
    );
  }
  return rows.length > 0 ? rows : null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A pipe gets a backslash, and backslashes just before it are doubled, so `a\|b` keeps its backslash. */
const pipeCell = (cell: string) =>
  cell
    .replace(/(\\*)\|/g, (_, slashes: string) => `${slashes}${slashes}\\|`)
    .replace(/\n/g, '<br>');

/**
 * A pipe table with the first row as header; CommonMark has no pipe tables, so it gets an HTML
 * table block. Rows are padded to the widest row.
 */
export function tableFromRows(rows: string[][], flavor: FlavorId): string {
  const width = Math.max(...rows.map((row) => row.length));
  const header = rows[0] ?? [];
  const full = rows.map((row) => [...row, ...Array<string>(width - row.length).fill('')]);
  if (flavor === 'commonmark') {
    const line = (row: string[], tag: string) =>
      `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell).replace(/\n/g, '<br>')}</${tag}>`).join('')}</tr>`;
    return [
      '<table>',
      `<thead>${line(header.concat(Array<string>(width - header.length).fill('')), 'th')}</thead>`,
      ...(full.length > 1
        ? ['<tbody>', ...full.slice(1).map((row) => line(row, 'td')), '</tbody>']
        : []),
      '</table>',
    ].join('\n');
  }
  const line = (row: string[]) => `| ${row.map(pipeCell).join(' | ')} |`;
  return [
    line(full[0] ?? []),
    line(Array<string>(width).fill('---')),
    ...full.slice(1).map(line),
  ].join('\n');
}
