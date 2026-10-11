# Paste fixtures (synthetic)

All files here are synthetic: invented names and text, hand-built to model what each source puts
on the macOS clipboard. No real data. Expected outputs are written by hand from the paste rules,
not produced by the converter. Flavor for the expected files: GFM.

| File | Models |
| --- | --- |
| `web.html` | Safari web-page fragment: meta charset, comment, style, script, headings, strong/em, relative and absolute links, nested ul/ol, python code block, blockquote, relative img, thead table |
| `web.source-url.txt` | Page URL used to make relative links and image sources absolute |
| `web.expected.md` | Expected Markdown (lists use `- ` and `1. ` with nested items indented by the parent marker width; tables padded as mdast-util-gfm-table does by default) |
| `word.html`, `word.expected.md` | Word for Mac: namespaces, `mso-` styles, `<o:p>`, conditional comments, `MsoListParagraph` with `mso-list:l0 level1/level2`, bold/italic as tags and as spans, empty paragraphs |
| `outlook.html`, `outlook.expected.md` | Outlook for Mac email body with a link and a signature block |
| `excel.html`, `excel.tsv`, `excel.expected.md` | Excel range, 3 columns x 4 rows (header + 3), a cell with `\|`, numbers, an empty cell. HTML and TSV both give the same minimal pipe table (`\| a \| b \|`, `\| --- \| --- \|`, unpadded) |
| `ragged.tsv` | Tab text whose rows differ in column count (3, 2, 4): not a table, pasted as plain text unchanged |

Whitespace in the list indents and table padding is the one place the converter's formatting may
legitimately differ; tests may normalize runs of spaces inside lines, but not content.
