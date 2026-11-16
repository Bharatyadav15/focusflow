const fs = require('fs');
const zlib = require('zlib');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function renderIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const R = size * 0.46;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      const nx = Math.abs(dx) / R;
      const ny = Math.abs(dy) / R;
      const sqDist = Math.pow(Math.pow(nx, 4) + Math.pow(ny, 4), 0.25);

      if (sqDist > 1.03) {
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }

      const edgeAlpha =
        sqDist > 0.97 ? Math.max(0, Math.min(1, (1.03 - sqDist) / 0.06)) : 1;

      const t = (x + y) / (2 * size);
      let r = Math.round(109 * (1 - t) + 55 * t);
      let g = Math.round(112 * (1 - t) + 48 * t);
      let b = Math.round(248 * (1 - t) + 198 * t);

      const rNorm = dist / R;
      const ringDist = Math.abs(rNorm - 0.65);
      const ringHalf = 0.095;
      if (ringDist < ringHalf + 0.04) {
        const ringAlpha = Math.max(
          0,
          Math.min(1, (ringHalf + 0.04 - ringDist) / 0.04)
        );
        const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
        const isArc = angle < Math.PI * 1.65;
        const tr = isArc ? 255 : 199;
        const tg = isArc ? 255 : 210;
        const tb = isArc ? 255 : 254;
        const w = ringAlpha * (isArc ? 0.98 : 0.35);
        r = Math.round(r * (1 - w) + tr * w);
        g = Math.round(g * (1 - w) + tg * w);
        b = Math.round(b * (1 - w) + tb * w);
      }

      const inCenterDot = rNorm < 0.17;
      const inHand = Math.abs(dx) < R * 0.075 && dy < 0 && dy > -R * 0.42;
      if (inCenterDot || inHand) {
        r = 255;
        g = 255;
        b = 255;
      }

      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = Math.round(edgeAlpha * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  for (let i = 0; i < count; i++) {
    const s = sizes[i];
    const buf = pngBuffers[i];
    const entryOffset = 6 + i * 16;
    header[entryOffset] = s >= 256 ? 0 : s;
    header[entryOffset + 1] = s >= 256 ? 0 : s;
    header[entryOffset + 2] = 0;
    header[entryOffset + 3] = 0;
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(buf.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += buf.length;
  }
  return Buffer.concat([header, ...pngBuffers]);
}

fs.mkdirSync('assets', { recursive: true });
fs.mkdirSync('public', { recursive: true });

const png256 = renderIconPng(256);
const png64 = renderIconPng(64);
const png32 = renderIconPng(32);
const png16 = renderIconPng(16);

fs.writeFileSync('assets/icon.png', png256);
fs.writeFileSync('assets/tray.png', png32);
fs.writeFileSync(
  'assets/icon.ico',
  buildIco([png256, png64, png32, png16], [256, 64, 32, 16])
);
fs.writeFileSync('public/icon.png', png64);
console.log('Generated assets/icon.ico, assets/icon.png, assets/tray.png, and public/icon.png');
