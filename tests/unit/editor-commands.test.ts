import { describe, expect, it } from 'vitest';
import {
  bold,
  bulletList,
  code,
  codeBlock,
  type FormatCommand,
  formatCommands,
  heading,
  image,
  italic,
  link,
  numberedList,
  paragraph,
  quote,
  rule,
  strikethrough,
  table,
  taskList,
} from '@/editor/commands';
import { apply, StateRunner } from './editor-helpers';

const TABLE = [
  '| Header 1 | Header 2 | Header 3 |',
  '| -------- | -------- | -------- |',
  '|          |          |          |',
].join('\n');
/** The same table with the first header cell marked as the selection. */
const MARKED_TABLE = TABLE.replace('Header 1', '«Header 1»');

describe('inline formatting', () => {
  const kinds = [
    { name: 'bold', command: bold, m: '**' },
    { name: 'italic', command: italic, m: '*' },
    { name: 'strikethrough', command: strikethrough, m: '~~' },
    { name: 'code', command: code, m: '`' },
  ];

  describe.each(kinds)('$name', ({ command, m }) => {
    it('wraps the selected word and keeps it selected', () => {
      expect(apply('say «hello» now', command)).toBe(`say ${m}«hello»${m} now`);
    });

    it('wraps the word at the cursor and keeps the cursor where it was', () => {
      expect(apply('say he‸llo now', command)).toBe(`say ${m}he‸llo${m} now`);
      expect(apply('say hello‸ now', command)).toBe(`say ${m}hello‸${m} now`);
      expect(apply('say ‸hello now', command)).toBe(`say ${m}‸hello${m} now`);
    });

    it('treats an inner apostrophe as part of the word', () => {
      expect(apply("it do‸n't work", command)).toBe(`it ${m}do‸n't${m} work`);
    });

    it('wraps a word in any script', () => {
      expect(apply('dit « été » ici', command)).toBe(`dit  ${m}«été»${m}  ici`);
      expect(apply('读 书‸ 吧', command)).toBe(`读 ${m}书‸${m} 吧`);
    });

    it('inserts an empty pair with the cursor between the markers when there is no word', () => {
      expect(apply('a ‸ b', command)).toBe(`a ${m}‸${m} b`);
      expect(apply('‸', command)).toBe(`${m}‸${m}`);
    });

    it('takes an empty pair away again', () => {
      expect(apply(`a ${m}‸${m} b`, command)).toBe('a ‸ b');
    });

    it('keeps spaces at the ends of the selection outside the markers', () => {
      expect(apply('say « hello » now', command)).toBe(`say  ${m}«hello»${m}  now`);
    });

    it('toggles off when the markers surround the selection', () => {
      expect(apply(`say ${m}«hello»${m} now`, command)).toBe('say «hello» now');
    });

    it('toggles off when the selection includes the markers', () => {
      expect(apply(`say «${m}hello${m}» now`, command)).toBe('say «hello» now');
    });

    it('toggles off with the cursor inside the formatted word', () => {
      expect(apply(`say ${m}he‸llo${m} now`, command)).toBe('say he‸llo now');
    });

    it('toggles off with the cursor inside a formatted phrase of several words', () => {
      expect(apply(`${m}two wo‸rds${m}`, command)).toBe('two wo‸rds');
    });

    it('gives each selected line its own markers and takes them off again', () => {
      const on = `${m}«one${m}\n${m}two»${m}`;
      expect(apply('«one\ntwo»', command)).toBe(on);
      expect(apply(on, command)).toBe('«one\ntwo»');
    });

    it('skips blank lines and list markers in a multi-line selection', () => {
      expect(apply('«one\n\ntwo»', command)).toBe(`${m}«one${m}\n\n${m}two»${m}`);
      expect(apply('«- one\n- two»', command)).toBe(`- ${m}«one${m}\n- ${m}two»${m}`);
      expect(apply('«> one\n> two»', command)).toBe(`> ${m}«one${m}\n> ${m}two»${m}`);
    });

    it('formats only the lines that do not have the format yet', () => {
      const partly = `«${m}one${m}\ntwo»`;
      expect(apply(partly, command)).toBe(`«${m}one${m}\n${m}two»${m}`);
    });

    it('formats text after a heading mark, not the mark', () => {
      expect(apply('«## Title»', command)).toBe(`## ${m}«Title»${m}`);
    });

    it('does nothing for a selection of only a list marker', () => {
      expect(apply('«- »one', command)).toBeNull();
    });

    it('is one undo step, apart from the typing before and after it', () => {
      const runner = new StateRunner('‸');
      runner.type('ab');
      runner.run(command);
      runner.moveToEnd();
      runner.type('c');
      expect(runner.text).toBe(`${m}ab${m}c`);
      runner.undo();
      expect(runner.text).toBe(`${m}ab${m}`);
      runner.undo();
      expect(runner.text).toBe('ab');
      runner.undo();
      expect(runner.text).toBe('');
    });
  });

  describe('italic and bold together', () => {
    it('adds italic to bold text and takes either off again', () => {
      expect(apply('**«word»**', italic)).toBe('***«word»***');
      expect(apply('***«word»***', bold)).toBe('*«word»*');
      expect(apply('***«word»***', italic)).toBe('**«word»**');
    });

    it('recognizes italic written with underscores', () => {
      expect(apply('_«word»_', italic)).toBe('«word»');
    });

    it('does not read bold as italic when the selection includes the markers', () => {
      expect(apply('«**word**»', italic)).toBe('*«**word**»*');
    });
  });

  describe('strikethrough without GFM', () => {
    it('still adds and removes the markers in the CommonMark flavor', () => {
      expect(apply('a «x» b', strikethrough, 'commonmark')).toBe('a ~~«x»~~ b');
      expect(apply('a ~~«x»~~ b', strikethrough, 'commonmark')).toBe('a «x» b');
    });
  });

  describe('code with backticks inside', () => {
    it('uses a longer fence so the span does not end early', () => {
      expect(apply('«a`b»', code)).toBe('``«a`b»``');
    });

    it('pads the text when it starts or ends with a backtick', () => {
      expect(apply('«`x»', code)).toBe('`` «`x» ``');
    });
  });
});

describe('headings', () => {
  it('sets the level on the line of a cursor and moves the cursor past the mark', () => {
    expect(apply('‸Title', (s) => heading(s, 2))).toBe('## ‸Title');
    expect(apply('Ti‸tle', (s) => heading(s, 1))).toBe('# Ti‸tle');
  });

  it('changes the level of an existing heading', () => {
    expect(apply('# Title‸', (s) => heading(s, 3))).toBe('### Title‸');
    expect(apply('###### Title‸', (s) => heading(s, 1))).toBe('# Title‸');
  });

  it('sets the level on every selected line, whatever it was before', () => {
    expect(apply('«one\n# two\n#### three»', (s) => heading(s, 2))).toBe(
      '## «one\n## two\n## three»',
    );
  });

  it('keeps a quote prefix and indentation in front of the mark', () => {
    expect(apply('> quoted‸', (s) => heading(s, 2))).toBe('> ## quoted‸');
    expect(apply('  text‸', (s) => heading(s, 3))).toBe('  ### text‸');
  });

  it('does nothing when every line already has that level', () => {
    expect(apply('## ‸Title', (s) => heading(s, 2))).toBeNull();
    expect(apply('«## a\n## b»', (s) => heading(s, 2))).toBeNull();
  });

  it('puts the mark on a blank line', () => {
    expect(apply('‸', (s) => heading(s, 4))).toBe('#### ‸');
  });

  it('does not take a hashtag for a heading', () => {
    expect(apply('#tag‸', (s) => heading(s, 2))).toBe('## #tag‸');
  });

  it('paragraph removes the mark from every selected line', () => {
    expect(apply('### Title‸', paragraph)).toBe('Title‸');
    expect(apply('«# one\ntext\n## two»', paragraph)).toBe('«one\ntext\ntwo»');
  });

  it('paragraph does nothing on a line that is not a heading', () => {
    expect(apply('plain‸', paragraph)).toBeNull();
    expect(apply('#hashtag‸', paragraph)).toBeNull();
  });

  it('is one undo step for several lines', () => {
    const runner = new StateRunner('«one\ntwo\nthree»');
    runner.run((s) => heading(s, 2));
    expect(runner.text).toBe('## one\n## two\n## three');
    runner.undo();
    expect(runner.text).toBe('one\ntwo\nthree');
  });

  it('a selection that ends at the start of a line leaves that line alone', () => {
    expect(apply('«one\ntwo\n»three', (s) => heading(s, 2))).toBe('## «one\n## two\n»three');
  });
});

describe('quote', () => {
  it('quotes the line of a cursor', () => {
    expect(apply('text‸', quote)).toBe('> text‸');
    expect(apply('‸text', quote)).toBe('> ‸text');
  });

  it('quotes every selected line, with a bare mark on blank lines inside the selection', () => {
    expect(apply('«a\nb»', quote)).toBe('> «a\n> b»');
    expect(apply('«a\n\nb»', quote)).toBe('> «a\n>\n> b»');
  });

  it('gives a lone blank line a mark with a space after it', () => {
    expect(apply('‸', quote)).toBe('> ‸');
  });

  it('removes the quote when every line has it', () => {
    expect(apply('> «a\n> b»', quote)).toBe('«a\nb»');
    expect(apply('>a‸', quote)).toBe('a‸');
  });

  it('removes only one level of nested quotes', () => {
    expect(apply('> > a‸', quote)).toBe('> a‸');
  });

  it('quotes the lines that are not quoted yet and leaves the others', () => {
    expect(apply('«> a\nb»', quote)).toBe('«> a\n> b»');
  });

  it('keeps indentation in front of the mark', () => {
    expect(apply('  a‸', quote)).toBe('  > a‸');
  });

  it('is one undo step', () => {
    const runner = new StateRunner('«a\nb\nc»');
    runner.run(quote);
    runner.undo();
    expect(runner.text).toBe('a\nb\nc');
  });
});

describe('lists', () => {
  it('bullets every selected line', () => {
    expect(apply('item‸', bulletList)).toBe('- item‸');
    expect(apply('«a\nb\nc»', bulletList)).toBe('- «a\n- b\n- c»');
  });

  it('takes the bullets away when every line has one', () => {
    expect(apply('- «a\n- b»', bulletList)).toBe('«a\nb»');
    expect(apply('* a‸', bulletList)).toBe('a‸');
    expect(apply('+ a‸', bulletList)).toBe('a‸');
  });

  it('numbers from 1 and skips blank lines without restarting', () => {
    expect(apply('«a\nb\nc»', numberedList)).toBe('1. «a\n2. b\n3. c»');
    expect(apply('«a\n\nb»', numberedList)).toBe('1. «a\n\n2. b»');
  });

  it('renumbers lines that already have numbers when they are not all numbered', () => {
    expect(apply('«3. a\nb\n9) c»', numberedList)).toBe('«1. a\n2. b\n3. c»');
  });

  it('removes the numbers when every line has one', () => {
    expect(apply('1. «a\n2. b»', numberedList)).toBe('«a\nb»');
  });

  it('converts between bullets, numbers and tasks', () => {
    expect(apply('«- a\n- b»', numberedList)).toBe('«1. a\n2. b»');
    expect(apply('«1. a\n2. b»', bulletList)).toBe('«- a\n- b»');
    expect(apply('«- a\n- b»', taskList)).toBe('«- [ ] a\n- [ ] b»');
    expect(apply('- [ ] a‸', bulletList)).toBe('- a‸');
    expect(apply('- [ ] a‸', numberedList)).toBe('1. a‸');
  });

  it('makes task items, and removes the whole task prefix when all lines are tasks', () => {
    expect(apply('«a\nb»', taskList)).toBe('- [ ] «a\n- [ ] b»');
    expect(apply('- [ ] «a\n- [x] b»', taskList)).toBe('«a\nb»');
  });

  it('keeps a done box when it adds boxes to the other lines', () => {
    expect(apply('«- [x] a\nb»', taskList)).toBe('«- [x] a\n- [ ] b»');
  });

  it('keeps the bullet character of an item that becomes a task', () => {
    expect(apply('* a‸', taskList)).toBe('- [ ] a‸');
  });

  it('keeps indentation and quote marks in front of the marker', () => {
    expect(apply('  a‸', bulletList)).toBe('  - a‸');
    expect(apply('> a‸', bulletList)).toBe('> - a‸');
    expect(apply('> - a‸', bulletList)).toBe('> a‸');
  });

  it('puts a marker on a lone blank line', () => {
    expect(apply('‸', bulletList)).toBe('- ‸');
    expect(apply('‸', numberedList)).toBe('1. ‸');
    expect(apply('‸', taskList)).toBe('- [ ] ‸');
  });

  it('does not take a dash that is not followed by a space for a list marker', () => {
    expect(apply('-5 degrees‸', bulletList)).toBe('- -5 degrees‸');
    expect(apply('**bold** text‸', bulletList)).toBe('- **bold** text‸');
  });

  it('is one undo step for several lines', () => {
    const runner = new StateRunner('«a\nb\nc»');
    runner.run(numberedList);
    expect(runner.text).toBe('1. a\n2. b\n3. c');
    runner.undo();
    expect(runner.text).toBe('a\nb\nc');
  });
});

describe('link and image', () => {
  it('wraps the selection and selects the placeholder address', () => {
    expect(apply('see «the docs» now', link)).toBe('see [the docs](«url») now');
    expect(apply('«diagram»', image)).toBe('![diagram](«path»)');
  });

  it('turns a selected address into the target of an empty link', () => {
    expect(apply('see «https://example.com/a?b=1» now', link)).toBe(
      'see [‸](https://example.com/a?b=1) now',
    );
    expect(apply('«mailto:me@example.com»', link)).toBe('[‸](mailto:me@example.com)');
    expect(apply('«www.example.com»', link)).toBe('[‸](www.example.com)');
  });

  it('treats a selected file name or address as the path of an image', () => {
    expect(apply('«img/photo.PNG»', image)).toBe('![‸](img/photo.PNG)');
    expect(apply('«https://example.com/x»', image)).toBe('![‸](https://example.com/x)');
  });

  it('does not take a sentence with a dot for an address', () => {
    expect(apply('«see example.com now»', link)).toBe('[see example.com now](«url»)');
  });

  it('puts the cursor between the brackets when nothing is selected', () => {
    expect(apply('a ‸ b', link)).toBe('a [‸]() b');
    expect(apply('a ‸ b', image)).toBe('a ![‸]() b');
  });

  it('leaves spaces at the ends of the selection outside the brackets', () => {
    expect(apply('a « the docs » b', link)).toBe('a  [the docs](«url»)  b');
  });

  it('is one undo step', () => {
    const runner = new StateRunner('«word»');
    runner.run(link);
    runner.undo();
    expect(runner.text).toBe('word');
  });
});

describe('code block', () => {
  it('fences the selected lines and puts the cursor after the opening backticks', () => {
    expect(apply('«a\nb»', codeBlock)).toBe('```‸\na\nb\n```');
  });

  it('fences the line of a cursor', () => {
    expect(apply('a‸', codeBlock)).toBe('```‸\na\n```');
    expect(apply('x\ny‸\nz', codeBlock)).toBe('x\n```‸\ny\n```\nz');
  });

  it('fences whole lines even when the selection starts and ends inside them', () => {
    expect(apply('one\ntw«o\nthr»ee\nfour', codeBlock)).toBe('one\n```‸\ntwo\nthree\n```\nfour');
  });

  it('inserts an empty block on a blank line', () => {
    expect(apply('‸', codeBlock)).toBe('```‸\n\n```\n');
  });

  it('puts an empty block after the text above a blank line, with a blank line between', () => {
    expect(apply('para\n‸', codeBlock)).toBe('para\n\n```‸\n\n```\n');
  });

  it('uses a longer fence around text that holds backticks', () => {
    expect(apply('«```js\nx\n```»', codeBlock)).toBe('````‸\n```js\nx\n```\n````');
  });

  it('keeps a blockquote prefix on the fence lines', () => {
    expect(apply('> a‸', codeBlock)).toBe('> ```‸\n> a\n> ```');
  });

  it('is one undo step', () => {
    const runner = new StateRunner('«a\nb»');
    runner.run(codeBlock);
    runner.undo();
    expect(runner.text).toBe('a\nb');
  });
});

describe('table', () => {
  it('inserts a three-column table with the first header cell selected', () => {
    const result = apply('‸', table);
    expect(result).toBe(`${MARKED_TABLE}\n`);
  });

  it('goes after the line of the cursor with a blank line between', () => {
    expect(apply('para‸', table)).toBe(`para\n\n${MARKED_TABLE}\n`);
  });

  it('goes after the last selected line', () => {
    const result = apply('«one\ntwo»\nthree', table);
    expect(result).toBe(`one\ntwo\n\n${MARKED_TABLE}\n\nthree`);
  });

  it('does not count a selection that ends at the start of a line as reaching that line', () => {
    const result = apply('«one\n»two', table);
    expect(result).toBe(`one\n\n${MARKED_TABLE}\n\ntwo`);
  });

  it('uses a blank line after text as the separator and leaves one before the next text', () => {
    const result = apply('a\n‸\nb', table);
    expect(result).toBe(`a\n\n${MARKED_TABLE}\n\nb`);
  });

  it('replaces a blank line that does not follow text', () => {
    const result = apply('a\n\n‸', table);
    expect(result).toBe(`a\n\n${MARKED_TABLE}\n`);
  });

  it('builds a header row, a delimiter row and an empty row', () => {
    const lines = (apply('‸', table) ?? '').replace(/[«»]/g, '').split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3)).toEqual(TABLE.split('\n'));
    expect(lines[0]).toMatch(/^\| Header 1 \| Header 2 \| Header 3 \|$/);
    expect(lines[1]).toMatch(/^\| -+ \| -+ \| -+ \|$/);
    expect(lines[2]).toMatch(/^\| +\| +\| +\|$/);
  });

  it('is one undo step', () => {
    const runner = new StateRunner('para‸');
    runner.run(table);
    runner.undo();
    expect(runner.text).toBe('para');
  });
});

describe('rule', () => {
  it('goes after the line of the cursor with a blank line before it, so it is not a heading underline', () => {
    expect(apply('para‸', rule)).toBe('para\n\n---\n‸');
  });

  it('keeps a blank line between the rule and the text below', () => {
    expect(apply('a‸\nb', rule)).toBe('a\n\n---\n‸\nb');
  });

  it('uses an existing blank line as the separator', () => {
    expect(apply('a\n‸\nb', rule)).toBe('a\n\n---\n‸\nb');
  });

  it('fills an empty document', () => {
    expect(apply('‸', rule)).toBe('---\n‸');
  });

  it('does not touch the selected text', () => {
    expect(apply('«one»', rule)).toBe('one\n\n---\n‸');
  });

  it('is one undo step', () => {
    const runner = new StateRunner('para‸');
    runner.run(rule);
    runner.undo();
    expect(runner.text).toBe('para');
  });
});

describe('every command', () => {
  const names = Object.keys(formatCommands) as FormatCommand[];

  it('is in the table, for the 20 commands of the spec', () => {
    expect(names.sort()).toEqual(
      [
        'bold',
        'italic',
        'strikethrough',
        'code',
        'link',
        'image',
        'quote',
        'bullet-list',
        'numbered-list',
        'task-list',
        'code-block',
        'table',
        'rule',
        'heading-1',
        'heading-2',
        'heading-3',
        'heading-4',
        'heading-5',
        'heading-6',
        'paragraph',
      ].sort(),
    );
  });

  const documents = {
    'a cursor': 'first line‸\nsecond line',
    'a word': 'first «line»\nsecond line',
    'a multi-line selection': '«first line\nsecond line»',
  };

  describe.each(Object.entries(documents))('with %s', (_label, marked) => {
    it.each(names.filter((name) => name !== 'paragraph'))(
      '%s changes the document and one undo restores it',
      (name) => {
        const runner = new StateRunner(marked);
        const before = runner.text;
        expect(runner.run(formatCommands[name])).toBe(true);
        expect(runner.text).not.toBe(before);
        runner.undo();
        expect(runner.text).toBe(before);
      },
    );
  });

  it('paragraph changes a heading and one undo restores it', () => {
    const runner = new StateRunner('«# first\n## second»');
    expect(runner.run(formatCommands.paragraph)).toBe(true);
    expect(runner.text).toBe('first\nsecond');
    runner.undo();
    expect(runner.text).toBe('# first\n## second');
  });

  it('toggling off is undone by one step too', () => {
    const runner = new StateRunner('say «hello» now');
    runner.run(bold);
    runner.run(bold);
    expect(runner.text).toBe('say hello now');
    runner.undo();
    expect(runner.text).toBe('say **hello** now');
  });
});
