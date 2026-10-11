import { afterEach, describe, expect, it } from 'vitest';
import { sourceLineOfClick } from '@/shell/preview-click';

function setup(html: string) {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.append(article);
  return article;
}

/** A click event aimed at `target`. */
function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

const HTML =
  '<div class="wd-block" data-line="2"><p>Para <a href="#x">link</a></p></div>' +
  '<div class="wd-block" data-line="5"><ul><li data-line="5">one</li><li data-line="6"><span>two</span></li></ul></div>' +
  '<div class="wd-block" data-line="9"><table><tr data-line="9"><td>cell</td></tr></table></div>' +
  '<div class="wd-block" data-line="12"><h2>Head</h2><input type="checkbox" class="task-checkbox" data-task-line="12"></div>' +
  '<details class="wd-block" data-line="14"><summary>S</summary>body</details>' +
  '<div class="wd-block" data-line="20"><button class="code-copy">Copy</button><pre>code</pre></div>';

const lineOf = (article: HTMLElement, selector: string, init?: MouseEventInit) =>
  sourceLineOfClick(click(article.querySelector(selector) as Element, init), article);

describe('sourceLineOfClick', () => {
  it('takes the innermost data-line', () => {
    const article = setup(HTML);
    expect(lineOf(article, 'p')).toBe(2);
    expect(lineOf(article, 'li span')).toBe(6);
    expect(lineOf(article, 'td')).toBe(9);
    expect(lineOf(article, 'h2')).toBe(12);
  });

  it('ignores links, task boxes, summary and Copy buttons', () => {
    const article = setup(HTML);
    for (const selector of ['a', 'input', 'summary', '.code-copy']) {
      expect(lineOf(article, selector)).toBeNull();
    }
  });

  it('ignores modifiers, other buttons and double clicks', () => {
    const article = setup(HTML);
    expect(lineOf(article, 'p', { metaKey: true })).toBeNull();
    expect(lineOf(article, 'p', { shiftKey: true })).toBeNull();
    expect(lineOf(article, 'p', { button: 2 })).toBeNull();
    expect(lineOf(article, 'p', { detail: 2 })).toBeNull();
  });

  it('ignores the end of a text selection', () => {
    const article = setup(HTML);
    const range = document.createRange();
    range.selectNodeContents(article.querySelector('p') as Element);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    expect(lineOf(article, 'p')).toBeNull();
  });

  it('returns null outside any block', () => {
    const article = setup('<p>no line</p>');
    expect(lineOf(article, 'p')).toBeNull();
  });
});
