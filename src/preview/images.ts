/**
 * Where an image in a document may come from.
 *
 * - `https:` addresses and image `data:` URLs stay in `src` and load as they are.
 * - Relative paths, absolute paths and `file:` URLs are local files. The sanitizer moves them to
 *   `data-wd-src`, and the preview asks the platform for a loadable address once the block is on
 *   screen (`PreviewController` option `resolveImage`).
 * - Everything else (`http:`, `ftp:`, protocol-relative addresses, other `data:` types, unknown
 *   schemes) is blocked: the content security policy would refuse it anyway, so the preview shows
 *   the missing-image placeholder at once.
 */

export type ImageSourceKind = 'keep' | 'local' | 'blocked';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i;

export function classifyImageSource(source: string): ImageSourceKind {
  const value = source.trim();
  if (value === '' || value.startsWith('//')) return 'blocked';
  const scheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  if (scheme === undefined) return 'local';
  if (scheme === 'https') return 'keep';
  if (scheme === 'data') return IMAGE_DATA_URL.test(value) ? 'keep' : 'blocked';
  if (scheme === 'file') return 'local';
  return 'blocked';
}
