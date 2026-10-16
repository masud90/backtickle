/**
 * Images pasted or dropped into the editor.
 *
 * A paste that carries image files and no text (a screenshot, an image copied in another app)
 * and a drop of image files on the editor are taken away from CodeMirror and handed to the
 * view's image handler with the position they belong at. The handler saves the images next to
 * the document and inserts the links (`insertImageLinks`). Files dropped from Finder on the real
 * app do not reach the page as DOM files: Rust sends them as paths (`onDropImages`).
 */
import { type EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The image types a paste may carry (what Rust accepts by their first bytes). */
export const PASTE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** `paste` images get a made-up name; `drop` images keep their own. */
export type ImageHandler = (images: File[], pos: number, source: 'paste' | 'drop') => void;

const handlers = new WeakMap<EditorView, ImageHandler>();

/** Sets (or with null removes) what a view does with pasted and dropped images. */
export function setImageHandler(view: EditorView, handler: ImageHandler | null): void {
  if (handler) handlers.set(view, handler);
  else handlers.delete(view);
}

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((file) => PASTE_IMAGE_TYPES.has(file.type));
}

/** `image-20261016-183000`, from the local time: the name of a pasted image. */
export function pastedImageName(now: Date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`;
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `image-${date}-${time}`;
}

/** The name of a dropped file without its extension. */
export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The Markdown for images at `pos`: one `![alt](src)` per line, on lines of their own when the
 * text around them is not empty. Returns the text and where the first alt text is in it.
 */
export function imageMarkdown(
  state: EditorState,
  pos: number,
  links: ReadonlyArray<{ src: string; alt: string }>,
): { text: string; altFrom: number; altTo: number } {
  const line = state.doc.lineAt(pos);
  const before = pos > line.from ? '\n' : '';
  const after = pos < line.to ? '\n' : '';
  const body = links.map((link) => `![${link.alt}](${link.src})`).join('\n');
  const first = links[0];
  const altFrom = before.length + 2;
  return {
    text: `${before}${body}${after}`,
    altFrom,
    altTo: altFrom + (first ? first.alt.length : 0),
  };
}

export const imageInput: Extension = Prec.high(
  EditorView.domEventHandlers({
    paste(event, view) {
      const handler = handlers.get(view);
      if (!handler || view.state.readOnly) return false;
      const data = event.clipboardData;
      // Copying an image in a browser also carries HTML; only text means "paste the text".
      if (data?.getData('text/plain') !== '') return false;
      const files = imageFiles(data ?? null);
      if (files.length === 0) return false;
      event.preventDefault();
      handler(files, view.state.selection.main.head, 'paste');
      return true;
    },
    drop(event, view) {
      const handler = handlers.get(view);
      if (!handler || view.state.readOnly) return false;
      const files = imageFiles(event.dataTransfer);
      if (files.length === 0) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      handler(files, pos ?? view.state.selection.main.head, 'drop');
      return true;
    },
  }),
);
