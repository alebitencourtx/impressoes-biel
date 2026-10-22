/* Mede: WebP em varias qualidades vs PNG original das figurinhas Patchwork.
   Grava os PNGs em /tmp/pw e imprime tamanho + erro por qualidade. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { decodePNG } = require('./_pngcodec.js');

const DIR = '/tmp/pw';
fs.mkdirSync(DIR, { recursive: true });

const html = fs.readFileSync('index.html', 'utf8');
const blob = html.slice(html.lastIndexOf('window.OFFLINE_PATCHWORK'));
const json = blob.slice(blob.indexOf('{'), blob.lastIndexOf('}') + 1);
const map = JSON.parse(json);
const names = Object.keys(map).sort();
console.log('figurinhas:', names.length);

// 1) extrai PNGs
let pngTotal = 0;
const origs = new Map();
for (const name of names) {
  const b64 = map[name].split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  const file = path.join(DIR, name);
  fs.writeFileSync(file, buf);
  pngTotal += buf.length;
  const img = decodePNG(buf);
  origs.set(name, img);
}
console.log('base64 no html:', (Object.values(map).reduce((s, v) => s + v.length, 0) / 1024 / 1024).toFixed(2), 'MB');
console.log('PNG binario   :', (pngTotal / 1024 / 1024).toFixed(2), 'MB');

// 2) metricas de erro
function err(a, b, w, h) {
  let sum = 0, max = 0, n = w * h * 3, se = 0;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = a[i * 4 + c] - b[i * 4 + c];
      const ad = Math.abs(d);
      sum += ad;
      if (ad > max) max = ad;
      se += d * d;
    }
  }
  const mse = se / n;
  return { mean: sum / n, max, psnr: mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse) };
}

// 3) cada qualidade
for (const q of [70, 80, 85, 90, 95]) {
  let total = 0, sumMean = 0, sumPsnr = 0, worstMax = 0, count = 0;
  for (const name of names) {
    const src = path.join(DIR, name);
    const out = path.join(DIR, `q${q}-${name.replace(/\.png$/, '.webp')}`);
    execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', src, '-o', out]);
    const wbuf = fs.readFileSync(out);
    total += wbuf.length;
    // volta pra PNG pra comparar pixel a pixel
    const back = path.join(DIR, 'back.png');
    execFileSync('dwebp', ['-quiet', out, '-o', back]);
    const dec = decodePNG(fs.readFileSync(back));
    const o = origs.get(name);
    if (o.w !== dec.w || o.h !== dec.h) throw new Error('tamanho diferente: ' + name);
    const e = err(o.rgba, dec.rgba, o.w, o.h);
    sumMean += e.mean; sumPsnr += e.psnr; count++;
    if (e.max > worstMax) worstMax = e.max;
  }
  console.log(
    `q=${String(q).padEnd(2)} webp ${(total / 1024 / 1024).toFixed(2)} MB` +
    ` | ${(total / pngTotal * 100).toFixed(0)}% do PNG` +
    ` | erro medio ${(sumMean / count).toFixed(2)}/255` +
    ` | pior canal ${worstMax}` +
    ` | PSNR ${(sumPsnr / count).toFixed(1)} dB`
  );
}

// 4) lossless webp como referencia
let lossless = 0;
for (const name of names) {
  const src = path.join(DIR, name);
  const out = path.join(DIR, `L-${name.replace(/\.png$/, '.webp')}`);
  execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', src, '-o', out]);
  lossless += fs.statSync(out).size;
}
console.log('lossless webp:', (lossless / 1024 / 1024).toFixed(2), 'MB', `(${(lossless / pngTotal * 100).toFixed(0)}% do PNG)`);
