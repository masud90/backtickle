---
title: Pandoc Guide
tags: [markdown, pandoc, reference]
version: 1.0.0
subtitle: Pandoc and MultiMarkdown syntax in Writedown
author:
  - name: Writedown
    affiliations:
      - Example Documentation Group
date: 2026-10-06
abstract: |
  This guide shows the Pandoc Markdown syntax supported by Writedown. Every feature has one section with the source and the live result.
link-citations: true
reference-section-title: References
references:
- id: lindqvist2020
  type: article-journal
  author:
  - family: Lindqvist
    given: Aino
  - family: Okoro
    given: Chidi
  issued:
    date-parts:
    - - 2020
  title: Counting fictional lighthouses
  container-title: Journal of Imaginary Studies
  volume: 12
  issue: 3
  page: 101-118
- id: marlowe2021
  type: book
  author:
  - family: Marlowe
    given: Tess
  issued:
    date-parts:
    - - 2021
  title: A field manual for invented places
  publisher: Example Press
- id: tanaka2019
  type: article-journal
  author:
  - family: Tanaka
    given: Yui
  - family: Silva
    given: Rui
  - family: Haddad
    given: Lena
  issued:
    date-parts:
    - - 2019
  title: Maps of places that do not exist
  container-title: Journal of Imaginary Studies
  volume: 9
  page: 14-29
---

# Pandoc Guide

This guide shows the Pandoc Markdown syntax supported by Writedown. Each feature has one section: a short description, the source in a code block, and the rendered result directly below it. Everything in this guide is fictional example content, and nothing in a document is ever executed.

## Title block

The title block comes from the YAML metadata at the top of this file (title, subtitle, author with affiliation, date, abstract). Pandoc also accepts three `%` lines at the very top of a file without YAML, and MultiMarkdown accepts `Key: value` lines at the top of a `.mmd` file. These forms only work at the first line, so they are shown as source only.

```markdown
% A title
% First Author; Second Author
% 2026-10-06
```

```markdown
Title: A title
Author: First Author
Date: 2026-10-06

The document starts after the first blank line.
```

## Citations

Citations use a key from the bibliography, here the inline `references:` list in this file's YAML (a guide has no folder for a bibliography file; a real document usually sets `bibliography: refs.bib`). The reference list is placed at the end of the document.

````markdown
Parenthetical: [@lindqvist2020].
Narrative: @lindqvist2020 found a pattern.
Year only: Lindqvist [-@lindqvist2020] found a pattern.
With locator and prefix: [see @lindqvist2020, pp. 105-110; @marlowe2021, ch. 2].
Three authors: [@tanaka2019].
Several keys: [@lindqvist2020; @marlowe2021; @tanaka2019].
A key that does not exist: [@nobody1999].
````

Result:

Parenthetical: [@lindqvist2020].
Narrative: @lindqvist2020 found a pattern.
Year only: Lindqvist [-@lindqvist2020] found a pattern.
With locator and prefix: [see @lindqvist2020, pp. 105-110; @marlowe2021, ch. 2].
Three authors: [@tanaka2019].
Several keys: [@lindqvist2020; @marlowe2021; @tanaka2019].
A key that does not exist: [@nobody1999].

## Footnotes

Footnotes can be referenced by a label, or written inline with `^[...]`.

```markdown
A claim with a labeled note.[^note1] Another claim with an inline note.^[This note is written right where it belongs.]

[^note1]: The labeled note can hold more text,
    continued on indented lines.
```

Result:

A claim with a labeled note.[^note1] Another claim with an inline note.^[This note is written right where it belongs.]

[^note1]: The labeled note can hold more text,
    continued on indented lines.

## Definition lists

A term on one line, then a colon or tilde and the definition.

```markdown
Lighthouse
:   A tower with a bright light that guides ships.

Harbor
:   A sheltered place for boats.
:   Also a verb: to keep a feeling in mind.
```

Result:

Lighthouse
:   A tower with a bright light that guides ships.

Harbor
:   A sheltered place for boats.
:   Also a verb: to keep a feeling in mind.

## Superscript and subscript

Wrap text in carets for superscript and in single tildes for subscript. Two tildes make strikeout.

```markdown
H~2~O is water, and 2^10^ is 1024. This is ~~struck out~~.
```

Result:

H~2~O is water, and 2^10^ is 1024. This is ~~struck out~~.

## Abbreviations

An abbreviation definition gives the full text as a tooltip wherever the abbreviation appears.

```markdown
The HTML spec is maintained by a working group.

*[HTML]: HyperText Markup Language
```

Result:

The HTML spec is maintained by a working group.

*[HTML]: HyperText Markup Language

## Line blocks

A line block keeps the line breaks and leading spaces exactly as written.

```markdown
| The first line of a verse
| the second, a little shorter
|   and an indented third
```

Result:

| The first line of a verse
| the second, a little shorter
|   and an indented third

## Fancy lists

Lists can use letters, Roman numerals, parentheses, and `#.` for automatic numbering. The first marker sets the style and the start number.

```markdown
#. First, automatic
#. Second, automatic

a) Letter list
b) Second letter

iv. Roman numerals starting at four
v. Next one

(A) Capital letters in parentheses
(B) Next one
```

Result:

#. First, automatic
#. Second, automatic

a) Letter list
b) Second letter

iv. Roman numerals starting at four
v. Next one

(A) Capital letters in parentheses
(B) Next one

## Example lists

Example lists number continuously through the whole document, and a label lets you refer to an example by number.

```markdown
(@good) This is a good example.

(@bad) This is a bad example.

As (@good) shows, and unlike (@bad), labels work anywhere in the text.
```

Result:

(@good) This is a good example.

(@bad) This is a bad example.

As (@good) shows, and unlike (@bad), labels work anywhere in the text.

## Pipe tables

Pipe tables use colons in the separator row for alignment. A caption starts with a colon on its own line after the table.

```markdown
| Place    | Height (m) | Notes   |
|:---------|-----------:|:-------:|
| North    |         32 | Old     |
| South    |         18 | Rebuilt |

: Fictional lighthouses
```

Result:

| Place    | Height (m) | Notes   |
|:---------|-----------:|:-------:|
| North    |         32 | Old     |
| South    |         18 | Rebuilt |

: Fictional lighthouses

## Simple tables

Simple tables need no pipes. The header text position over the dashes sets the alignment.

```markdown
  Place     Height   Notes
-------   --------   -------
North           32   Old
South           18   Rebuilt
-------   --------   -------

Table: Simple table with a caption
```

Result:

  Place     Height   Notes
-------   --------   -------
North           32   Old
South           18   Rebuilt
-------   --------   -------

Table: Simple table with a caption

## Multiline tables

A multiline table lets a cell run over several lines. Rows are separated by blank lines.

```markdown
-----------------------------------------
Place          Description
-------------  --------------------------
North          The oldest tower on the
               coast, with a red roof.

South          Rebuilt after a storm.
-----------------------------------------

Table: Multiline table
```

Result:

-----------------------------------------
Place          Description
-------------  --------------------------
North          The oldest tower on the
               coast, with a red roof.

South          Rebuilt after a storm.
-----------------------------------------

Table: Multiline table

## Grid tables

Grid tables draw the cell borders and allow block content such as lists inside cells.

```markdown
+----------+-----------------------+
| Place    | Features              |
+==========+=======================+
| North    | - Red roof            |
|          | - Foghorn             |
+----------+-----------------------+
| South    | Rebuilt in a new year |
+----------+-----------------------+

: Grid table
```

Result:

+----------+-----------------------+
| Place    | Features              |
+==========+=======================+
| North    | - Red roof            |
|          | - Foghorn             |
+----------+-----------------------+
| South    | Rebuilt in a new year |
+----------+-----------------------+

: Grid table

## MultiMarkdown tables

MultiMarkdown tables allow a caption in brackets below the table and cells that span columns by ending them with extra pipes.

```markdown
| Place | Measurements    ||
|       | Height | Width   |
|-------|-------:|--------:|
| North |     32 |       6 |
| South |     18 |       5 |
[Fictional measurements]
```

Result:

| Place | Measurements    ||
|       | Height | Width   |
|-------|-------:|--------:|
| North |     32 |       6 |
| South |     18 |       5 |
[Fictional measurements]

## Attributes

Curly braces after a heading, image, code block, link or span set an id, classes and key-value pairs. An id can be used as a link target. Only a few classes and the width and height of images have an effect in the preview.

```markdown
#### A heading with an id {#my-heading .unnumbered}

See [the heading](#my-heading). A link with a class: [text](https://example.org){.external}.
```

Result:

#### A heading with an id {#my-heading .unnumbered}

See [the heading](#my-heading). A link with a class: [text](https://example.org){.external}.

## Fenced divs

A fenced div wraps blocks in a container with an id and classes. Divs nest by using more colons on the outer one.

```markdown
::::: {#outer .note}
This is the outer div.

::: {.inner}
This is a nested div with its own class.
:::
:::::
```

Result:

::::: {#outer .note}
This is the outer div.

::: {.inner}
This is a nested div with its own class.
:::
:::::

## Bracketed spans

A span gives inline text an id or classes. The classes `smallcaps`, `underline` and `mark` are understood.

```markdown
This is [small caps]{.smallcaps}, [underlined]{.underline} and [highlighted]{.mark} text.
```

Result:

This is [small caps]{.smallcaps}, [underlined]{.underline} and [highlighted]{.mark} text.

## Raw blocks

A raw block passes content to one output format. HTML is rendered (after sanitizing); other formats such as LaTeX are shown as code and never processed.

````markdown
```{=html}
<p>This paragraph is <em>raw HTML</em>.</p>
```

```{=latex}
\newpage
```
````

Result:

```{=html}
<p>This paragraph is <em>raw HTML</em>.</p>
```

```{=latex}
\newpage
```

## Code blocks with attributes

A code block can carry a language, an id and classes in braces.

````markdown
```{.python #example-code}
def greet(name):
    return "Hello, " + name
```
````

Result:

```{.python #example-code}
def greet(name):
    return "Hello, " + name
```

## CriticMarkup

CriticMarkup records edits: additions, deletions, substitutions, highlights and comments.

```markdown
Added {++new text++}, removed {--old text--}, replaced {~~this~>that~~}, a {==highlight==}{>>and a comment<<}.
```

Result:

Added {++new text++}, removed {--old text--}, replaced {~~this~>that~~}, a {==highlight==}{>>and a comment<<}.

## Smart punctuation

Straight quotes become curly quotes, two hyphens become an en dash, three hyphens an em dash, and three dots an ellipsis.

```markdown
"Double quotes" and 'single quotes', pages 10--12, a pause---like this---and an ellipsis...
```

Result:

"Double quotes" and 'single quotes', pages 10--12, a pause---like this---and an ellipsis...

## Math

Inline math sits between single dollar signs, display math between double ones.

```markdown
Inline: $a^2 + b^2 = c^2$.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$
```

Result:

Inline: $a^2 + b^2 = c^2$.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## Reference list

The reference list is built from the citations above and appears here, under the heading named by `reference-section-title`. To place it elsewhere, add a `::: {#refs}` div; a div is not used in this guide.
