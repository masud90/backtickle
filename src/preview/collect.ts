/**
 * A request to the JavaScript engine to collect garbage now.
 *
 * JavaScript has no way to ask for a collection. Parsing a large document makes hundreds of
 * megabytes of short-lived objects, and the engine of the web view (JavaScriptCore) lets them pile
 * up and does not hand the memory back: the process stays that large for good. What does make it
 * collect is a large allocation that it has to account for, such as an ArrayBuffer of 64 MB (zero
 * filled lazily, so it costs no physical memory and almost no time, and it is freed again by the
 * collection it causes). Parsing a window and then calling this keeps the process at the size of
 * the live data plus one window. Measured on the 5 MiB document of the harness: about 100 MB less
 * in total (WP1.3b). Smaller buffers do less (16 MB gives half of it).
 */
const BUFFER_BYTES = 64 * 1024 * 1024;

export function collectGarbage(): void {
  try {
    const buffer = new ArrayBuffer(BUFFER_BYTES);
    // Used for something, so that no optimizer drops it.
    (buffer as ArrayBuffer & { used?: boolean }).used = true;
  } catch {
    // No memory for it: there is nothing to collect in a hurry either.
  }
}
