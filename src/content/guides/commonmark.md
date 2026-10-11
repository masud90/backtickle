# CommonMark Guide

CommonMark is a strict, well-defined specification for Markdown. It focuses on the core features of Markdown without the extensions that some flavors like GitHub Flavored Markdown add. This guide shows CommonMark syntax.

## About CommonMark

CommonMark is the standard Markdown specification. GitHub Flavored Markdown (GFM) adds useful extensions like tables, task lists, and strikethrough, but CommonMark represents the common core that all Markdown flavors share.

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

### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

## Paragraphs and text formatting

```markdown
This is a simple paragraph with *italic text* and **bold text**.
You can also use ***bold italic text***.
You can include `inline code` in your text.
```

This is a simple paragraph with *italic text* and **bold text**.
You can also use ***bold italic text***.
You can include `inline code` in your text.

## Links

```markdown
[External link to example.org](https://example.org)
[Link to a heading](#headings)
```

[External link to example.org](https://example.org)
[Link to a heading](#headings)

## Images

```markdown
![Sample inline SVG](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2040%22%3E%3Crect%20width%3D%2264%22%20height%3D%2240%22%20fill%3D%22%23e8f5e9%22/%3E%3Crect%20width%3D%2232%22%20height%3D%2240%22%20fill%3D%22%234caf50%22/%3E%3C/svg%3E)
```

![Sample inline SVG](data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2064%2040%22%3E%3Crect%20width%3D%2264%22%20height%3D%2240%22%20fill%3D%22%23e8f5e9%22/%3E%3Crect%20width%3D%2232%22%20height%3D%2240%22%20fill%3D%22%234caf50%22/%3E%3C/svg%3E)

## Blockquotes

```markdown
> This is a blockquote.
>
> > This is a nested blockquote.
> > It can have multiple lines.
```

> This is a blockquote.
>
> > This is a nested blockquote.
> > It can have multiple lines.

## Unordered lists

```markdown
- Unordered list item 1
- Unordered list item 2
  - Nested item 1
  - Nested item 2
- Unordered list item 3
```

- Unordered list item 1
- Unordered list item 2
  - Nested item 1
  - Nested item 2
- Unordered list item 3

## Ordered lists

```markdown
1. Ordered list item 1
2. Ordered list item 2
   1. Nested ordered item 1
   2. Nested ordered item 2
3. Ordered list item 3
```

1. Ordered list item 1
2. Ordered list item 2
   1. Nested ordered item 1
   2. Nested ordered item 2
3. Ordered list item 3

## Code blocks

```markdown
\`\`\`
function example() {
    return "code block";
}
\`\`\`

\`\`\`typescript
const greeting: string = "Hello, world!";
console.log(greeting);
\`\`\`

\`\`\`python
def greet(name):
    print(f"Hello, {name}!")
\`\`\`
```

```
function example() {
    return "code block";
}
```

```typescript
const greeting: string = "Hello, world!";
console.log(greeting);
```

```python
def greet(name):
    print(f"Hello, {name}!")
```

## Indented code block

```markdown
    function example() {
        return "indented code";
    }
```

    function example() {
        return "indented code";
    }

## Horizontal rule

```markdown
---
```

---

## Raw HTML

```markdown
<details>
<summary>Click to expand</summary>
This is hidden content that can be expanded.
</details>
```

<details>
<summary>Click to expand</summary>
This is hidden content that can be expanded.
</details>

## Line breaks

```markdown
This line has two trailing spaces at the end  
and continues on the next line.

This line uses a backslash\
and also continues on the next line.
```

This line has two trailing spaces at the end
and continues on the next line.

This line uses a backslash\
and also continues on the next line.
