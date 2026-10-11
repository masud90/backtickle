---
title: Quarto Guide
tags: [markdown, quarto, reference]
version: 1.0.0
subtitle: Quarto and R Markdown syntax in Writedown
author: Writedown
date: 2026-10-06
number-sections: true
link-citations: true
reference-section-title: References
references:
- id: lindqvist2020
  type: article-journal
  author:
  - family: Lindqvist
    given: Aino
  issued:
    date-parts:
    - - 2020
  title: Counting fictional lighthouses
  container-title: Journal of Imaginary Studies
  volume: 12
  page: 101-118
- id: marlowe2021
  type: book
  author:
  - family: Marlowe
    given: Tess
  - family: Okoro
    given: Chidi
  issued:
    date-parts:
    - - 2021
  title: A field manual for invented places
  publisher: Example Press
---

# Quarto Guide

This guide shows the Quarto and R Markdown syntax supported by Writedown. Each feature has one section: a short description, the source in a code block, and the rendered result directly below it. Quarto documents also accept everything described in the Pandoc guide (footnotes, definition lists, fenced divs, tables, attributes, math and more); this guide covers what Quarto users meet most.

## Code is never run

Writedown shows code chunks, inline code and figure chunks as formatted source. It never starts R, Python, Julia or any other program, so chunk output (tables, plots, printed values) is never shown. This keeps the app safe and light, and it means a document cannot do anything by being opened. To see computed output, render the document with Quarto or R Markdown outside Writedown.

## Citations

Citations work as in Pandoc. This guide lists its sources in the `references:` field of its YAML because it has no folder for a bibliography file; a real document sets `bibliography: refs.bib`.

```markdown
Parenthetical [@lindqvist2020], narrative @lindqvist2020, year only [-@lindqvist2020],
and with a locator [see @marlowe2021, pp. 12-14; @lindqvist2020].
```

Result:

Parenthetical [@lindqvist2020], narrative @lindqvist2020, year only [-@lindqvist2020],
and with a locator [see @marlowe2021, pp. 12-14; @lindqvist2020].

## Cross-references to figures

Give a figure an id that starts with `fig-`, then refer to it with `@fig-id`. The figure is numbered in order.

```markdown
![A small sample picture](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNImXYCK2IYWhIA3E1wgc0lMTEAAAAASUVORK5CYII=){#fig-sample}

As @fig-sample shows, the picture is small. A capitalized reference: @Fig-sample. A missing target: @fig-nothing.
```

Result:

![A small sample picture](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNImXYCK2IYWhIA3E1wgc0lMTEAAAAASUVORK5CYII=){#fig-sample}

As @fig-sample shows, the picture is small. A capitalized reference: @Fig-sample. A missing target: @fig-nothing.

## Cross-references to tables

A table gets a number when its caption ends with an id that starts with `tbl-`.

```markdown
| Place | Height (m) |
|:------|-----------:|
| North |         32 |
| South |         18 |

: Fictional lighthouses {#tbl-lights}

See @tbl-lights for the heights.
```

Result:

| Place | Height (m) |
|:------|-----------:|
| North |         32 |
| South |         18 |

: Fictional lighthouses {#tbl-lights}

See @tbl-lights for the heights.

## Cross-references to equations and sections

Display equations take an id that starts with `eq-`, and headings take one that starts with `sec-`. Because this guide sets `number-sections: true`, a section reference shows the section number.

```markdown
$$
E = mc^2
$$ {#eq-energy}

Equation @eq-energy is famous. See @sec-callouts for callouts.
```

Result:

$$
E = mc^2
$$ {#eq-energy}

Equation @eq-energy is famous. See @sec-callouts for callouts.

## Callouts {#sec-callouts}

A callout is a fenced div with a class `callout-note`, `callout-tip`, `callout-important`, `callout-warning` or `callout-caution`. Use `title` for a title and `collapse` to make it foldable (`true` starts closed, `false` starts open).

```markdown
::: {.callout-note}
A plain note with the default title.
:::

::: {.callout-tip title="A custom title"}
A tip with its own title.
:::

::: {.callout-warning collapse="true" title="Folded warning"}
Hidden until you open it.
:::

::: {.callout-important}
### Title from a heading

A heading at the start of the callout becomes its title.
:::

::: {.callout-caution}
Take care here.
:::
```

Result:

::: {.callout-note}
A plain note with the default title.
:::

::: {.callout-tip title="A custom title"}
A tip with its own title.
:::

::: {.callout-warning collapse="true" title="Folded warning"}
Hidden until you open it.
:::

::: {.callout-important}
### Title from a heading

A heading at the start of the callout becomes its title.
:::

::: {.callout-caution}
Take care here.
:::

## Tabsets

A `panel-tabset` div turns each heading into a tab. Use the arrow keys to move between tabs.

```markdown
::: {.panel-tabset}
### First tab

Content of the first tab.

### Second tab

Content of the second tab.
:::
```

Result:

::: {.panel-tabset}
### First tab

Content of the first tab.

### Second tab

Content of the second tab.
:::

## Columns

Columns sit side by side. Each column can have a width.

```markdown
:::: {.columns}
::: {.column width="40%"}
The narrow column.
:::

::: {.column width="60%"}
The wide column, with more room for text.
:::
::::
```

Result:

:::: {.columns}
::: {.column width="40%"}
The narrow column.
:::

::: {.column width="60%"}
The wide column, with more room for text.
:::
::::

## Shortcodes

Shortcodes are written between `{{<` and `>}}`. Writedown understands `pagebreak`, `meta`, `kbd` and `include`; any other shortcode is shown as code. An `include` of a file that does not exist shows a muted "not found" card (this guide has no folder).

```markdown
{{< kbd Cmd-S >}} saves the file. The title is {{< meta title >}}.

{{< pagebreak >}}

{{< include missing-file.qmd >}}

{{< video https://example.org/clip >}}
```

Result:

{{< kbd Cmd-S >}} saves the file. The title is {{< meta title >}}.

{{< pagebreak >}}

{{< include missing-file.qmd >}}

{{< video https://example.org/clip >}}

## Code chunks with options

A chunk starts with a language in braces, optionally followed by a label. Options go on `#|` lines at the top of the chunk, written as YAML. The R Markdown style puts options in the braces instead.

````markdown
```{r}
#| label: summary-stats
#| echo: false
#| warning: false
summary(c(2, 4, 6, 8))
```

```{python}
#| label: greet
#| eval: false
print("Hello")
```

```{r rmd-style, echo=FALSE, message=FALSE}
x <- 1:5
```
````

Result:

```{r}
#| label: summary-stats
#| echo: false
#| warning: false
summary(c(2, 4, 6, 8))
```

```{python}
#| label: greet
#| eval: false
print("Hello")
```

```{r rmd-style, echo=FALSE, message=FALSE}
x <- 1:5
```

## Inline code

Inline code that starts with the language name is a chunk too. Both the Quarto form and the R Markdown form are recognized, and neither is evaluated.

```markdown
Quarto form: `{r} 1 + 1`, `{python} 2 * 3`. R Markdown form: `r 1 + 1`.
```

Result:

Quarto form: `{r} 1 + 1`, `{python} 2 * 3`. R Markdown form: `r 1 + 1`.

## Figure chunks

A chunk with a label that starts with `fig-` and a `fig-cap` option makes a numbered figure. Because code is never run, the preview shows a placeholder where the plot would be, and the caption and number still work for cross-references.

````markdown
```{r}
#| label: fig-trend
#| fig-cap: "A trend line over time"
plot(1:10)
```

The trend is plotted in @fig-trend.
````

Result:

```{r}
#| label: fig-trend
#| fig-cap: "A trend line over time"
plot(1:10)
```

The trend is plotted in @fig-trend.

## Mermaid diagrams

A `{mermaid}` chunk draws a diagram from text. The diagram is drawn by Writedown itself, not by running code.

````markdown
```{mermaid}
flowchart LR
  A[Draft] --> B[Review]
  B --> C[Publish]
```
````

Result:

```{mermaid}
flowchart LR
  A[Draft] --> B[Review]
  B --> C[Publish]
```

## Reference list

The reference list is built from the citations above and appears under the heading named by `reference-section-title`.
