/** Escapes the four characters that matter in HTML text and quoted attribute values. */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(text: string): string {
  return /[&<>"]/.test(text) ? text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char) : text;
}
