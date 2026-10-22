/* Codec PNG minimo em Node puro (zlib): decodifica PNG truecolor 8-bit
   e re-encoda como PNG indexado (paleta) -> muito menor, mesma resolucao. */
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8;
  let w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  let plte = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9];
      if (data[12] !== 0) throw new Error('interlace nao suportado');
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (bd !== 8) throw new Error('bitdepth ' + bd + ' nao suportado');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!channels) throw new Error('colortype ' + ct + ' nao suportado');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  // normaliza para RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * bpp, d = i * 4;
    if (ct === 2) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = 255; }
    else if (ct === 6) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = out[s + 3]; }
    else if (ct === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = 255; }
    else if (ct === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = out[s + 1]; }
    else if (ct === 3) { const p3 = out[s] * 3; rgba[d] = plte[p3]; rgba[d + 1] = plte[p3 + 1]; rgba[d + 2] = plte[p3 + 2]; rgba[d + 3] = trns && out[s] < trns.length ? trns[out[s]] : 255; }
  }
  return { w, h, rgba };
}

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

/* paleta por corte mediano (median cut) -> no maximo maxColors cores */
function quantize(rgba, w, h, maxColors) {
  const px = [];
  for (let i = 0; i < w * h; i++) px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]]);
  const uniq = new Map();
  for (const p of px) {
    const k = (p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3];
    uniq.set(k, (uniq.get(k) || 0) + 1);
  }
  if (uniq.size <= maxColors) {
    const pal = [...uniq.keys()].map(k => [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255]);
    const map = new Map([...uniq.keys()].map((k, i) => [k, i]));
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const k = (rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | rgba[i * 4 + 3];
      idx[i] = map.get(k);
    }
    return { pal, idx, lossless: true, colors: uniq.size };
  }
  // median cut
  let boxes = [[...uniq.entries()].map(([k, n]) => ({ k, n }))];
  while (boxes.length < maxColors) {
    boxes.sort((a, b) => b.length - a.length);
    const box = boxes.shift();
    if (box.length < 2) { boxes.push(box); break; }
    const rmin = Math.min(...box.map(e => (e.k >>> 24) & 255)), rmax = Math.max(...box.map(e => (e.k >>> 24) & 255));
    const gmin = Math.min(...box.map(e => (e.k >>> 16) & 255)), gmax = Math.max(...box.map(e => (e.k >>> 16) & 255));
    const bmin = Math.min(...box.map(e => (e.k >>> 8) & 255)), bmax = Math.max(...box.map(e => (e.k >>> 8) & 255));
    const dr = rmax - rmin, dg = gmax - gmin, db = bmax - bmin;
    const ch = dr >= dg && dr >= db ? 0 : (dg >= db ? 1 : 2);
    box.sort((a, b) => (((a.k >>> (24 - 8 * ch)) & 255) - ((b.k >>> (24 - 8 * ch)) & 255)));
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  const pal = boxes.filter(b => b.length).map(b => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const e of b) { r += (e.k >>> 24) & 255; g += (e.k >>> 16) & 255; bl += (e.k >>> 8) & 255; n += e.n; }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n), 255];
  });
  const idx = new Uint8Array(w * h);
  const memo = new Map();
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let best = memo.get(key);
    if (best === undefined) {
      let bd = Infinity;
      for (let c = 0; c < pal.length; c++) {
        const dr = r - pal[c][0], dg = g - pal[c][1], db = b - pal[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      memo.set(key, best);
    }
    idx[i] = best;
  }
  return { pal, idx, lossless: false, colors: pal.length };
}

function encodeIndexed({ w, h, pal, idx }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
  // raw com filtro None (0) por linha
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = idx[y * w + x];
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { decodePNG, encodeIndexed, quantize };
