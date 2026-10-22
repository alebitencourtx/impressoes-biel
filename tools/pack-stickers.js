#!/usr/bin/env node
/* ============================================================================
   pack-stickers.js — pega uma pasta de figurinhas já recortadas e transforma
   no que o app consome: WebP otimizado + blob embutido + array da categoria.

   Uso:
     node tools/pack-stickers.js <pasta> [opções]

   Opções:
     --size <px>        reescala para esse lado (padrão: o size do sprites.json)
     --cat <slug>       chave da categoria (padrão: campo "categoria" do JSON)
     --psnr <dB>        qualidade mínima aceitável (padrão: 42, como o Patchwork)
     --out-array <arq>  onde gravar o snippet do array (padrão: <pasta>/<cat>.array.js)
     --embed            injeta/atualiza window.OFFLINE_<CAT> no index.html
     --dry-run          mede tudo, não grava nada

   Exemplo:
     node tools/pack-stickers.js img/stickers/eric-carle --embed

   Requer: node, cwebp + dwebp (apk add libwebp-tools), zlib.
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { decodePNG } = require('./pngcodec.js');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const TARGET_PSNR = 42;
const QUALITIES = [72, 76, 80, 84, 88, 90, 92, 94, 96, 98];

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--embed' || a === '--dry-run') { o[a.slice(2)] = true; continue; }
    if (a.startsWith('--')) { o[a.slice(2)] = argv[++i]; }
    else o._.push(a);
  }
  return o;
}

function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figura';
}

/* PSNR só nos pixels visíveis — o alfa é comparado à parte (canais opacos). */
function psnr(a, b, w, h) {
  let se = 0, n = 0, max = 0;
  for (let i = 0; i < w * h; i++) {
    if (a[i * 4 + 3] < 8) continue;
    for (let c = 0; c < 3; c++) {
      const d = a[i * 4 + c] - b[i * 4 + c];
      if (Math.abs(d) > max) max = Math.abs(d);
      se += d * d;
      n++;
    }
  }
  if (!n) return { psnr: 99, max: 0 };
  const mse = se / n;
  return { psnr: mse ? 10 * Math.log10(65025 / mse) : 99, max };
}

/* Cabeçalho de um PNG (largura/altura) sem decodificar tudo. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* Busca adaptativa: parte de q90 e anda em passos grandes para o lado certo.
   Antes ela subia q72→q98 e, quando a arte não alcançava a meta, comprimia
   cada imagem 10 vezes (30 figurinhas levavam ~11 min). */
function tryQ(srcPng, tmp, q, orig) {
  const out = path.join(tmp, 'q.webp');
  execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '100',
    '-m', '4', '-sharp_yuv', srcPng, '-o', out]);
  const back = path.join(tmp, 'back.png');
  execFileSync('dwebp', ['-quiet', out, '-o', back]);
  const dec = decodePNG(fs.readFileSync(back));
  return { q, buf: fs.readFileSync(out), m: psnr(orig.rgba, dec.rgba, orig.w, orig.h) };
}

function bestWebp(srcPng, tmp) {
  const orig = decodePNG(fs.readFileSync(srcPng));
  const down = [88, 84, 80, 76, 72];
  const up = [94, 96, 98];

  let best = tryQ(srcPng, tmp, 90, orig);
  if (best.m.psnr >= TARGET_PSNR) {
    // dá para descer a qualidade: testa do mais baixo para o mais alto
    for (let i = down.length - 1; i >= 0; i--) {
      const r = tryQ(srcPng, tmp, down[i], orig);
      if (r.m.psnr < TARGET_PSNR) break;
      best = r;
    }
  } else {
    for (const q of up) {
      best = tryQ(srcPng, tmp, q, orig);
      if (best.m.psnr >= TARGET_PSNR) break;
    }
  }
  return best;
}

function main() {
  const o = args(process.argv.slice(2));
  const dir = o._[0];
  if (!dir || !fs.existsSync(dir)) {
    console.error('uso: node tools/pack-stickers.js <pasta-de-figurinhas> [--embed]');
    process.exit(1);
  }

  const jsonFile = path.join(dir, 'sprites.json');
  let meta = { categoria: path.basename(path.resolve(dir)), size: 360, itens: [] };
  if (fs.existsSync(jsonFile)) meta = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));

  const cat = slug(o.cat || meta.categoria || path.basename(path.resolve(dir)));
  const size = parseInt(o.size || meta.size || 360, 10);
  const dry = !!o.dry;

  // itens: do JSON se existir, senão todos os PNGs da pasta
  let itens = (meta.itens || []).filter(it => fs.existsSync(path.join(dir, it.arquivo)));
  if (!itens.length) {
    itens = fs.readdirSync(dir).filter(f => /\.(png|webp)$/i.test(f)).sort()
      .map(f => ({ arquivo: f, nome: f.replace(/\.\w+$/, '').replace(/-/g, ' ') }));
  }
  if (!itens.length) {
    console.error('nenhuma imagem em ' + dir);
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  const map = {};
  let pngBytes = 0, webpBytes = 0, worst = 99, worstMax = 0;

  console.log(`categoria: ${cat}   figurinhas: ${itens.length}   alvo: ${size}x${size}`);

  for (const it of itens) {
    const src = path.join(dir, it.arquivo);
    pngBytes += fs.statSync(src).size;

    // normaliza tamanho (só se precisar) antes de comprimir
    const { w, h } = pngSize(src);
    let work = src;
    if (w !== size || h !== size) {
      work = path.join(tmp, 'r.png');
      execFileSync('magick', [src, '-background', 'none', '-gravity', 'center',
        '-extent', `${size}x${size}`, '-resize', `${size}x${size}`,
        '-depth', '8', '-define', 'png:color-type=6', work]);
    }

    const r = bestWebp(work, tmp);
    webpBytes += r.buf.length;
    if (r.m.psnr < worst) worst = r.m.psnr;
    if (r.m.max > worstMax) worstMax = r.m.max;

    const key = it.arquivo.replace(/\.\w+$/, '') + '.webp';
    map[key] = 'data:image/webp;base64,' + r.buf.toString('base64');

    console.log(`  ${key.padEnd(28)} q${String(r.q).padEnd(3)} ` +
      `${(r.buf.length / 1024).toFixed(1).padStart(5)} KB  PSNR ${r.m.psnr.toFixed(1)}`);
  }

  console.log(`\nPNG de origem   : ${(pngBytes / 1048576).toFixed(2)} MB`);
  console.log(`WebP resultante : ${(webpBytes / 1048576).toFixed(2)} MB ` +
    `(${(webpBytes / pngBytes * 100).toFixed(0)}% do PNG)`);
  console.log(`pior PSNR       : ${worst.toFixed(1)} dB (pior erro de canal ${worstMax})`);

  // ---- snippet do array da categoria -----------------------------------
  const constName = cat.toUpperCase().replace(/-/g, '_');
  const dirPath = `img/stickers/${cat}/`;
  const lines = [
    `/* ${cat} — ${itens.length} recortes, ${size}x${size}, fundo transparente.`,
    `   Gerado por tools/pack-stickers.js. */`,
    `const ${constName}_DIR = '${dirPath}';`,
    `const ${constName} = [`
  ];
  itens.forEach(it => {
    lines.push(`  { arquivo: "${it.arquivo.replace(/\.\w+$/, '')}.webp", nome: ${JSON.stringify(it.nome)} },`);
  });
  lines.push('];', '');

  const arrayFile = o['out-array'] || path.join(dir, `${cat}.array.js`);
  if (!dry) fs.writeFileSync(arrayFile, lines.join('\n'));
  console.log(`\narray da categoria: ${path.relative(process.cwd(), arrayFile)}`);

  // ---- blob embutido no index.html --------------------------------------
  if (o.embed) {
    const marker = `window.OFFLINE_${constName} = `;
    let html = fs.readFileSync(HTML, 'utf8');
    const blob = marker + JSON.stringify(map) + ';';
    const at = html.indexOf(marker);
    if (at >= 0) {
      const end = html.indexOf('};', at);
      if (end < 0) throw new Error('blob ' + marker + ' malformado');
      html = html.slice(0, at) + blob + html.slice(end + 2);
      console.log('blob: substituído (' + marker.trim() + ')');
    } else {
      const closeBody = html.lastIndexOf('</body>');
      if (closeBody < 0) throw new Error('</body> não encontrado');
      const script = `\n<script>\n${blob}\n</script>\n`;
      html = html.slice(0, closeBody) + script + html.slice(closeBody);
      console.log('blob: criado antes de </body>');
    }
    if (!dry) {
      fs.writeFileSync(HTML, html);
      console.log(`index.html: ${(Buffer.byteLength(html) / 1048576).toFixed(2)} MB`);
    }
  }

  if (dry) console.log('\n--dry-run: nada foi gravado');
  else console.log('\npronto.');
}

main();
