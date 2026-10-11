# CommonMark Specification Examples

The CommonMark specification examples are read from the official CommonMark npm package at test time. The package is not bundled into the repository.

## Source

- Package: `commonmark-spec`
- Version: 0.31.2
- Source: https://commonmark.org/
- License: CC BY-SA 4.0

## About CommonMark

CommonMark is a standardized, unambiguous syntax specification for Markdown. The 0.31.2 version includes 652 test examples that cover the complete specification.

## Test data

Test examples are accessed from the installed `commonmark-spec` npm package via `require('commonmark-spec').tests`, which returns an array of 652 examples. Each example specifies the Markdown source, expected HTML output, section, and example number.
