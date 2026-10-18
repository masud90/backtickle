---
title: MDX Guide
tags: [markdown, mdx, reference]
version: 1.0.0
author: Backtickle
---

# MDX Guide

This guide shows the MDX syntax supported by Backtickle, on top of GitHub Flavored Markdown. Each feature has one section: a short description, the source in a code block, and the rendered result directly below it. Components are shown, never run: Backtickle displays each component as a labeled box with its props and its Markdown children, and it never evaluates JavaScript, imports or expressions from a document.

## Imports and exports

Lines that start with `import` or `export` at the top level of the document are ESM. They are collapsed and dimmed in the preview.

```markdown
import { Chart } from './components/chart.js'
export const author = 'Example Author'
```

Result:

import { Chart } from './components/chart.js'
export const author = 'Example Author'

## Components

A JSX element with a capitalized name is a component. It is shown as a box with its name and props, and the content inside it is rendered as Markdown.

```markdown
<Banner kind="info">
  A component with **Markdown** inside.
</Banner>
```

Result:

<Banner kind="info">
  A component with **Markdown** inside.
</Banner>

## Props

Props are written as attributes. Strings use quotes, and anything else goes in braces. Backtickle shows the source text of each value and does not evaluate it.

```markdown
<Card title="Example" count={3} enabled tags={['a', 'b']} />
```

Result:

<Card title="Example" count={3} enabled tags={['a', 'b']} />

## Children

Everything between the opening and closing tags is Markdown. Leave a blank line after the opening tag so that block Markdown such as lists works inside.

```markdown
<Panel title="Steps">

- Draft the text
- Review it
- Publish it

</Panel>
```

Result:

<Panel title="Steps">

- Draft the text
- Review it
- Publish it

</Panel>

## Inline components

A component inside a line of text is shown inline.

```markdown
The value is <Badge color="green">stable</Badge> in this release.
```

Result:

The value is <Badge color="green">stable</Badge> in this release.

## HTML elements

Lower-case elements are plain HTML. They are rendered after sanitizing, so scripts and event handlers are removed. In MDX, use `className` instead of `class`.

```markdown
<div className="note">
  <p>Plain <strong>HTML</strong> in MDX.</p>
</div>
```

Result:

<div className="note">
  <p>Plain <strong>HTML</strong> in MDX.</p>
</div>

## Expressions

Curly braces hold a JavaScript expression. Backtickle shows the expression as code and does not evaluate it.

```markdown
Two plus two is {2 + 2}, and the title is {frontmatter.title}.
```

Result:

Two plus two is {2 + 2}, and the title is {frontmatter.title}.

## GFM inside MDX

The GFM features work in MDX: tables, task lists, strikethrough, footnotes and autolinked URLs. Angle-bracket autolinks are not allowed in MDX; write the URL plainly.

```markdown
| Feature | Works |
|:--------|:-----:|
| Tables  | yes   |
| Tasks   | yes   |

- [x] A finished task
- [ ] An open task

This is ~~struck out~~ text with a note.[^mdx] See https://example.org.

[^mdx]: A footnote inside an MDX document.
```

Result:

| Feature | Works |
|:--------|:-----:|
| Tables  | yes   |
| Tasks   | yes   |

- [x] A finished task
- [ ] An open task

This is ~~struck out~~ text with a note.[^mdx] See https://example.org.

[^mdx]: A footnote inside an MDX document.

## Errors

MDX is stricter than plain Markdown. An unclosed tag or an unbalanced brace is a parse error. Backtickle keeps the last good preview, shows a banner "MDX error on line N" above it, and the banner has a button that moves the cursor to that line. The source below is an error, so it is shown as code only.

```markdown
<Banner>
This tag is never closed.
```
