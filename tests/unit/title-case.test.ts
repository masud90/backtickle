/**
 * Title case in the reference list. Expected strings are
 * Pandoc 3.8.3 `--citeproc` output (default style) for 177 probe titles, in
 * tests/fixtures/flavors/pandoc/expected/title-case.json as [input, expected].
 */
import { describe, expect, it } from 'vitest';
import { formatEntry } from '@/preview/bibliography/format';
import { titleCase } from '@/preview/bibliography/title-case';
import pairsText from '../fixtures/flavors/pandoc/expected/title-case.json?raw';

const pairs = JSON.parse(pairsText) as Array<[string, string]>;
const norm = (text: string) => text.replace(/[‘’]/g, "'").replace(/\.$/, '');

describe('title case against Pandoc output', () => {
  it('has the probe titles', () => {
    expect(pairs.length).toBeGreaterThan(150);
  });
  it('matches every probe whose text Pandoc did not otherwise change', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const [input, expected] of pairs) {
      if (norm(input).toLowerCase() !== norm(expected).toLowerCase()) continue;
      checked++;
      const got = norm(titleCase(input));
      if (got !== norm(expected)) wrong.push(`${input} => ${got} (Pandoc: ${expected})`);
    }
    expect(checked).toBeGreaterThan(150);
    expect(wrong).toEqual([]);
  });
  it('leaves a non-English title alone and cases English variants', () => {
    expect(titleCase('la vie de la mer', 'fr')).toBe('la vie de la mer');
    expect(titleCase('the life of the sea', 'en-GB')).toBe('The Life of the Sea');
  });
  it('applies to the title and the container in the reference list', () => {
    const html = formatEntry(
      {
        id: 'a',
        type: 'article-journal',
        author: [{ family: 'Zjournal', given: 'A' }],
        title: 'the article of the day',
        'container-title': 'journal of the study of things',
        volume: '3',
        page: '1-2',
      },
      '2001',
    ).text;
    // Pandoc: Zjournal, A. 2001. "The Article of the Day." Journal of the Study of Things 3: 1-2.
    expect(html).toContain('“The Article of the Day.”');
    expect(html).toContain('Journal of the Study of Things 3');
  });
});
