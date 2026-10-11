# XSS Test Corpus

This folder contains test fixtures for verifying that the HTML sanitizer properly removes malicious content.

## Sanitization requirements

The following must not survive the sanitizer:

- No `<script>` elements (any case, any attributes)
- No `on*` event handler attributes (onclick, onerror, onload, onmouseover, ontoggle, etc.)
- No `javascript:`, `vbscript:`, or `data:text/html` URLs (including entity-encoded variants)
- No `<iframe>` elements
- No `<object>` elements
- No `<embed>` elements
- No `<form>` elements
- No `<input>` elements (except our task list checkbox spans)
- No `<button>` elements
- No `<textarea>` elements
- No `<select>` elements
- No `<style>` elements
- No `style` attributes (inline styles)
- No `<meta>` elements (including http-equiv)
- No `<base>` elements
- No `<link>` elements
- No `<template>` elements
- No `<dialog>` elements
