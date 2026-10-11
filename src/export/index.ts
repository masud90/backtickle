/** Export, Print and Copy as HTML (WP3.6a; Word export WP3.6b). Each part is a lazy chunk. */
import type { Shell } from '@/shell/shell.svelte';

const NO_DOCUMENT = 'The document has an error and cannot be exported yet.';

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'The operation failed.';
}

/** File > Export > HTML…: save the rendered document as one HTML file. */
export async function exportHtml(shell: Shell): Promise<void> {
  const tab = shell.active;
  if (!tab) return;
  try {
    const { directoryOf, htmlPage, suggestedHtmlName } = await import('./html');
    const path = await shell.platform.saveDialog({
      suggestedName: suggestedHtmlName(tab.name),
      directory: directoryOf(tab.path),
      kind: 'html',
    });
    if (path === null) return;
    const source = shell.exportSource();
    if (!source) {
      shell.showError(NO_DOCUMENT);
      return;
    }
    const page = await htmlPage(
      shell.platform,
      source.result,
      tab.path,
      tab.name,
      shell.settings.preview,
    );
    await shell.platform.writeExport(path, page);
  } catch (error) {
    shell.showError(messageOf(error));
  }
}

/** File > Export > Word Document…: DOCX through Pandoc. */
export async function exportDocx(shell: Shell): Promise<void> {
  const tab = shell.active;
  if (!tab) return;
  try {
    const { buildDocxRequest, suggestedDocxName } = await import('./docx');
    const { directoryOf } = await import('./html');
    if (!(await shell.platform.pandocInfo())) {
      shell.showError('Pandoc was not found');
      return;
    }
    const path = await shell.platform.saveDialog({
      suggestedName: suggestedDocxName(tab.name),
      directory: directoryOf(tab.path),
      kind: 'docx',
    });
    if (path === null) return;
    const source = shell.exportSource();
    if (!source) {
      shell.showError(NO_DOCUMENT);
      return;
    }
    shell.exporting = true;
    try {
      const request = await buildDocxRequest({
        platform: shell.platform,
        flavor: tab.flavor,
        fileName: tab.name,
        docPath: tab.path,
        text: shell.tabText(tab.id) ?? tab.initialText ?? '',
        result: source.result,
        outPath: path,
      });
      await shell.platform.exportDocx(request);
    } finally {
      shell.exporting = false;
    }
  } catch (error) {
    shell.showError(messageOf(error));
  }
}

/** File > Export > PDF…: the print view saved as a PDF, no print panel. */
export async function exportPdf(shell: Shell): Promise<void> {
  const tab = shell.active;
  if (!tab) return;
  try {
    const { suggestedPdfName } = await import('./pdf');
    const { directoryOf } = await import('./html');
    const path = await shell.platform.saveDialog({
      suggestedName: suggestedPdfName(tab.name),
      directory: directoryOf(tab.path),
      kind: 'pdf',
    });
    if (path === null) return;
    await exportPdfTo(shell, path);
  } catch (error) {
    shell.showError(messageOf(error));
  }
}

/** The PDF export to a path that is already an export target (also the PDF benchmark). */
export async function exportPdfTo(shell: Shell, path: string): Promise<void> {
  const tab = shell.active;
  if (!tab) return;
  try {
    const { writePdf } = await import('./pdf');
    const source = shell.exportSource();
    if (!source) {
      shell.showError(NO_DOCUMENT);
      return;
    }
    shell.exporting = true;
    try {
      await writePdf(shell.platform, source.result, tab.path, path);
    } finally {
      shell.exporting = false;
    }
  } catch (error) {
    shell.showError(messageOf(error));
  }
}

/** File > Print…: the macOS print panel (also Save as PDF). */
export async function print(shell: Shell): Promise<void> {
  const tab = shell.active;
  const source = shell.exportSource();
  if (!tab) return;
  if (!source) {
    shell.showError(NO_DOCUMENT);
    return;
  }
  try {
    const { printDocument } = await import('./print');
    await printDocument(shell.platform, source.result, tab.path);
  } catch (error) {
    shell.showError(messageOf(error));
  }
}

/** Edit > Copy as HTML: the rendered document on the clipboard (`platform.writeClipboard`). */
export async function copyHtml(shell: Shell): Promise<void> {
  const tab = shell.active;
  const source = shell.exportSource();
  if (!tab) return;
  if (!source) {
    shell.showError(NO_DOCUMENT);
    return;
  }
  try {
    const { copyAsHtml } = await import('./copy');
    await copyAsHtml(shell.platform, source.preview, source.result, tab.path);
  } catch (error) {
    shell.showError(messageOf(error));
  }
}
