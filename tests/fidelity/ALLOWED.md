# Allowed differences from Pandoc 3.8.3 and Quarto 1.9.38

One line per difference: `- id | scope | reason`. `fidelity.test.ts` has one rule per id and checks that both lists match. Anything not listed here fails.

- missing-key | pandoc/citations* | a key that is not in the bibliography prints `(@key?)`; Pandoc prints `(key?)`
- mmd-citation | pandoc/citations* | the MultiMarkdown form `[#key]` is a citation here and plain text in Pandoc
- abbreviations | pandoc/syntax.md, guides | abbreviation definitions `*[HTML]: ...` have no Pandoc counterpart; Pandoc keeps them as paragraphs
- criticmarkup | pandoc/syntax.md, guides | CriticMarkup spans have no Pandoc counterpart; Pandoc keeps the markers as text
- mmd-caption | pandoc/tables.md | the MMD `[caption]` line is a table caption here and a paragraph in Pandoc
- author-map | pandoc/title-yaml.md | authors given as maps (name and affiliation): Pandoc's default template prints `true`, Backtickle prints the name
- references-heading | quarto/* | Quarto adds an `h2 References` above the bibliography; Backtickle does not
- chunks-not-run | quarto/chunks.qmd, guide/quarto.md | nothing is executed: Quarto shows a chunk as plain text, Backtickle as a card; chunk figures have no caption in Quarto
- bookdown-not-knitted | quarto/bookdown.Rmd | bookdown resolves `\@ref()` only after knitr and the bookdown format ran; Quarto with the markdown engine leaves them as text
- quarto-shortcode-in-code | guide/quarto.md | Quarto 1.9.38 treats a `{{<` inside inline code as a shortcode and garbles the paragraph
- video-shortcode | guide/quarto.md, quarto/shortcodes.qmd | the `{{< video >}}` shortcode stays as literal text: the preview loads no external media; Quarto renders a video player
