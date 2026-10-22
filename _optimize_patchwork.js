/* Re-otimiza as figurinhas SEM PERDA: PNG truecolor com filtro adaptativo. */
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('./_pngcodec.js');
const { encodeTruecolor } = require('./_pngtrue.js');

const DIR = path.join(__dirname, 'img', 'stickers', 'patchwork');
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
let before = 0, after = 0;
const rows = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f));
  const img = decodePNG(src);
  const alpha = img.rgba.some((v, i) => i % 4 === 3 && v !== 255);
  const out = encodeTruecolor(img.rgba, img.w, img.h, alpha);
  fs.writeFileSync(path.join(DIR, f), out);
  before += src.length; after += out.length;
  rows.push([f, img.w + 'x' + img.h, (src.length / 1024).toFixed(0) + 'K', (out.length / 1024).toFixed(0) + 'K']);
}
rows.sort((a, b) => parseFloat(b[2]) - parseFloat(a[2]));
rows.slice(0, 6).forEach(r => console.log('  ', r.join(' | ')));
console.log('---');
console.log('antes:', (before / 1024 / 1024).toFixed(2), 'MB -> depois:', (after / 1024 / 1024).toFixed(2), 'MB',
  '| reducao:', (100 - after / before * 100).toFixed(1) + '% | sem perda de cor');
