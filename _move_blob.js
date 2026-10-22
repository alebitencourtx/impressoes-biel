/* Reorganiza o index.html:
   1) separa o blob OFFLINE_PATCHWORK do <script> do app e o joga no fim do
      <body> (assim o app inicia e pinta a pagina antes de os ~6 MB chegarem);
   2) troca o favicon de 130 KB em base64 pelo arquivo icons/icon-192.png;
   3) troca o init por DOMContentLoaded por chamada direta (o script do app
      ja esta no fim do <body>, entao o DOM esta pronto).
   O blob em si e movido como texto (6 MB) sem reescrever. */
const fs = require('fs');
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const before = s.length;

/* ---------- 1) blob: separar do script do app ---------- */
const marker = '<script>\nconst OFFLINE_PATCHWORK = ';
const i = s.indexOf(marker);
if (i < 0) throw new Error('blob nao encontrado');
const blobStart = i + '<script>\n'.length;
const blobEnd = s.indexOf('\n', blobStart);          // fim da linha do blob
const blobLine = s.slice(blobStart, blobEnd);
if (!blobLine.startsWith('const OFFLINE_PATCHWORK = {')) throw new Error('formato do blob inesperado');
if (!blobLine.endsWith('};')) throw new Error('blob nao termina com };');

// remove o bloco <script> + blob + funcao do inicio
const funcLineEnd = s.indexOf('\n', blobEnd + 1);
const funcLine = s.slice(blobEnd + 1, funcLineEnd);
if (!funcLine.includes('offlinePatchworkSource')) throw new Error('funcao nao encontrada apos o blob');
s = s.slice(0, i) + s.slice(funcLineEnd + 1);

// 2) reinsere no fim do <body>
const blobBlock =
  '\n<!-- Figurinhas Patchwork embutidas em base64 (funcionam offline).\n' +
  '     Ficam no FIM do <body> de proposito: o app inicia e pinta a pagina\n' +
  '     enquanto estes ~6 MB ainda estao baixando. -->\n' +
  '<script>\n' +
  blobLine.replace('const OFFLINE_PATCHWORK =', 'window.OFFLINE_PATCHWORK =') +
  '\n</script>\n';
const bodyEnd = s.lastIndexOf('</body>');
if (bodyEnd < 0) throw new Error('</body> nao encontrado');
s = s.slice(0, bodyEnd) + blobBlock + s.slice(bodyEnd);

/* ---------- 2) favicon: base64 (130 KB) -> arquivo ---------- */
const iconRe = /<link rel="icon" type="image\/jpeg" href="data:image\/jpeg;base64,[^"]*">/;
if (!iconRe.test(s)) throw new Error('favicon base64 nao encontrado');
s = s.replace(iconRe,
  '<link rel="icon" type="image/png" href="./icons/icon-192.png">\n' +
  '<link rel="apple-touch-icon" href="./icons/icon-192.png">');

/* ---------- 3) init direto (DOM ja pronto: script no fim do body) ---------- */
const dc = "document.addEventListener('DOMContentLoaded', init);";
if (!s.includes(dc)) throw new Error('listener de DOMContentLoaded nao encontrado');
s = s.replace(dc, 'init();');

fs.writeFileSync(file, s);
console.log('index.html:', (before / 1024 / 1024).toFixed(2), 'MB ->', (s.length / 1024 / 1024).toFixed(2), 'MB');
console.log('blob movido para o fim do <body>:', (blobLine.length / 1024 / 1024).toFixed(2), 'MB');
console.log('favicon: base64 130 KB -> ./icons/icon-192.png');
