/* Re-encoder PNG truecolor (RGB/RGBA) sem perda: escolhe o melhor filtro por
   linha (Sub/Up/Average/Paeth) e usa deflate nivel 9. */
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

function encodeTruecolor(rgba, w, h, withAlpha) {
  const ch = withAlpha ? 4 : 3;
  const stride = w * ch;
  const raw = Buffer.alloc(h * (stride + 1));
  const line = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < h; y++) {
    for (let i = 0; i < stride; i++) {
      const px = rgba[(y * w + (i / ch | 0)) * 4 + (i % ch)];
      line[i] = px;
    }
    const prev = y > 0 ? raw.slice((y - 1) * (stride + 1) + 1, y * (stride + 1)) : Buffer.alloc(stride);
    let bestF = 0, bestS = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let s = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0;
        const b = prev[i];
        const c = i >= ch ? prev[i - ch] : 0;
        let v;
        if (f === 0) v = line[i];
        else if (f === 1) v = line[i] - a;
        else if (f === 2) v = line[i] - b;
        else if (f === 3) v = line[i] - ((a + b) >> 1);
        else v = line[i] - paeth(a, b, c);
        v &= 255;
        out[i] = v;
        s += v < 128 ? v : 256 - v;
      }
      if (s < bestS) { bestS = s; bestF = f; }
    }
    raw[y * (stride + 1)] = bestF;
    cand[bestF].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = withAlpha ? 6 : 2;
  const idat = zlib.deflateSync(raw, { level: 9, memLevel: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { encodeTruecolor };
