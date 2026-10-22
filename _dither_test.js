/* Compara estrategias de compressao das figurinhas: tamanho x qualidade.
   - A: PNG indexado (paleta 256) com dithering Floyd-Steinberg
   - B: PNG truecolor lossless com filtro adaptativo por linha
   Mede erro medio/maximo (distancia euclidiana RGB) contra o original. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decodePNG, encodeIndexed, quantize } = require('./_pngcodec.js');

const SRC = '/tmp/pw_orig';

/* ---------- estrategia A: paleta + dithering ---------- */
function dither(rgba, w, h, pal) {
  const idx = new Uint8Array(w * h);
  const work = Buffer.from(rgba);
  const find = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let c = 0; c < pal.length; c++) {
      const dr = r - pal[c][0], dg = g - pal[c][1], db = b - pal[c][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const r = work[o], g = work[o + 1], b = work[o + 2];
      const c = find(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)));
      idx[i] = c;
      const er = r - pal[c][0], eg = g - pal[c][1], eb = b - pal[c][2];
      const push = (xx, yy, f) => {
        if (xx < 0 || xx >= w || yy >= h) return;
        const p = (yy * w + xx) * 4;
        work[p] = Math.max(0, Math.min(255, work[p] + er * f));
        work[p + 1] = Math.max(0, Math.min(255, work[p + 1] + eg * f));
        work[p + 2] = Math.max(0, Math.min(255, work[p + 2] + eb * f));
      };
      push(x + 1, y, 7 / 16); push(x - 1, y + 1, 3 / 16); push(x, y + 1, 5 / 16); push(x + 1, y + 1, 1 / 16);
    }
  }
  return idx;
}

/* ---------- estrategia B: truecolor com filtro adaptativo ---------- */
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
};
function encodeTruecolor(rgba, w, h) {
  const bpp = 3, stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) line[i] = rgba[y * stride + i];
    const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      cand[0][i] = line[i];
      cand[1][i] = (line[i] - a) & 255;
      cand[2][i] = (line[i] - b) & 255;
      cand[3][i] = (line[i] - ((a + b) >> 1)) & 255;
      cand[4][i] = (line[i] - paeth(a, b, c)) & 255;
    }
    let best = 0, bs = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let i = 0; i < stride; i++) { const v = cand[f][i]; s += v < 128 ? v : 256 - v; }
      if (s < bs) { bs = s; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    prev.set(line);
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- erro ---------- */
function errorOf(orig, out, w, h) {
  let sum = 0, max = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    const dr = orig[i * 4] - out[i * 4], dg = orig[i * 4 + 1] - out[i * 4 + 1], db = orig[i * 4 + 2] - out[i * 4 + 2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    sum += d; if (d > max) max = d; n++;
  }
  return { mean: sum / n, max };
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.png'));
const sample = process.argv[2] ? files.filter(f => process.argv[2].split(',').includes(f)) : files;
let aBytes = 0, bBytes = 0, origBytes = 0, aSum = 0, aMax = 0, bSum = 0, bMax = 0;
for (const f of sample) {
  const buf = fs.readFileSync(path.join(SRC, f));
  const { w, h, rgba } = decodePNG(buf);
  origBytes += buf.length;
  // A: paleta 256 + dithering
  const q = quantize(rgba, w, h, 256);
  const idxA = dither(rgba, w, h, q.pal);
  const aPng = encodeIndexed({ w, h, pal: q.pal, idx: idxA });
  const decA = decodePNG(aPng);
  const eA = errorOf(rgba, decA.rgba, w, h);
  // B: truecolor lossless com filtro adaptativo
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  const bPng = encodeTruecolor(rgb, w, h);
  aBytes += aPng.length; bBytes += bPng.length; aSum += eA.mean; aMax = Math.max(aMax, eA.max);
  bSum += 0; bMax = Math.max(bMax, 0);
  console.log(`${f.padEnd(22)} orig ${(buf.length / 1024).toFixed(0)}K | A(paleta+dither) ${(aPng.length / 1024).toFixed(0)}K erro med ${eA.mean.toFixed(2)} max ${eA.max.toFixed(0)} | B(lossless) ${(bPng.length / 1024).toFixed(0)}K`);
}
const n = sample.length;
console.log('---');
console.log(`ORIGINAL   ${(origBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`A paleta   ${(aBytes / 1024 / 1024).toFixed(2)} MB  (-${(100 - aBytes / origBytes * 100).toFixed(0)}%)  erro medio ${(aSum / n).toFixed(2)}  pior max ${aMax.toFixed(0)}`);
console.log(`B lossless ${(bBytes / 1024 / 1024).toFixed(2)} MB  (-${(100 - bBytes / origBytes * 100).toFixed(0)}%)  erro 0`);
