/**
 * What may reach Mermaid from a document. Mermaid reads configuration from the diagram text
 * (`%%{init: ...}%%` directives and a leading `---` block with `config:`), and has `click` and
 * `link` statements that attach callbacks and links. The app decides all of that itself, so the
 * text is cleaned before Mermaid sees it:
 *
 * - every `%%{ ... }%%` directive is removed (not only the ones that name `securityLevel`,
 *   `htmlLabels` or a callback: a directive can also inject CSS through `themeCSS`);
 * - a leading `--- ... ---` block is removed, except for a `title:` line, which is kept;
 * - lines that start with `click`, `callback`, `link` or `links` are removed (they bind
 *   callbacks or add links; the rest of the diagram is unaffected).
 */

const DIRECTIVE = /%%\{[\s\S]*?\}%%/g;
const BINDING_LINE = /^[ \t]*(click|callback|links?)\b.*$/gim;

export function cleanDiagramSource(source: string): string {
  let text = source.replace(/\r\n?/g, '\n');
  const frontmatter = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (frontmatter) {
    const title = /^title:[ \t]*(.+)$/m.exec(frontmatter[1] ?? '');
    text =
      (title ? `---\ntitle: ${title[1]?.replace(/[{}]/g, '')}\n---\n` : '') +
      text.slice(frontmatter[0].length);
  }
  text = text.replace(DIRECTIVE, '');
  text = text.replace(BINDING_LINE, '');
  return text;
}

/** The first word of the diagram, as the label of its type ("flowchart", "sequenceDiagram"). */
export function diagramType(source: string): string {
  const lines = cleanDiagramSource(source).split('\n');
  let inFrontmatter = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter || trimmed === '' || trimmed.startsWith('%%')) continue;
    return trimmed.split(/[\s-]/)[0] ?? 'diagram';
  }
  return 'diagram';
}
