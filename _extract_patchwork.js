/* Extrai as figurinhas Patchwork embutidas em base64 no index.html
   para arquivos PNG reais em img/stickers/patchwork/. */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'img', 'stickers', 'patchwork');

const html = fs.readFileSync(SRC, 'utf8');
const start = html.indexOf('const OFFLINE_PATCHWORK = {');
if (start < 0) throw new Error('OFFLINE_PATCHWORK nao encontrado');
const end = html.indexOf('\n};', start);
const block = html.slice(start, end);

const re = /"([^"]+\.png)":"data:image\/png;base64,([A-Za-z0-9+/=]+)"/g;
const files = [];
let m;
while ((m = re.exec(block))) files.push({ file: m[1], b64: m[2] });

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const f of files) {
  const buf = Buffer.from(f.b64, 'base64');
  fs.writeFileSync(path.join(OUT, f.file), buf);
  total += buf.length;
}
console.log('extraidas:', files.length, '| total:', (total / 1024 / 1024).toFixed(2), 'MB');
console.log('pasta:', path.relative(__dirname, OUT));
