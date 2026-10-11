---
title: English Test
version: 1.0.0
---

# Document Title

This is a paragraph with *italic* and **bold** text. It also has `inline code`.

<!-- HTML comment should be excluded -->

Here is <span>inline HTML</span> to test.

```python
# This code block is excluded
print("code should not count")
```

A [link to example](https://example.org) with text counted.

![Alt text excluded](image.png)

| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |

- [x] Task item one
- [ ] Task item two

Inline math excluded: $E = mc^2$ in text.

Display math follows:

$$
x = y
$$

A footnote reference[^1].

## Section

More content with soft  
breaks that become spaces.

[^1]: Footnote text counted here.
