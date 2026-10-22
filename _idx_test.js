/* Mede: PNG indexado (paleta 256) com FILTRO ADAPTATIVO vs original.
   Erro = distancia euclidiana RGB por pixel (0 = identico). */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { decodePNG, quantize } = require('./_pngcodec.js');

const SRC = '/tmp/pw_orig';
const OUT = '/tmp/pw_idx';

/* ---- encoder indexed com filtro adaptativo (igual ao PNG truecolor) ---- */
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
};
function encodeIndexedFiltered({ w, h, pal, idx }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
  const stride = w, bpp = 1;
  const raw = Buffer.alloc(h * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) line[i] = idx[y * stride + i];
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
  const idat = zlib.deflateSync(raw, { level: 9 });
  const tbl = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tbl[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = tbl[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function errorOf(orig, out, w, h) {
  let sum = 0, max = 0;
  for (let i = 0; i < w * h; i++) {
    const dr = orig[i * 4] - out[i * 4], dg = orig[i * 4 + 1] - out[i * 4 + 1], db = orig[i * 4 + 2] - out[i * 4 + 2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    sum += d; if (d > max) max = d;
  }
  return { mean: sum / (w * h), max };
}

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.png'));
fs.mkdirSync(OUT, { recursive: true });
let origB = 0, newB = 0, meanSum = 0, maxAll = 0;
const rows = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(SRC, f));
  const { w, h, rgba } = decodePNG(buf);
  const q = quantize(rgba, w, h, 256);
  const png = encodeIndexedFiltered({ w, h, pal: q.pal, idx: q.idx });
  const dec = decodePNG(png);
  const e = errorOf(rgba, dec.rgba, w, h);
  origB += buf.length; newB += png.length; meanSum += e.mean; maxAll = Math.max(maxAll, e.max);
  rows.push({ f, o: buf.length, n: png.length, mean: e.mean, max: e.max });
  fs.writeFileSync(path.join(OUT, f), png);
}
rows.sort((a, b) => b.o - a.o);
for (const r of rows.slice(0, 5)) console.log(`${r.f.padEnd(20)} ${(r.o / 1024).toFixed(0)}K -> ${(r.n / 1024).toFixed(0)}K  erro med ${r.mean.toFixed(2)} max ${r.max.toFixed(0)}`);
console.log('---');
console.log(`ORIGINAL ${(origB / 1024 / 1024).toFixed(2)} MB -> INDEXADO+FILTRO ${(newB / 1024 / 1024).toFixed(2)} MB  (-${(100 - newB / origB * 100).toFixed(0)}%)`);
console.log(`erro medio global ${(meanSum / files.length).toFixed(2)}  pior max ${maxAll.toFixed(0)}  (base64: ${(origB * 1.37 / 1024 / 1024).toFixed(2)} -> ${(newB * 1.37 / 1024 / 1024).toFixed(2)} MB)`);
