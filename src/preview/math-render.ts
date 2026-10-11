/**
 * Math in the preview: KaTeX fills the placeholders `span.math-inline` and `div.math-display`
 * with MathML after sanitizing. KaTeX is a separate chunk that loads when a document has math
 * (`RenderResult.features.math`), and not before.
 *
 * Settings: MathML output only (no inline styles, no fonts to load, the web view draws it),
 * `trust: false` (no `\href`, `\url`, `\includegraphics`, no HTML attributes from a formula),
 * `throwOnError: false` (a bad formula is shown as its source in the error color) and finite
 * limits for sizes and macro expansion.
 */
import type KatexType from 'katex';

type Katex = typeof KatexType;

let katex: Katex | undefined;
let loading: Promise<Katex> | undefined;

/** KaTeX if it is loaded already. */
export function loadedKatex(): Katex | undefined {
  return katex;
}

export function loadKatex(): Promise<Katex> {
  loading ??= import('katex').then(
    (module) => {
      katex = module.default;
      return module.default;
    },
    (error: unknown) => {
      loading = undefined; // allow another try
      throw error;
    },
  );
  return loading;
}

/** True once an element has been filled, so it is not done twice. */
const DONE = 'math-rendered';

/** Fills one placeholder with MathML. KaTeX must be loaded. */
export function renderMathElement(element: Element, engine: Katex): void {
  if (element.classList.contains(DONE)) return;
  const tex = element.getAttribute('data-tex') ?? '';
  const display = element.classList.contains('math-display');
  let markup: string;
  try {
    markup = engine.renderToString(tex, {
      output: 'mathml',
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxSize: 10,
      maxExpand: 1000,
    });
  } catch {
    // An internal error of KaTeX: leave the source in place and mark it.
    element.classList.add(DONE, 'math-error');
    return;
  }
  const template = element.ownerDocument.createElement('template');
  template.innerHTML = markup;
  // KaTeX writes the error color of a bad formula as an inline style, which the content security
  // policy does not allow: the style class of the preview colors it instead.
  for (const styled of template.content.querySelectorAll('[style]'))
    styled.removeAttribute('style');
  const failed = template.content.querySelector('.katex-error') !== null;
  element.replaceChildren(template.content);
  element.classList.add(DONE);
  if (failed) element.classList.add('math-error');
}
