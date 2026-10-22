#!/usr/bin/env node
/* Reencoda as 33 figurinhas Patchwork embutidas no index.html para WebP,
   com qualidade adaptativa: para cada figura usa a MENOR qualidade cujo
   PSNR contra o original fique >= 42 dB (imperceptivel ate na impressao).

   Uso:  node tools/encode-figurinhas.js [--dry-run]
   Requer: cwebp e dwebp (apk add libwebp-tools)

   O script e idempotente: ele le o que estiver embutido (PNG ou WebP),
   decodifica, recomprime a partir do original atual e regrava o bloco
   `window.OFFLINE_PATCHWORK` no fim do <body>. */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { decodePNG } = require('./pngcodec.js');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const TARGET_PSNR = 42;
const QUALITIES = [80, 82, 84, 86, 88, 90, 92, 94, 96, 98];
const dryRun = process.argv.includes('--dry-run');

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

/* Qualquer imagem embutida -> PNG em disco (o cwebp precisa de arquivo). */
function toPNG(dataUrl, name, tmp) {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const out = path.join(tmp, name.replace(/\.\w+$/, '.png'));
  if (/^data:image\/png/.test(dataUrl)) {
    fs.writeFileSync(out, buf);
  } else {
    const src = path.join(tmp, 'in.bin');
    fs.writeFileSync(src, buf);
    execFileSync('dwebp', ['-quiet', src, '-o', out]);
  }
  return out;
}

function encode(src, tmp) {
  const orig = decodePNG(fs.readFileSync(src));
  let best = null;
  for (const q of QUALITIES) {
    const out = path.join(tmp, `q${q}.webp`);
    execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', src, '-o', out]);
    const back = path.join(tmp, 'back.png');
    execFileSync('dwebp', ['-quiet', out, '-o', back]);
    const dec = decodePNG(fs.readFileSync(back));
    const m = metrics(orig.rgba, dec.rgba, orig.w, orig.h);
    best = { q, buf: fs.readFileSync(out), m };
    if (m.psnr >= TARGET_PSNR) break;
  }
  return best;
}

function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const marker = 'window.OFFLINE_PATCHWORK = ';
  const start = html.lastIndexOf(marker);
  if (start < 0) throw new Error('bloco OFFLINE_PATCHWORK nao encontrado');
  const open = html.indexOf('{', start);
  const close = html.lastIndexOf('}');
  if (html[close + 1] !== ';') throw new Error('formato inesperado depois do blob');
  const map = JSON.parse(html.slice(open, close + 1));
  const names = Object.keys(map).sort();

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fig-'));
  const out = {};
  let pngBytes = 0, webpBytes = 0, worstPsnr = 99, worstMax = 0;

  for (const name of names) {
    const src = toPNG(map[name], name, tmp);
    pngBytes += fs.statSync(src).size;
    const r = encode(src, tmp);
    webpBytes += r.buf.length;
    if (r.m.psnr < worstPsnr) worstPsnr = r.m.psnr;
    if (r.m.max > worstMax) worstMax = r.m.max;
    out[name] = 'data:image/webp;base64,' + r.buf.toString('base64');
    console.log(
      name.padEnd(22),
      'q' + String(r.q).padEnd(3),
      (r.buf.length / 1024).toFixed(1).padStart(5) + ' KB',
      'PSNR ' + r.m.psnr.toFixed(1),
      'max ' + r.m.max
    );
  }

  const before = Buffer.byteLength(html);
  const novo = html.slice(0, start) + marker + JSON.stringify(out) + ';' + html.slice(close + 2);
  const after = Buffer.byteLength(novo);

  console.log('\nfigurinhas      :', names.length);
  console.log('PNG de origem   :', (pngBytes / 1048576).toFixed(2), 'MB');
  console.log('WebP resultante :', (webpBytes / 1048576).toFixed(2), 'MB',
    '(' + (webpBytes / pngBytes * 100).toFixed(0) + '% do PNG)');
  console.log('index.html      :', (before / 1048576).toFixed(2), 'MB ->', (after / 1048576).toFixed(2), 'MB');
  console.log('pior PSNR       :', worstPsnr.toFixed(1), 'dB | pior erro de canal:', worstMax);

  if (dryRun) {
    console.log('\n--dry-run: index.html NAO foi alterado');
  } else {
    fs.writeFileSync(HTML, novo);
    console.log('\nindex.html atualizado.');
  }
}

main();
