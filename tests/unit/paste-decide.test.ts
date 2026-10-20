import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decidePaste,
  isExcelHtml,
  type PasteFacts,
  singleUrl,
  tsvRows,
} from '@/editor/smart-paste/decide';
import { rowsFromHtml, tableFromRows } from '@/editor/smart-paste/table';

const fx = (name: string) => readFileSync(resolve(__dirname, '../fixtures/paste', name), 'utf8');

const facts = (over: Partial<PasteFacts>): PasteFacts => ({
  text: '',
  html: '',
  flavor: 'gfm',
  selectedText: '',
  selectionIsLink: false,
  inCode: false,
  ...over,
});

describe('decidePaste', () => {
  const url = 'https://example.org/x';
  it('links a one-line selection', () => {
    expect(decidePaste(facts({ text: url, selectedText: 'here' }))).toEqual({ kind: 'link', url });
  });
  it('pastes the URL as text without a selection, over several lines, over a link, in code', () => {
    expect(decidePaste(facts({ text: url })).kind).toBe('plain');
    expect(decidePaste(facts({ text: url, selectedText: 'a\nb' })).kind).toBe('plain');
    expect(decidePaste(facts({ text: url, selectedText: 'a', selectionIsLink: true })).kind).toBe(
      'plain',
    );
    expect(decidePaste(facts({ text: url, selectedText: 'a', inCode: true })).kind).toBe('plain');
  });
  it('accepts mailto and rejects other schemes and extra text', () => {
    expect(singleUrl('mailto:a@b.org')).toBe('mailto:a@b.org');
    expect(singleUrl('ftp://a.b')).toBeNull();
    expect(singleUrl('see https://a.b')).toBeNull();
  });
  it('keeps code contexts plain even for HTML and cells', () => {
    expect(decidePaste(facts({ html: '<p>x</p>', text: 'x', inCode: true })).kind).toBe('plain');
    expect(decidePaste(facts({ text: 'a\tb\nc\td', inCode: true })).kind).toBe('plain');
  });
  it('detects Excel HTML and TSV tables', () => {
    expect(isExcelHtml(fx('excel.html'))).toBe(true);
    expect(isExcelHtml(fx('web.html'))).toBe(false);
    expect(decidePaste(facts({ html: fx('excel.html'), text: fx('excel.tsv') })).kind).toBe(
      'table-html',
    );
    expect(decidePaste(facts({ text: fx('excel.tsv') })).kind).toBe('table-tsv');
  });
  it('requires a rectangular TSV of at least 2 by 2', () => {
    expect(tsvRows(fx('ragged.tsv'))).toBeNull();
    expect(tsvRows('a\tb')).toBeNull();
    expect(tsvRows('a\nb')).toBeNull();
    expect(tsvRows('a\tb\n')).toBeNull();
    expect(tsvRows('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(decidePaste(facts({ text: fx('ragged.tsv') })).kind).toBe('plain');
  });
  it('sends other HTML to the converter', () => {
    expect(decidePaste(facts({ html: fx('web.html'), text: 'x' })).kind).toBe('html');
  });
});

describe('tables from cells', () => {
  const expected = fx('excel.expected.md').trimEnd();
  it('Excel HTML gives the expected pipe table', () => {
    const rows = rowsFromHtml(fx('excel.html'));
    expect(rows).not.toBeNull();
    expect(tableFromRows(rows ?? [], 'gfm')).toBe(expected);
  });
  it('Excel TSV gives the same table', () => {
    expect(tableFromRows(tsvRows(fx('excel.tsv')) ?? [], 'gfm')).toBe(expected);
  });
  it('escapes pipes and turns line breaks into br', () => {
    expect(
      tableFromRows(
        [
          ['a', 'b'],
          ['x|y', 'l1\nl2'],
        ],
        'gfm',
      ),
    ).toBe('| a | b |\n| --- | --- |\n| x\\|y | l1<br>l2 |');
  });
  it('keeps a backslash that stands before a pipe, and leaves other backslashes alone', () => {
    expect(tableFromRows([['h'], ['a\\|b'], ['C:\\dir']], 'gfm')).toBe(
      '| h |\n| --- |\n| a\\\\\\|b |\n| C:\\dir |',
    );
  });
  it('gives CommonMark an HTML table block', () => {
    const out = tableFromRows(
      [
        ['a', 'b<'],
        ['1', '2'],
      ],
      'commonmark',
    );
    expect(out).toBe(
      '<table>\n<thead><tr><th>a</th><th>b&lt;</th></tr></thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>',
    );
  });
});
