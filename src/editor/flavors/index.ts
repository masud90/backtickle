/**
 * The editor side of each Markdown flavor: extra syntax, Insert menu commands and
 * completion sources. One module per flavor, imported on first use, so a CommonMark or GFM
 * document never loads the code of the other flavors.
 */
import type { CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { FlavorId } from '../flavor';

export interface InsertCommand {
  id: string;
  label: string;
  /** An icon name of `src/shell/icons`. */
  icon: string;
  /** Changes the document as one undo step. Returns false when it did nothing. */
  run(view: EditorView): boolean;
}

export interface FlavorEditor {
  /** Lezer Markdown extensions and highlighting for the flavor's syntax. */
  syntax: Extension;
  /** Shown in the toolbar Insert menu. */
  inserts: InsertCommand[];
  /** `@codemirror/autocomplete` sources. */
  completions?: CompletionSource[];
}

type FlavorModule = { flavorEditor: FlavorEditor };

const loaders: Record<FlavorId, () => Promise<FlavorModule>> = {
  commonmark: () => import('./commonmark'),
  gfm: () => import('./gfm'),
  pandoc: () => import('./pandoc'),
  quarto: () => import('./quarto'),
  obsidian: () => import('./obsidian'),
  mdx: () => import('./mdx'),
};

const loaded = new Map<FlavorId, FlavorEditor>();
const pending = new Map<FlavorId, Promise<FlavorEditor>>();

/** Loads (once) the editor module of a flavor. */
export function loadFlavorEditor(flavor: FlavorId): Promise<FlavorEditor> {
  const ready = loaded.get(flavor);
  if (ready) return Promise.resolve(ready);
  let promise = pending.get(flavor);
  if (!promise) {
    promise = loaders[flavor]().then((module) => {
      if (!loaded.has(flavor)) loaded.set(flavor, module.flavorEditor);
      pending.delete(flavor);
      return loaded.get(flavor) as FlavorEditor;
    });
    pending.set(flavor, promise);
  }
  return promise;
}

/** The module of a flavor when it has been loaded already, else undefined. */
export function loadedFlavorEditor(flavor: FlavorId): FlavorEditor | undefined {
  return loaded.get(flavor);
}

/**
 * Test seam: replaces the editor module of a flavor (or restores the real one with null). The
 * change shows the next time a document of that flavor is set up.
 */
export function overrideFlavorEditor(flavor: FlavorId, editor: FlavorEditor | null): void {
  if (editor) loaded.set(flavor, editor);
  else loaded.delete(flavor);
}
