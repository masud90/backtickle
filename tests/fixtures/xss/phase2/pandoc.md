<!-- Fixture for phase2 XSS: Pandoc attacks -->

## Raw HTML with Script

``` ```{=html}
<script>
window.__XSS_SENTINEL__ = true
</script>
```

## SVG with onload

``` ```{=html}
<svg onload="window.__XSS_SENTINEL__ = true">
</svg>
```

## Form Elements

``` ```{=html}
<form>
  <input />
</form>
<iframe>
</iframe>
```

## Span with onclick

[x]{onclick="window.__XSS_SENTINEL__ = true"}

## Link with JavaScript Protocol

[x](javascript:window.__XSS_SENTINEL__ = true){.doc}

## Image with Style Attribute

![alt](image.png){style="background: url(javascript:window.__XSS_SENTINEL__ = true)"}
