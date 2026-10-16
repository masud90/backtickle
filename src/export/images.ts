/**
 * Local images for a page that leaves the app: the bytes come from
 * Rust through the same resolution as the preview (`readImageBytes`), up to 10 MiB each, and
 * become `data:` URIs. A larger image keeps a `file:` URL; remote images are not touched.
 */
import { fileUrl, isAbsolutePath, joinPath, parentFolder } from '@/lib/paths';
import type { Platform, PlatformError } from '@/lib/platform';

export const MAX_EMBEDDED_IMAGE_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

/** The media type of an image: its first bytes when they are known, else its extension. */
export function imageType(bytes: Uint8Array, source: string): string {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'image/webp';
  }
  const extension = (source.split(/[?#]/)[0] ?? '').split('.').pop()?.toLowerCase() ?? '';
  return TYPES[extension] ?? 'application/octet-stream';
}

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

/** `file:` URL of an image that is too large to embed (the source is relative to the document). */
export function fileUrlOf(docPath: string, source: string): string {
  let decoded = source;
  try {
    decoded = decodeURI(source);
  } catch {
    // keep the text as written
  }
  const resolved = joinPath(parentFolder(docPath) ?? '/', decoded);
  return fileUrl(isAbsolutePath(resolved) ? resolved : `/${resolved}`);
}

/** A resolver for `EnhanceContext.resolveImage` that answers with `data:` URIs. */
export function dataUriResolver(
  platform: Platform,
  docPath: string,
  maxBytes: number = MAX_EMBEDDED_IMAGE_BYTES,
): (source: string) => Promise<string> {
  return async (source) => {
    try {
      const bytes = await platform.readImageBytes(docPath, source, maxBytes);
      return `data:${imageType(bytes, source)};base64,${toBase64(bytes)}`;
    } catch (error) {
      if ((error as Partial<PlatformError> | null)?.code === 'too-large') {
        return fileUrlOf(docPath, source);
      }
      throw error;
    }
  };
}

/**
 * Selections: images that the preview already shows (an asset address) are swapped for `data:`
 * URIs by their source as written; an image that cannot be read is left as it is.
 */
export async function embedImages(
  root: Element | DocumentFragment,
  resolve: (source: string) => Promise<string>,
): Promise<void> {
  const images = [...root.querySelectorAll('img[data-wd-src]')];
  await Promise.all(
    images.map(async (image) => {
      const source = image.getAttribute('data-wd-src');
      if (source === null) return;
      try {
        image.setAttribute('src', await resolve(source));
      } catch {
        // leave the address the preview used
      }
    }),
  );
}

/**
 * Remote images that the "Load remote images" setting kept out of the preview go back into a page
 * that leaves the app, with the address as written. They are either
 * still an `img` with `data-wd-remote` (the sanitized HTML of a block) or the placeholder the
 * preview drew (a selection copied from the preview).
 */
export function restoreRemoteImages(root: Element | DocumentFragment): void {
  for (const image of root.querySelectorAll('img[data-wd-remote]')) {
    const source = image.getAttribute('data-wd-src');
    image.removeAttribute('data-wd-remote');
    image.removeAttribute('data-wd-src');
    if (source !== null) image.setAttribute('src', source);
  }
  for (const placeholder of [
    ...root.querySelectorAll('.wd-image-remote-off[data-wd-remote-src]'),
  ]) {
    const image = placeholder.ownerDocument.createElement('img');
    image.setAttribute('src', placeholder.getAttribute('data-wd-remote-src') ?? '');
    image.setAttribute('alt', placeholder.getAttribute('data-wd-remote-alt') ?? '');
    placeholder.replaceWith(image);
  }
}
