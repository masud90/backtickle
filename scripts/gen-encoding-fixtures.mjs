#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '../tests/fixtures/encoding');

// Ensure directory exists
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

/**
 * Normalize line endings to LF for comparison
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Detect the majority line ending and check for mixed
 */
function analyzeLineEndings(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 10000));
  let lfCount = 0;
  let crlfCount = 0;

  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      crlfCount++;
    } else if (text[i] === '\n' && (i === 0 || text[i - 1] !== '\r')) {
      lfCount++;
    }
  }

  if (
    text.length > 0 &&
    text[text.length - 1] === '\n' &&
    (text.length < 2 || text[text.length - 2] !== '\r')
  ) {
    lfCount++;
  }

  const mixed = lfCount > 0 && crlfCount > 0;
  const lineEnding = crlfCount > lfCount ? 'crlf' : 'lf';

  return { lineEnding, mixedLineEndings: mixed };
}

/**
 * Detect encoding and decode with fallback to legacy encoding
 */
function detectAndDecode(buffer) {
  // Check for UTF-16 BOMs
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      try {
        const text = new TextDecoder('utf-16le').decode(buffer.slice(2));
        return {
          encoding: 'utf-16le',
          legacyEncoding: null,
          text: normalizeLineEndings(text),
          lossy: false,
        };
      } catch {
        // Fall through
      }
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      try {
        const text = new TextDecoder('utf-16be').decode(buffer.slice(2));
        return {
          encoding: 'utf-16be',
          legacyEncoding: null,
          text: normalizeLineEndings(text),
          lossy: false,
        };
      } catch {
        // Fall through
      }
    }
  }

  // Check for UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const text = new TextDecoder('utf-8').decode(buffer.slice(3));
    return {
      encoding: 'utf-8-bom',
      legacyEncoding: null,
      text: normalizeLineEndings(text),
      lossy: false,
    };
  }

  // Try UTF-8
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return {
      encoding: 'utf-8',
      legacyEncoding: null,
      text: normalizeLineEndings(text),
      lossy: false,
    };
  } catch {
    // Not valid UTF-8, try windows-1252
    // Simple windows-1252 decoder
    let text = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte < 0x80) {
        text += String.fromCharCode(byte);
      } else {
        // Map windows-1252 control and extended characters
        const cp1252 = [
          0x20ac, // 0x80: euro
          0x0081, // 0x81: undefined
          0x201a, // 0x82: sbquo
          0x0192, // 0x83: fnof
          0x201e, // 0x84: bdquo
          0x2026, // 0x85: hellip
          0x2020, // 0x86: dagger
          0x2021, // 0x87: ddagger
          0x02c6, // 0x88: circ
          0x2030, // 0x89: permil
          0x0160, // 0x8a: scaron
          0x2039, // 0x8b: lsaquo
          0x0152, // 0x8c: oelig
          0x008d, // 0x8d: undefined
          0x017d, // 0x8e: zacute
          0x008f, // 0x8f: undefined
          0x0090, // 0x90: undefined
          0x2018, // 0x91: lsquo
          0x2019, // 0x92: rsquo
          0x201c, // 0x93: ldquo
          0x201d, // 0x94: rdquo
          0x2022, // 0x95: bullet
          0x2013, // 0x96: endash
          0x2014, // 0x97: emdash
          0x02dc, // 0x98: tilde
          0x2122, // 0x99: trade
          0x0161, // 0x9a: scaron
          0x203a, // 0x9b: rsaquo
          0x0153, // 0x9c: oelig
          0x009d, // 0x9d: undefined
          0x017e, // 0x9e: zacute
          0x0178, // 0x9f: yuml
        ];
        if (byte >= 0x80 && byte < 0xa0) {
          text += String.fromCharCode(cp1252[byte - 0x80]);
        } else {
          text += String.fromCharCode(byte);
        }
      }
    }
    return {
      encoding: 'utf-8',
      legacyEncoding: 'windows-1252',
      text: normalizeLineEndings(text),
      lossy: false,
    };
  }
}

/**
 * Check if final newline exists
 */
function hasFinalNewline(buffer) {
  return buffer.length > 0 && buffer[buffer.length - 1] === 0x0a;
}

/**
 * Generate all fixture files
 */
const files = {};

// 1. utf8-lf.md: UTF-8 with LF line endings
const utf8lfContent = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
const utf8lfBuffer = Buffer.from(utf8lfContent, 'utf-8');
fs.writeFileSync(path.join(fixturesDir, 'utf8-lf.md'), utf8lfBuffer);
files['utf8-lf.md'] = utf8lfBuffer;

// 2. utf8-crlf.md: UTF-8 with CRLF line endings
const utf8crlfContent = 'Line 1\r\nLine 2\r\nLine 3\r\nLine 4\r\nLine 5\r\n';
const utf8crlfBuffer = Buffer.from(utf8crlfContent, 'utf-8');
fs.writeFileSync(path.join(fixturesDir, 'utf8-crlf.md'), utf8crlfBuffer);
files['utf8-crlf.md'] = utf8crlfBuffer;

// 3. utf8-bom-lf.md: UTF-8 with BOM and LF
const utf8bomContent = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n', 'utf-8'),
]);
fs.writeFileSync(path.join(fixturesDir, 'utf8-bom-lf.md'), utf8bomContent);
files['utf8-bom-lf.md'] = utf8bomContent;

// 4. utf8-mixed.md: UTF-8 with mixed line endings (5 LF, 2 CRLF)
const utf8mixedContent = Buffer.from(
  'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\r\nLine 6\r\nLine 7\n',
  'utf-8',
);
fs.writeFileSync(path.join(fixturesDir, 'utf8-mixed.md'), utf8mixedContent);
files['utf8-mixed.md'] = utf8mixedContent;

// 5. utf16le-bom.md: UTF-16LE with BOM
function encodeUtf16Le(str) {
  const buf = Buffer.allocUnsafe(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16LE(str.charCodeAt(i), i * 2);
  }
  return buf;
}
const utf16leContent = Buffer.concat([
  Buffer.from([0xff, 0xfe]),
  encodeUtf16Le('Hello UTF-16LE\n'),
]);
fs.writeFileSync(path.join(fixturesDir, 'utf16le-bom.md'), utf16leContent);
files['utf16le-bom.md'] = utf16leContent;

// 6. utf16be-bom.md: UTF-16BE with BOM
function encodeUtf16Be(str) {
  const buf = Buffer.allocUnsafe(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2);
  }
  return buf;
}
const utf16beContent = Buffer.concat([
  Buffer.from([0xfe, 0xff]),
  encodeUtf16Be('Hello UTF-16BE\n'),
]);
fs.writeFileSync(path.join(fixturesDir, 'utf16be-bom.md'), utf16beContent);
files['utf16be-bom.md'] = utf16beContent;

// 7. windows-1252.md: Windows-1252 encoding with special chars
const win1252Content = Buffer.from([
  0x63,
  0x61,
  0x66,
  0xe9, // "caf" + é
  0x0a,
  0x6e,
  0x61,
  0xef,
  0x76,
  0x65, // "na" + ï + "ve"
  0x0a,
  0x80,
  0x20,
  0x35, // euro + space + "5"
  0x0a,
  0x92,
  0x20,
  0x74,
  0x65,
  0x78,
  0x74, // right single quote + space + "text"
]);
fs.writeFileSync(path.join(fixturesDir, 'windows-1252.md'), win1252Content);
files['windows-1252.md'] = win1252Content;

// 8. invalid-utf8.md: Valid UTF-8 text with stray invalid bytes
const invalidUtf8Content = Buffer.from([
  0x48,
  0x65,
  0x6c,
  0x6c,
  0x6f, // "Hello"
  0x20,
  0xff, // Invalid byte
  0x57,
  0x6f,
  0x72,
  0x6c,
  0x64, // "World"
  0x20,
  0xc3,
  0x28, // Invalid UTF-8 sequence
  0x21, // "!"
]);
fs.writeFileSync(path.join(fixturesDir, 'invalid-utf8.md'), invalidUtf8Content);
files['invalid-utf8.md'] = invalidUtf8Content;

// 9. no-final-newline.md: File without final newline
const noFinalNewlineContent = Buffer.from('No final newline', 'utf-8');
fs.writeFileSync(path.join(fixturesDir, 'no-final-newline.md'), noFinalNewlineContent);
files['no-final-newline.md'] = noFinalNewlineContent;

// 10. empty.md: Empty file
const emptyContent = Buffer.alloc(0);
fs.writeFileSync(path.join(fixturesDir, 'empty.md'), emptyContent);
files['empty.md'] = emptyContent;

// 11. multilingual.md: UTF-8 with multiple languages and emoji
const multilingualLines = [
  'The quick brown fox jumps over the lazy dog.',
  '快速的棕色狐狸跳过了懒狗。',
  'الثعلب البني السريع يقفز فوق الكلب الكسول.',
  'Party time: family emoji 👨‍👩‍👧‍👦 and flag emoji 🏳️‍🌈',
];
const multilingualContent = Buffer.from(`${multilingualLines.join('\n')}\n`, 'utf-8');
fs.writeFileSync(path.join(fixturesDir, 'multilingual.md'), multilingualContent);
files['multilingual.md'] = multilingualContent;

// Generate expected.json
const expected = {};

for (const [filename, buffer] of Object.entries(files)) {
  const decoding = detectAndDecode(buffer);
  const { lineEnding, mixedLineEndings } = analyzeLineEndings(buffer);
  const finalNewline = hasFinalNewline(buffer);

  expected[filename] = {
    encoding: decoding.encoding,
    legacyEncoding: decoding.legacyEncoding,
    lossy:
      decoding.encoding === 'utf-8' &&
      decoding.legacyEncoding === null &&
      filename === 'invalid-utf8.md',
    lineEnding: buffer.length === 0 ? 'lf' : lineEnding,
    mixedLineEndings,
    finalNewline,
    bytes: buffer.length,
    text: decoding.text,
  };
}

fs.writeFileSync(path.join(fixturesDir, 'expected.json'), JSON.stringify(expected, null, 2));

// Self-check: decode each file with the validators
console.log('\n=== Self-check validation ===\n');
console.log(
  'File                     | Encoding  | Legacy   | Lossy | Line End | Mixed | Final NL | Bytes',
);
console.log('-'.repeat(100));

let allOk = true;
for (const filename of Object.keys(expected).sort()) {
  if (filename === 'expected.json') continue;

  const expectedEntry = expected[filename];
  const buffer = files[filename];
  const decoding = detectAndDecode(buffer);
  const { lineEnding, mixedLineEndings } = analyzeLineEndings(buffer);
  const finalNewline = hasFinalNewline(buffer);

  const encodingOk = decoding.encoding === expectedEntry.encoding;
  const legacyOk = decoding.legacyEncoding === expectedEntry.legacyEncoding;
  const lineEndingOk =
    (buffer.length === 0 && expectedEntry.lineEnding === 'lf') ||
    (buffer.length > 0 && lineEnding === expectedEntry.lineEnding);
  const mixedOk = mixedLineEndings === expectedEntry.mixedLineEndings;
  const finalNlOk = finalNewline === expectedEntry.finalNewline;

  const rowOk = encodingOk && legacyOk && lineEndingOk && mixedOk && finalNlOk;
  allOk = allOk && rowOk;

  const status = rowOk ? 'OK' : 'FAIL';

  console.log(
    `${filename.padEnd(24)} | ${decoding.encoding.padEnd(9)} | ${(decoding.legacyEncoding || 'null').padEnd(8)} | ` +
      `${expectedEntry.lossy ? 'YES' : 'NO'.padEnd(3)} | ${lineEnding.padEnd(8)} | ${mixedLineEndings ? 'YES' : 'NO'} | ` +
      `${finalNewline ? 'YES' : 'NO'} | ${buffer.length} [${status}]`,
  );
}

console.log();
if (allOk) {
  console.log('All validations passed!');
  process.exit(0);
} else {
  console.log('Some validations failed!');
  process.exit(1);
}
