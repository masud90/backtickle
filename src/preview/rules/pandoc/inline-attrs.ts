/**
 * Attributes after an inline element, as Pandoc reads them (`link_attributes`,
 * `inline_code_attributes`, `raw_attribute`, and attributes on images):
 *
 *   ![caption](a.png){#fig .wide width=50%}   an image
 *   [text](url){.external}                    a link
 *   `code`{.python}                           inline code
 *   `<b>x</b>`{=html}                         raw HTML (other formats are not shown)
 *
 * It runs after the inline rules: the `{...}` is the start of the text token that follows the
 * element. An image that stands alone in a paragraph, with a caption, is a figure
 * (`implicit_figures`): `figure > img + figcaption`, and the caption is prose.
 */
import type { MarkdownIt, StateCore, Token } from 'markdown-it';
import { applyAttributes, BRACED, parseAttributes } from './attributes';

const HTML_FORMATS = new Set(['html', 'html4', 'html5']);

/** The index of the `link_open` that belongs to the `link_close` at `index`. */
function openOf(children: readonly Token[], index: number): Token | undefined {
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    const token = children[i] as Token;
    if (token.type === 'link_close') depth++;
    else if (token.type === 'link_open' && --depth === 0) return token;
  }
  return undefined;
}

function attributesRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const children = block.children;
    for (let i = 0; i < children.length; i++) {
      const token = children[i] as Token;
      if (token.type !== 'image' && token.type !== 'code_inline' && token.type !== 'link_close') {
        continue;
      }
      const next = children[i + 1];
      if (next?.type !== 'text' || !next.content.startsWith('{')) continue;
      const braced = BRACED.exec(next.content);
      if (!braced) continue;
      const attrs = parseAttributes(braced[1] ?? '');
      if (!attrs) continue;

      if (attrs.raw !== '') {
        if (token.type !== 'code_inline') continue;
        // A raw span: HTML is inline HTML, any other format is not part of an HTML page.
        if (HTML_FORMATS.has(attrs.raw)) {
          token.type = 'html_inline';
          token.tag = '';
        } else {
          token.type = 'critic_text';
          token.content = '';
        }
      } else if (token.type === 'link_close') {
        const open = openOf(children, i);
        if (!open) continue;
        applyAttributes(open, attrs);
      } else {
        applyAttributes(token, attrs);
      }
      next.content = next.content.slice(braced[0].length);
    }
    block.children = children.filter((token) => !(token.type === 'text' && token.content === ''));
  }
}

/** `paragraph(image)` with a caption becomes `figure`: the image, then the caption. */
function figuresRule(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const open = tokens[i] as Token;
    const inline = tokens[i + 1] as Token;
    const close = tokens[i + 2] as Token;
    if (open.type !== 'paragraph_open' || inline.type !== 'inline') continue;
    if (close.type !== 'paragraph_close' || open.hidden) continue;
    const children = inline.children;
    const image = children?.length === 1 ? children[0] : undefined;
    if (image?.type !== 'image' || !image.children || image.children.length === 0) continue;

    open.type = 'figure_open';
    open.tag = 'figure';
    close.type = 'figure_close';
    close.tag = 'figure';
    const caption = new state.Token('figcaption_open', 'figcaption', 1);
    caption.block = true;
    caption.level = close.level + 1;
    const text = new state.Token('inline', '', 0);
    text.content = image.content;
    text.children = image.children;
    text.level = close.level + 2;
    const captionClose = new state.Token('figcaption_close', 'figcaption', -1);
    captionClose.block = true;
    captionClose.level = close.level + 1;
    if (inline.map) {
      caption.map = [inline.map[0], inline.map[1]];
      text.map = [inline.map[0], inline.map[1]];
    }
    tokens.splice(i + 2, 0, caption, text, captionClose);
    i += 5;
  }
}

export function installInlineAttributes(md: MarkdownIt): void {
  // Before the quotes are made curly: `width="50%"` must still be read as written.
  md.core.ruler.after('inline', 'wd_pandoc_inline_attrs', attributesRule);
  md.core.ruler.after('wd_pandoc_inline_attrs', 'wd_pandoc_figures', figuresRule);
}
