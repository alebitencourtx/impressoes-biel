/* Compara as figurinhas originais (RGB) com as otimizadas (indexadas):
   erro maximo/medio por pixel, para garantir qualidade de impressao. */
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('./_pngcodec.js');

const A = process.argv[2];   // originais
const B = process.argv[3];   // otimizadas
let worstMax = 0, sumMean = 0, n = 0, worstFile = '';
for (const f of fs.readdirSync(A).filter(f => f.endsWith('.png'))) {
  const a = decodePNG(fs.readFileSync(path.join(A, f)));
  const b = decodePNG(fs.readFileSync(path.join(B, f)));
  if (a.w !== b.w || a.h !== b.h) { console.log('DIMensao diferente em', f); continue; }
  let max = 0, sum = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.rgba[i * 4 + c] - b.rgba[i * 4 + c]);
      if (d > max) max = d;
      sum += d;
    }
  }
  const mean = sum / (a.w * a.h * 3);
  sumMean += mean; n++;
  if (max > worstMax) { worstMax = max; worstFile = f; }
  if (f === 'dodo.png' || f === 'gato.png') console.log(f, '| erro max', max, '| erro medio', mean.toFixed(2));
}
console.log('---');
console.log('figuras comparadas:', n, '| erro medio global:', (sumMean / n).toFixed(2), '/255');
console.log('pior caso: erro maximo', worstMax, 'em', worstFile);
