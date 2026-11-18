// Иконка приложения: белое сердце на коралловом фоне. PNG рисуется кодом, файлов-картинок нет.
// Отдаётся по /icon-192.png, /icon-512.png, /apple-touch-icon.png, /favicon.png
import { deflateSync } from 'node:zlib';

const cache = new Map();

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function iconPng(size) {
  if (cache.has(size)) return cache.get(size);
  const bg = [255, 107, 94];
  const SS = 3; // сглаживание 3x3
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const inHeart = (u, v) => {
    const x = (u - 0.5) * 3.8, y = -(v - 0.5) * 3.8 + 0.12;
    const a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y <= 0;
  };
  for (let py = 0; py < size; py++) {
    const row = py * (size * 3 + 1);
    raw[row] = 0;
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) if (inHeart((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++;
      const t = hit / (SS * SS);
      for (let ch = 0; ch < 3; ch++) raw[row + 1 + px * 3 + ch] = Math.round(bg[ch] + (255 - bg[ch]) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  cache.set(size, png);
  return png;
}
