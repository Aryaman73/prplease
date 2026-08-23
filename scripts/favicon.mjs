/**
 * prplease — favicon artwork and encoder.
 *
 * The mark is the maple leaf from the ministry's crest (src/crest.ts), drawn on
 * its own at icon size. The crest entire — wings, leaf, plinth, 21 cells wide —
 * collapses into mush at 16px, so the leaf carries the mark alone and keeps the
 * same drawing language: whole cells, hard edges, no anti-aliasing anywhere.
 *
 * Parchment field, stamp-red leaf. That pairing is the interface's own subject
 * matter — a stamp struck on a document — and it means the icon is a bright
 * square at any tab size, legible against light and dark browser chrome alike.
 * The booth palette would give a dark tile that disappears into dark chrome.
 *
 * Zero dependencies: the PNG and ICO encoders below are a few dozen lines each
 * and this repo does not take a dependency on an image toolchain to draw one
 * 16x16 sprite. Run `npm run favicon` after editing SPRITE.
 *
 * Emits public/favicon.svg, public/favicon.ico and public/apple-touch-icon.png.
 */

import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/**
 * The artwork. Edit it as the picture it is — this is the drawing, not data.
 *
 * Every spike meets the body at a corner rather than floating clear of it. A
 * one-cell gap reads as a leaf point at 16x magnification and as dust at 16px,
 * which is the size that actually ships.
 */
const SPRITE = [
  '................',
  '.......##.......',
  '.......##.......',
  '......####......',
  '..#...####...#..',
  '...##########...',
  '..############..',
  '.#.##########.#.',
  '..############..',
  '...##########...',
  '....########....',
  '...#..####..#...',
  '......####......',
  '.......##.......',
  '.......##.......',
  '................',
];

/** Square by construction; both encoders below assume it. */
const SIZE = SPRITE.length;

const FIELD = '#d7cdb8'; // --paper
const LEAF = '#97281f'; // --stamp-red

// ---------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** RGBA pixels -> PNG. Filter 0 on every scanline: flat colour deflates fine. */
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * PNG-in-ICO. Every browser still shipping cares about ICO understands the PNG
 * form, and it saves writing a second (BMP, bottom-up, with an AND mask) codec.
 */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size < 256 ? size : 0; // 0 means 256
    entry[1] = size < 256 ? size : 0;
    entry[2] = 0; // palette size: not palettised
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ---------------------------------------------------------------------------
// Rasterising
// ---------------------------------------------------------------------------

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/**
 * Nearest-neighbour blow-up of the sprite. `scale` must be a whole number —
 * a fractional one resamples the cells unevenly and one row of the leaf comes
 * out a pixel thicker than its mirror. `pad` frames the result in field colour
 * so a target size that is not a multiple of SIZE (180, for Apple) still lands
 * on whole cells.
 */
function raster(scale, pad = 0) {
  const size = SIZE * scale + pad * 2;
  const rgba = new Uint8Array(size * size * 4);
  const field = rgb(FIELD);
  const leaf = rgb(LEAF);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - pad) / scale);
      const cy = Math.floor((y - pad) / scale);
      const inside = cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE;
      const colour = inside && SPRITE[cy][cx] === '#' ? leaf : field;
      const i = (y * size + x) * 4;
      rgba[i] = colour[0];
      rgba[i + 1] = colour[1];
      rgba[i + 2] = colour[2];
      rgba[i + 3] = 255;
    }
  }
  return { size, rgba };
}

/**
 * The SVG is the primary icon: one file, every size, and it stays crisp on the
 * displays a 32px raster does not reach. One rect per horizontal run of cells,
 * as in the crest — same picture, roughly a fifth of the nodes.
 */
function buildSvg() {
  const rects = [];
  SPRITE.forEach((row, y) => {
    let x = 0;
    while (x < SIZE) {
      if (row[x] !== '#') {
        x++;
        continue;
      }
      let end = x;
      while (end < SIZE && row[end] === '#') end++;
      rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1"/>`);
      x = end;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">
<title>PR, Please</title>
<rect width="${SIZE}" height="${SIZE}" fill="${FIELD}"/>
<g fill="${LEAF}">
${rects.join('\n')}
</g>
</svg>
`;
}

const ico = encodeIco(
  [1, 2].map((scale) => {
    const { size, rgba } = raster(scale);
    return { size, png: encodePng(size, rgba) };
  }),
);

// 180 is Apple's size and is not a multiple of 16, so draw 11 cells to the
// side (176) and frame the remainder in field colour.
const apple = raster(11, 2);

await Promise.all([
  writeFile(join(OUT_DIR, 'favicon.svg'), buildSvg()),
  writeFile(join(OUT_DIR, 'favicon.ico'), ico),
  writeFile(join(OUT_DIR, 'apple-touch-icon.png'), encodePng(apple.size, apple.rgba)),
]);

console.log(`favicon: wrote favicon.svg, favicon.ico (16, 32), apple-touch-icon.png (${apple.size})`);
