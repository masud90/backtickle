---
title: Markdown Guide
tags: [markdown, gfm, reference]
version: 1.0.0
author: Backtickle
---

# Markdown Guide

This guide shows you the Markdown syntax supported by Backtickle for GitHub Flavored Markdown (GFM). Each feature has one section: a short description, the Markdown source in a code block, and the rendered result directly below it.

## Headings

Six heading levels are available. The source shows all six; the rendered result shows levels 3 to 6 only, so the outline of this guide stays intact.

```markdown
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

Result:

### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

## Paragraphs and text formatting

Use asterisks for emphasis, tildes for strikethrough and backticks for inline code.

```markdown
This is a simple paragraph with *italic text*, **bold text**, and ***bold italic text***.
You can also use ~~strikethrough~~ and `inline code`.
```

Result:

This is a simple paragraph with *italic text*, **bold text**, and ***bold italic text***.
You can also use ~~strikethrough~~ and `inline code`.

## Links

Links can be inline, point to a heading in the same document, or be written as bare autolinks.

```markdown
[External link to example.org](https://example.org)
[Link to a heading](#headings)
<https://example.org>
```

Result:

[External link to example.org](https://example.org)
[Link to a heading](#headings)
<https://example.org>

## Images

Images use the link syntax with a leading exclamation mark. This one is a small PNG embedded as a data URI.

```markdown
![Sample PNG](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNImXYCK2IYWhIA3E1wgc0lMTEAAAAASUVORK5CYII=)
```

Result:

![Sample PNG](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGNImXYCK2IYWhIA3E1wgc0lMTEAAAAASUVORK5CYII=)

## Blockquotes

Start a line with a greater-than sign to quote it. Quotes can be nested.

```markdown
> This is a blockquote.
>
> > This is a nested blockquote.
> > It can have multiple lines.
```

Result:

> This is a blockquote.
>
> > This is a nested blockquote.
> > It can have multiple lines.

## GitHub Alerts

Five alert types are supported: note, tip, important, warning and caution.

```markdown
> [!NOTE]
> Highlights information that users should take into account.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]
> Crucial information necessary for users to succeed.

> [!WARNING]
> Critical content demanding immediate user attention.

> [!CAUTION]
> Negative potential consequences of an action.
```

Result:

> [!NOTE]
> Highlights information that users should take into account.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]
> Crucial information necessary for users to succeed.

> [!WARNING]
> Critical content demanding immediate user attention.

> [!CAUTION]
> Negative potential consequences of an action.

## Lists

Unordered and ordered lists can be nested by indenting.

```markdown
- Unordered list item 1
- Unordered list item 2
  - Nested item 1
  - Nested item 2
- Unordered list item 3

1. Ordered list item 1
2. Ordered list item 2
   1. Nested ordered item 1
   2. Nested ordered item 2
3. Ordered list item 3
```

Result:

- Unordered list item 1
- Unordered list item 2
  - Nested item 1
  - Nested item 2
- Unordered list item 3

1. Ordered list item 1
2. Ordered list item 2
   1. Nested ordered item 1
   2. Nested ordered item 2
3. Ordered list item 3

## Task lists

A list item that starts with a bracket pair becomes a checkbox.

```markdown
- [x] Completed task
- [ ] Incomplete task
- [x] Another completed task
  - [ ] Nested incomplete task
  - [x] Nested completed task
```

Result:

- [x] Completed task
- [ ] Incomplete task
- [x] Another completed task
  - [ ] Nested incomplete task
  - [x] Nested completed task

## Tables

Colons in the separator row set the column alignment.

```markdown
| Left aligned | Center aligned | Right aligned |
| :----------- | :------------: | ------------: |
| L1           | C1             | R1            |
| L2           | C2             | R2            |
```

Result:

| Left aligned | Center aligned | Right aligned |
| :----------- | :------------: | ------------: |
| L1           | C1             | R1            |
| L2           | C2             | R2            |

## Code blocks

Fence code with three backticks and name the language after the opening fence for highlighting. The source below uses four backticks so the inner fences show literally.

````markdown
```typescript
const greeting: string = "Hello, world!";
console.log(greeting);
```

```python
def greet(name):
    print(f"Hello, {name}!")
```

```r
data <- read.csv("file.csv")
summary(data)
```

```sql
SELECT name, email FROM users WHERE active = true;
```

```bash
echo "Hello from bash"
ls -la /home
```

```
Plain text code block without a language.
```
````

Result:

```typescript
const greeting: string = "Hello, world!";
console.log(greeting);
```

```python
def greet(name):
    print(f"Hello, {name}!")
```

```r
data <- read.csv("file.csv")
summary(data)
```

```sql
SELECT name, email FROM users WHERE active = true;
```

```bash
echo "Hello from bash"
ls -la /home
```

```
Plain text code block without a language.
```

## Indented code block

Four spaces of indentation also make a code block.

```markdown
    function example() {
        return "indented code";
    }
```

Result:

    function example() {
        return "indented code";
    }

## Math

Use single dollar signs for inline math, double dollar signs for display math, and a `math` fence for a multi-line block.

````markdown
Inline math: $E = mc^2$

Display math:

$$\int_0^1 x^2\,dx = \frac{1}{3}$$

Math block:

```math
\begin{align}
a^2 + b^2 &= c^2 \\
\sin^2\theta + \cos^2\theta &= 1
\end{align}
```
````

Result:

Inline math: $E = mc^2$

Display math:

$$\int_0^1 x^2\,dx = \frac{1}{3}$$

Math block:

```math
\begin{align}
a^2 + b^2 &= c^2 \\
\sin^2\theta + \cos^2\theta &= 1
\end{align}
```

## Emoji

Emoji shortcodes are replaced by the matching character.

```markdown
You can use emoji shortcodes like :tada: and :rocket: in your Markdown.
```

Result:

You can use emoji shortcodes like :tada: and :rocket: in your Markdown.

## Footnotes

A footnote reference points to a definition, which is collected at the end of the document.

```markdown
This is a statement with a footnote[^1].

Here is another footnote reference[^2].

[^1]: This is the first footnote content.
[^2]: This is the second footnote content with more detail.
```

Result:

This is a statement with a footnote[^1].

Here is another footnote reference[^2].

[^1]: This is the first footnote content.
[^2]: This is the second footnote content with more detail.

## Horizontal rule

Three hyphens on their own line draw a rule.

```markdown
---
```

Result:

---

## Raw HTML

Safe HTML elements are allowed and rendered. Scripts and event handlers are removed.

```markdown
<details>
<summary>Click to expand</summary>
This is hidden content that can be expanded.
</details>
```

Result:

<details>
<summary>Click to expand</summary>
This is hidden content that can be expanded.
</details>

## Line breaks

End a line with two spaces or a backslash to force a line break.

```markdown
This line has two trailing spaces at the end  
and continues on the next line.

This line uses a backslash\
and also continues on the next line.
```

Result:

This line has two trailing spaces at the end  
and continues on the next line.

This line uses a backslash\
and also continues on the next line.
