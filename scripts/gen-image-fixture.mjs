#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
const args = process.argv.slice(2);
let width = 64;
let height = 40;
let outputPath = path.join(__dirname, '../tests/fixtures/links/images/sample.png');
let outputBase64 = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--size' && i + 1 < args.length) {
    const [w, h] = args[i + 1].split('x').map(Number);
    width = w;
    height = h;
    i++;
  }
  if (args[i] === '--base64') {
    outputBase64 = true;
  }
  if (args[i] === '--output' && i + 1 < args.length) {
    outputPath = args[i + 1];
    i++;
  }
}

// PNG signature
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const bitDepth = 8;
const colorType = 2; // RGB

/**
 * Calculate CRC32 checksum with unsigned shift
 */
function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = crc ^ data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0; // Unsigned 32-bit integer
}

/**
 * Create IHDR chunk
 */
function createIHDR(w, h) {
  const data = Buffer.allocUnsafe(13);
  data.writeUInt32BE(w, 0);
  data.writeUInt32BE(h, 4);
  data[8] = bitDepth;
  data[9] = colorType;
  data[10] = 0; // compression method
  data[11] = 0; // filter method
  data[12] = 0; // interlace method
  return data;
}

/**
 * Create a PNG chunk
 */
function createChunk(type, data) {
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

/**
 * Generate gradient pixel data
 */
function generatePixelData() {
  const lines = [];

  for (let y = 0; y < height; y++) {
    // Filter byte (0 = no filter)
    const line = [0];

    for (let x = 0; x < width; x++) {
      // Create a gradient from left to right
      const r = Math.floor((x / width) * 255);
      const g = Math.floor((y / height) * 255);
      const b = 128;

      line.push(r);
      line.push(g);
      line.push(b);
    }

    lines.push(Buffer.from(line));
  }

  return Buffer.concat(lines);
}

// Create IHDR chunk
const ihdr = createIHDR(width, height);
const ihdrChunk = createChunk('IHDR', ihdr);

// Generate and compress pixel data
const pixelData = generatePixelData();
const compressed = zlib.deflateSync(pixelData);
const idatChunk = createChunk('IDAT', compressed);

// Create IEND chunk
const iendChunk = createChunk('IEND', Buffer.alloc(0));

// Combine all chunks
const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);

if (outputBase64) {
  // Output as base64 data URI
  const base64 = png.toString('base64');
  const dataUri = `data:image/png;base64,${base64}`;
  console.log(dataUri);
} else {
  // Write PNG file
  fs.writeFileSync(outputPath, png);

  console.log(`Generated PNG: ${outputPath}`);
  console.log(`Dimensions: ${width}x${height}`);
  console.log(`File size: ${png.length} bytes`);

  // Verify PNG signature
  if (png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47) {
    console.log('PNG signature: OK');
  } else {
    console.error('PNG signature: FAILED');
    process.exit(1);
  }
}
