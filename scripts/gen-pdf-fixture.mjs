#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '../tests/fixtures/links/files/report.pdf');

// Ensure directory exists
if (!fs.existsSync(path.dirname(outputPath))) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
}

// Build PDF objects
const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
const obj3 =
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n';
const obj4 = '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
const obj5 =
  '5 0 obj\n<< /Length 44 >>\nstream\nBT\n/F1 12 Tf\n50 750 Td\n(Test PDF) Tj\nET\nendstream\nendobj\n';

// Build full document with header
const header = '%PDF-1.4\n';
const objects = [obj1, obj2, obj3, obj4, obj5];

// Calculate offsets: we need byte positions of each '1 0 obj', '2 0 obj', etc.
let fullDoc = header;
const offsets = [0, 0, 0, 0, 0, 0]; // obj 0 is unused

let bytePos = header.length;
for (let i = 0; i < objects.length; i++) {
  offsets[i + 1] = bytePos;
  bytePos += objects[i].length;
}

fullDoc += objects.join('');

// Build xref table
let xref = 'xref\n';
xref += '0 6\n';
xref += '0000000000 65535 f \n';

for (let i = 1; i <= 5; i++) {
  const offset = String(offsets[i]).padStart(10, '0');
  xref += offset + ' 00000 n \n';
}

// Calculate xref offset
const xrefOffset = fullDoc.length;

// Build trailer
const trailer = 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

// Combine all parts
const finalPdf = fullDoc + xref + trailer;
fs.writeFileSync(outputPath, finalPdf);

console.log(`Generated PDF: ${outputPath}`);
console.log(`File size: ${finalPdf.length} bytes`);
console.log(`Offsets: ${offsets.slice(1).join(', ')}`);
console.log(`Xref offset: ${xrefOffset}`);
