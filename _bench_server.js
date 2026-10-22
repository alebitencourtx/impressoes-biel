/* Mede o inicio do app: download+parse do HTML e momento em que a
   folha A4 (area central) aparece. Roda contra o index.html real. */
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = process.argv[2] || '/workspace';
const port = 8099;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  const body = fs.readFileSync(f);
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
});

server.listen(port, '127.0.0.1', () => console.log('servidor de teste em http://127.0.0.1:' + port));
