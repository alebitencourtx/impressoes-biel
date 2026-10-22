/* Relatorio por figurinha: qualidade adaptativa (menor q que mantem PSNR >= 42 dB). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { decodePNG } = require('../_pngcodec.js');

const DIR = '/tmp/pw';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blob = html.slice(html.lastIndexOf('window.OFFLINE_PATCHWORK'));
const json = blob.slice(blob.indexOf('{'), blob.lastIndexOf('}') + 1);
const map = JSON.parse(json);
const names = Object.keys(map).sort();

function metrics(a, b, w, h) {
  let sum = 0, max = 0, se = 0;
  const n = w * h * 3;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = a[i * 4 + c] - b[i * 4 + c];
      sum += Math.abs(d);
      if (Math.abs(d) > max) max = Math.abs(d);
      se += d * d;
    }
  }
  const mse = se / n;
  return { mean: sum / n, max, psnr: mse ? 10 * Math.log10(65025 / mse) : 99 };
}

const TARGET = 42;
let total = 0;
const escolhas = [];
for (const name of names) {
  const src = path.join(DIR, name);
  const orig = decodePNG(fs.readFileSync(src));
  let pick = null;
  for (const q of [80, 82, 84, 86, 88, 90, 92, 94, 96, 98]) {
    const out = path.join(DIR, `a-${q}-${name.replace(/\.png$/, '.webp')}`);
    execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', src, '-o', out]);
    const back = path.join(DIR, 'back-a.png');
    execFileSync('dwebp', ['-quiet', out, '-o', back]);
    const dec = decodePNG(fs.readFileSync(back));
    const m = metrics(orig.rgba, dec.rgba, orig.w, orig.h);
    if (m.psnr >= TARGET) { pick = { q, size: fs.statSync(out).size, m }; break; }
  }
  if (!pick) {
    const out = path.join(DIR, `a-98-${name.replace(/\.png$/, '.webp')}`);
    pick = { q: 98, size: fs.statSync(out).size, m: { psnr: 0, mean: 0, max: 0 } };
  }
  total += pick.size;
  escolhas.push({ name, q: pick.q, kb: (pick.size / 1024).toFixed(1), psnr: pick.m.psnr.toFixed(1), max: pick.m.max });
}
escolhas.sort((a, b) => a.psnr - b.psnr);
console.log('nome'.padEnd(22), 'q   KB     PSNR  max');
escolhas.forEach((e) => console.log(e.name.padEnd(22), String(e.q).padEnd(3), String(e.kb).padEnd(6), e.psnr.padEnd(5), e.max));
console.log('\ntotal webp:', (total / 1024 / 1024).toFixed(2), 'MB  ->  base64', (total * 4 / 3 / 1024 / 1024).toFixed(2), 'MB');
const qs = escolhas.map((e) => e.q);
console.log('q min/med/max:', Math.min(...qs), qs.reduce((a, b) => a + b, 0) / qs.length, Math.max(...qs));
