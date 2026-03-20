#!/usr/bin/env node
/**
 * Generates a 256x256 PNG icon from the pixel tree art used in the title bar.
 * Uses raw PNG encoding (no dependencies) — writes to src/main/icon.png.
 */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Original pixel tree: 21x24 canvas, 2px pixels with 1px gaps on a 3px grid
const PIXELS = [
  // Canopy — top
  { x: 9, y: 0, w: 2, h: 2, color: [110, 200, 122] },   // #6ec87a
  // Row 2
  { x: 6, y: 3, w: 2, h: 2, color: [90, 184, 104] },    // #5ab868
  { x: 9, y: 3, w: 2, h: 2, color: [90, 184, 104] },
  { x: 12, y: 3, w: 2, h: 2, color: [90, 184, 104] },
  // Row 3
  { x: 3, y: 6, w: 2, h: 2, color: [74, 170, 88] },     // #4aaa58
  { x: 6, y: 6, w: 2, h: 2, color: [74, 170, 88] },
  { x: 9, y: 6, w: 2, h: 2, color: [74, 170, 88] },
  { x: 12, y: 6, w: 2, h: 2, color: [74, 170, 88] },
  { x: 15, y: 6, w: 2, h: 2, color: [74, 170, 88] },
  // Row 4 — widest
  { x: 0, y: 9, w: 2, h: 2, color: [58, 154, 72] },     // #3a9a48
  { x: 3, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  { x: 6, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  { x: 9, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  { x: 12, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  { x: 15, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  { x: 18, y: 9, w: 2, h: 2, color: [58, 154, 72] },
  // Row 5
  { x: 3, y: 12, w: 2, h: 2, color: [58, 154, 72] },
  { x: 6, y: 12, w: 2, h: 2, color: [58, 154, 72] },
  { x: 9, y: 12, w: 2, h: 2, color: [58, 154, 72] },
  { x: 12, y: 12, w: 2, h: 2, color: [58, 154, 72] },
  { x: 15, y: 12, w: 2, h: 2, color: [58, 154, 72] },
  // Trunk
  { x: 9, y: 15, w: 2, h: 2, color: [138, 106, 74] },   // #8a6a4a
  { x: 9, y: 18, w: 2, h: 2, color: [138, 106, 74] },
  // Roots
  { x: 6, y: 21, w: 2, h: 2, color: [106, 80, 64] },    // #6a5040
  { x: 9, y: 21, w: 2, h: 2, color: [106, 80, 64] },
  { x: 12, y: 21, w: 2, h: 2, color: [106, 80, 64] },
];

const SRC_W = 20; // actual pixel extent (0..19)
const SRC_H = 23; // actual pixel extent (0..22)
const SIZE = 256;
const SCALE = Math.floor(SIZE / Math.max(SRC_W, SRC_H)); // ~10
const OFFSET_X = Math.floor((SIZE - SRC_W * SCALE) / 2);
const OFFSET_Y = Math.floor((SIZE - SRC_H * SCALE) / 2);

// Build RGBA buffer
const rgba = Buffer.alloc(SIZE * SIZE * 4, 0); // all transparent

for (const p of PIXELS) {
  for (let py = 0; py < p.h * SCALE; py++) {
    for (let px = 0; px < p.w * SCALE; px++) {
      const ix = OFFSET_X + p.x * SCALE + px;
      const iy = OFFSET_Y + p.y * SCALE + py;
      if (ix >= SIZE || iy >= SIZE) continue;
      const off = (iy * SIZE + ix) * 4;
      rgba[off] = p.color[0];
      rgba[off + 1] = p.color[1];
      rgba[off + 2] = p.color[2];
      rgba[off + 3] = 255;
    }
  }
}

// --- Encode as PNG (minimal, valid) ---
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// IDAT — filter type 0 (None) per row
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter none
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const compressed = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outPath = join(__dirname, '..', 'src', 'main', 'icon.png');
writeFileSync(outPath, png);
console.log(`Wrote ${png.length} bytes to ${outPath}`);

// Also generate a 256x256 ICO file (single PNG-compressed entry)
function generateIco(pngBuf) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: ICO
  header.writeUInt16LE(1, 4);     // 1 image

  // Directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry[0] = 0;   // width 256 = 0 in ICO format
  entry[1] = 0;   // height 256 = 0
  entry[2] = 0;   // palette
  entry[3] = 0;   // reserved
  entry.writeUInt16LE(1, 4);   // color planes
  entry.writeUInt16LE(32, 6);  // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);  // size of PNG data
  entry.writeUInt32LE(22, 12); // offset to PNG data (6 + 16 = 22)

  return Buffer.concat([header, entry, pngBuf]);
}

const icoPath = join(__dirname, '..', 'src', 'main', 'icon.ico');
writeFileSync(icoPath, generateIco(png));
console.log(`Wrote ICO to ${icoPath}`);
