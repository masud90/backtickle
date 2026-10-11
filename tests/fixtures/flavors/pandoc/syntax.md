<!-- Fixture for Pandoc syntax: all extended features -->

## Definition Lists

Term One
: This is the definition of the first term.

Term Two
: This is the first definition of term two.
: This is the second definition of term two.

## Superscript and Subscript

The formula is H^2^O and also CO~2~.

## Strikeout

This is ~~struck through~~ text.

## Abbreviations

The HTML specification is maintained by the W3C.

*[HTML]: Hyper Text Markup Language
*[W3C]: World Wide Web Consortium

## Line Blocks

| The first line of poetry
| And the second line continues here
| A third line for the verse

## Fancy Lists

#. First item with custom numbering
a) Second item with letter style
iv. Third item with roman numerals
(A) Fourth item with capital letters

## Example Lists

(@) First example item.

(@good) This is a good example.

Later we reference the earlier example (@good).

## Footnotes

This has an inline footnote^[An inline note with markdown.] and a regular footnote.^[And a regular footnote here.]

## Smart Punctuation

He said, "Quotes like these are smart." And 'single quotes' too. Dashes like this -- and this --- matter. Also ellipses...

## Attributes on Heading

## Custom Heading {#custom-id .doc-class}

## Attributes on Image

![Example image](img.png){width=50%}

## Attributes on Span

Small text in [small caps]{.smallcaps} is here.

## Fenced Divs

::: {.note #box}
This is content inside a fenced div.

:::: {.inner}
And this is content inside a nested div.
::::
:::

## Application Classes

::: {.callout .task-checkbox .wd-block}
This div tries application-specific classes.
:::

## Raw Blocks

``` {=html}
<b>Bold text with onclick="alert('test')"</b>
```

``` {=latex}
\emph{Emphasis in LaTeX}
```

## CriticMarkup

This {++is an addition++} {~~is not~~} [>comment<]{>>to the text<<} text with {==highlighting==} across the paragraph.

## Code Block

``` {.python #code-id}
def hello():
    print("Hello, world!")
```
