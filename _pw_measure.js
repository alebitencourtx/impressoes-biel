// Mede quanto da figurinha Patchwork é realmente arte (bicho) vs fundo branco.
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, ct = 6, bd = 8, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, y * stride + stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, ct, data: out };
}

// cor do fundo = moda das bordas (4 cantos + meio das bordas)
function bgColor(img) {
  const { w, h, ch, data } = img;
  const samples = [];
  const push = (x, y) => { const o = (y * w + x) * ch; samples.push([data[o], data[o + 1], data[o + 2]]); };
  [0, 1, 2, 3].forEach(i => { push(i, 0); push(i, h - 1); push(0, i); push(w - 1, i); });
  push(w >> 1, 0); push(w >> 1, h - 1); push(0, h >> 1); push(w - 1, h >> 1);
  const key = (c) => c.join(',');
  const count = new Map();
  samples.forEach(c => count.set(key(c), (count.get(key(c)) || 0) + 1));
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return best.split(',').map(Number);
}

function artBBox(img, tol) {
  const { w, h, ch, data } = img;
  const bg = bgColor(img);
  let x0 = w, x1 = -1, y0 = h, y1 = -1, art = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      const dr = Math.abs(data[o] - bg[0]), dg = Math.abs(data[o + 1] - bg[1]), db = Math.abs(data[o + 2] - bg[2]);
      if (dr > tol || dg > tol || db > tol) {
        art++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, x1, y0, y1, art, total: w * h };
}

const src = fs.readFileSync('index.html', 'utf8');
const names = [...src.matchAll(/"([\w\-]+\.png)":"data:image\/png;base64,([A-Za-z0-9+/=]+)"/g)];
console.log('figurinhas:', names.length);
let sum = 0, n = 0, minC = 1, maxC = 0;
const rows = [];
for (const [, name, b64] of names) {
  const img = decodePNG(Buffer.from(b64, 'base64'));
  const b = artBBox(img, 24);
  if (b.x1 < 0) { rows.push(`${name}: sem arte`); continue; }
  const cw = (b.x1 - b.x0 + 1) / img.w, chh = (b.y1 - b.y0 + 1) / img.h;
  const cov = Math.min(cw, chh);
  sum += cov; n++;
  minC = Math.min(minC, cov); maxC = Math.max(maxC, cov);
  rows.push(`${name.padEnd(24)} arte ${(cw * 100).toFixed(1)}% x ${(chh * 100).toFixed(1)}%  (min ${(cov * 100).toFixed(1)}%)  pinos=${(b.art / b.total * 100).toFixed(1)}%`);
}
console.log(rows.join('\n'));
console.log('\ncobertura do bicho na arte: media', (sum / n * 100).toFixed(1) + '%', '| min', (minC * 100).toFixed(1) + '%', '| max', (maxC * 100).toFixed(1) + '%');
console.log('com scale(1.35) e contain em caixa quadrada -> visivel no max:', (Math.min(1, sum / n * 1.35) * 100).toFixed(1) + '%');
