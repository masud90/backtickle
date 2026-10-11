<!-- Fixture for phase2 XSS: Obsidian attacks -->

## Wikilink with JavaScript

[[javascript:window.__XSS_SENTINEL__ = true]]

## Embed with XSS

![[x" onerror="window.__XSS_SENTINEL__ = true]]

## Callout with Image XSS

> [!note] <img src=x onerror=window.__XSS_SENTINEL__ = true>
> Content here

## Tag with Script

#<script>window.__XSS_SENTINEL__ = true</script>
