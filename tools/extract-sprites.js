#!/usr/bin/env node
/* ============================================================================
   extract-sprites.js — quebra uma PRANCHA (uma imagem com várias figuras)
   em figurinhas individuais prontas para o app.

   Uso:
     node tools/extract-sprites.js <prancha.(jpg|png|webp)> [opções]

   Opções:
     --out <dir>        pasta de saída         (padrão: img/stickers/<slug>)
     --name <slug>      nome da categoria     (padrão: nome do arquivo)
     --size <px>        lado final, quadrado  (padrão: 360, igual ao Patchwork)
     --gap <px>         dilatação p/ juntar partes soltas (padrão: ~1% do lado)
     --min-area <frac>  descarta manchas menores que isso (padrão: 0.0012)
     --pad <frac>       respiro em volta da figura (padrão: 0.03)
     --bg-tol <0-255>   tolerância do fundo claro (padrão: 28)
     --names <arquivo>  um nome por linha, na ordem de leitura da prancha
     --dry-run          só mede, não grava nada

   Exemplo:
     node tools/extract-sprites.js img/sources/eric-carle.jpg --name eric-carle

   O que ele faz, em ordem:
     1. normaliza a entrada para PNG RGBA 8-bit (usa o ImageMagick `magick`);
     2. acha o FUNDO por inundação a partir das bordas (branco e/ou alpha 0);
     3. dilata o resto e rotula os componentes conexos — a dilatação junta
        partes que se tocam por pouco (pata, asa, antena) num bicho só;
     4. recorta a caixa de cada figura, deixa quadrada e reamostra para `size`;
     5. grava PNG com fundo TRANSPARENTE + sprites.json (nome, arquivo, box).

   Requer: node, imagemagick (apk add imagemagick), zlib (nativo).
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { decodePNG } = require('./pngcodec.js');

/* ----------------------------- argumentos ------------------------------- */
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) o[k] = true;
      else { o[k] = nxt; i++; }
    } else o._.push(a);
  }
  return o;
}

/* ------------------------- PNG RGBA de saída ---------------------------- */
/* Encoder mínimo: truecolor+alpha, filtro 0. Suficiente e sem dependências. */
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* --------------------------- entrada -> RGBA --------------------------- */
function loadRGBA(file, tmp) {
  let png = file;
  if (!/\.png$/i.test(file)) {
    png = path.join(tmp, 'sheet.png');
    execFileSync('magick', [file, '-depth', '8', '-define', 'png:color-type=6', png]);
  } else {
    // garante 8-bit RGBA mesmo se o PNG vier indexado/16-bit
    const norm = path.join(tmp, 'sheet.png');
    try {
      execFileSync('magick', [file, '-depth', '8', '-define', 'png:color-type=6', norm]);
      png = norm;
    } catch (_) { /* sem magick: tenta direto */ }
  }
  return decodePNG(fs.readFileSync(png));
}

/* ------------------------------ fundo ---------------------------------- */
function isBg(r, g, b, a, tol) {
  if (a < 16) return true;
  return r >= 255 - tol && g >= 255 - tol && b >= 255 - tol;
}

/* Inundação a partir das 4 bordas: só o branco CONECTADO ao lado de fora é
   fundo. Branco no meio do bicho (barriga do pinguim) continua opaco. */
function floodBg(rgba, w, h, tol) {
  const bg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (i) => {
    if (bg[i]) return;
    const p = i * 4;
    if (!isBg(rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3], tol)) return;
    bg[i] = 1; stack[sp++] = i;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  return bg;
}

/* ------------------------------ morfologia ----------------------------- */
/* Erosão separável (mínimo) — corta as pontes finas que o JPEG e o encosto
   de duas figuras criam. Sem ela, bichos que se tocam viram um bloco só. */
function erode(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 1;
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
      for (let k = a; k <= b && v; k++) if (!mask[row + k]) v = 0;
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 1;
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
      for (let k = a; k <= b && v; k++) if (!tmp[k * w + x]) v = 0;
      out[y * w + x] = v;
    }
  }
  return out;
}

/* Dilatação separável (máximo) — junta partes próximas sem unir bichos que
   estão a mais de `r` pixels um do outro. */
function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
      for (let k = a; k <= b && !v; k++) if (mask[row + k]) v = 1;
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
      for (let k = a; k <= b && !v; k++) if (tmp[k * w + x]) v = 1;
      out[y * w + x] = v;
    }
  }
  return out;
}

/* --------------------------- corte por pescoço -------------------------- */
/* Duas figuras que se encostam viram um componente só. Em vez de adivinhar
   por forma (arriscado), procuramos a "linha de pescoço": a coluna (ou linha)
   mais FINA dentro do miolo do bloco. Se ela for bem mais fina que o bloco, é
   ali que os dois bichos se tocam — e o corte é honesto.
   Só é tentado em blocos anormalmente grandes (ver areaRatio no main). */
function lineCounts(fg, lab, w, box, axis) {
  const len = axis === 'x' ? box.w : box.h;
  const counts = new Int32Array(len);
  const x1 = box.x0 + box.w - 1, y1 = box.y0 + box.h - 1;
  for (let y = box.y0; y <= y1; y++) {
    for (let x = box.x0; x <= x1; x++) {
      const i = y * w + x;
      if (!fg[i] || lab[i] !== box.id) continue;
      counts[axis === 'x' ? x - box.x0 : y - box.y0]++;
    }
  }
  return counts;
}

function splitOnce(fg, lab, w, box) {
  const depth = box.depth || 0;
  if (depth >= 2) return null;

  let best = null, cand = null;
  for (const axis of ['x', 'y']) {
    const counts = lineCounts(fg, lab, w, box, axis);
    const len = counts.length;
    const span = axis === 'x' ? box.h : box.w;   // espessura máxima possível
    const from = Math.floor(len * 0.30), to = Math.ceil(len * 0.70);
    if (to - from < 6) continue;
    let min = Infinity, at = -1;
    for (let k = from; k < to; k++) if (counts[k] < min) { min = counts[k]; at = k; }
    if (at < 0 || min <= 0) continue;
    const ratio = min / span;
    if (!cand || ratio < cand.ratio) cand = { axis, at, ratio };
    if (ratio > 0.16) continue;                  // sem gargalo: é um bicho só
    if (!best || ratio < best.ratio) best = { axis, at, ratio };
  }
  if (process.env.DEBUG_SPLIT) {
    console.log(`  [split] id=${box.id} ${box.w}x${box.h} area=${box.area} cand=` +
      (cand ? `${cand.axis}@${cand.at} ratio=${cand.ratio.toFixed(3)}` : 'nenhum'));
  }
  if (!best) return null;

  const side = (cond) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, area = 0;
    const bx1 = box.x0 + box.w - 1, by1 = box.y0 + box.h - 1;
    for (let y = box.y0; y <= by1; y++) {
      for (let x = box.x0; x <= bx1; x++) {
        const i = y * w + x;
        if (!fg[i] || lab[i] !== box.id || !cond(x, y)) continue;
        area++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (!area) return null;
    return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area, id: box.id, depth: depth + 1 };
  };
  const cutX = box.x0 + best.at;
  const cutY = box.y0 + best.at;
  const a = best.axis === 'x' ? side((x) => x <= cutX) : side((y) => y <= cutY);
  const b = best.axis === 'x' ? side((x) => x > cutX) : side((y) => y > cutY);
  if (!a || !b) return null;
  if (a.area < box.area * 0.06 || b.area < box.area * 0.06) return null;
  return [a, b];
}

/* Diagnóstico de qualidade de um recorte: quanto da caixa a figura ocupa
   (fill) e em quantas ilhas ela se separa. Um corte ruim deixa fill baixo ou
   mais de uma ilha — é o alarme que não depende de olhar a imagem. */
function cutStats(fg, lab, w, box) {
  const { x0, y0, w: bw, h: bh, id } = box;
  const seen = new Uint8Array(bw * bh);
  const at = (x, y) => (y - y0) * bw + (x - x0);
  const ok = (x, y) => {
    const i = y * w + x;
    return i >= 0 && fg[i] && lab[i] === id;
  };
  let islands = 0, biggest = 0, filled = 0;
  const stack = [];
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      if (!ok(x, y)) continue;
      filled++;
      if (seen[at(x, y)]) continue;
      islands++;
      let n = 0;
      seen[at(x, y)] = 1; stack.push(x, y);
      while (stack.length) {
        const cy = stack.pop(), cx = stack.pop();
        n++;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < x0 || ny < y0 || nx >= x0 + bw || ny >= y0 + bh) continue;
            if (!ok(nx, ny) || seen[at(nx, ny)]) continue;
            seen[at(nx, ny)] = 1; stack.push(nx, ny);
          }
        }
      }
      if (n > biggest) biggest = n;
    }
  }
  return {
    fill: filled / (bw * bh),
    islands,
    biggest: filled ? biggest / filled : 0
  };
}

function label(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let n = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = n++;
    let sp = 0;
    lab[s] = id; stack[sp++] = s;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (mask[j] && lab[j] < 0) { lab[j] = id; stack[sp++] = j; }
        }
      }
    }
  }
  return { lab, n };
}

/* ------------------------- recorte + reamostragem ----------------------- */
/* Bilinear com alfa PRÉ-MULTIPLICADO: sem franja branca nas bordas quando a
   figura é reduzida. */
function resample(rgba, srcW, bgMask, box, size, labelMask, componentId) {
  const out = Buffer.alloc(size * size * 4);
  const sx = box.w / size, sy = box.h / size;
  const srcH = rgba.length / 4 / srcW;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = box.x + (x + 0.5) * sx - 0.5;
      const fy = box.y + (y + 0.5) * sy - 0.5;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const px = x0 + dx, py = y0 + dy;
          const wx = dx ? fx - x0 : 1 - (fx - x0);
          const wy = dy ? fy - y0 : 1 - (fy - y0);
          const wt = wx * wy;
          if (wt <= 0) continue;
          if (px < 0 || py < 0 || px >= srcW || py >= srcH) continue;
          const i = py * srcW + px;
          // Só incluir pixels que pertencem a este componente (evita pedaços de outros animais nos cantos)
          if (labelMask && labelMask[i] !== componentId) continue;
          const av = bgMask && bgMask[i] ? 0 : rgba[i * 4 + 3] / 255;
          const ww = wt * av;
          r += rgba[i * 4] * ww;
          g += rgba[i * 4 + 1] * ww;
          b += rgba[i * 4 + 2] * ww;
          a += ww;
          wsum += wt;
        }
      }
      const d = (y * size + x) * 4;
      if (a > 1e-6) {
        out[d] = Math.round(Math.min(255, r / a));
        out[d + 1] = Math.round(Math.min(255, g / a));
        out[d + 2] = Math.round(Math.min(255, b / a));
        out[d + 3] = Math.round(Math.min(255, (a / (wsum || 1)) * 255));
      }
    }
  }
  return out;
}

/* ------------------------------- slug ---------------------------------- */
function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figura';
}

/* --------------------------------- main -------------------------------- */
function main() {
  const o = args(process.argv.slice(2));
  const input = o._[0];
  if (!input) {
    console.error('uso: node tools/extract-sprites.js <prancha> [--out dir] [--name slug]');
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error('arquivo não encontrado: ' + input);
    process.exit(1);
  }

  const name = o.name && o.name !== true ? slug(o.name) : slug(path.basename(input).replace(/\.\w+$/, ''));
  const outDir = path.resolve(o.out && o.out !== true ? o.out : path.join('img', 'stickers', name));
  const size = parseInt(o.size || 360, 10);
  const padFrac = parseFloat(o.pad || 0.03);
  const minAreaFrac = parseFloat(o['min-area'] || 0.0012);
  const bgTol = parseInt(o['bg-tol'] || 28, 10);
  const dry = !!o['dry-run'];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
  const img = loadRGBA(input, tmp);
  const { w, h } = img;
  const rgba = img.rgba;
  console.log(`prancha: ${w}x${h} (${input})`);

  const gap = o.gap && o.gap !== true
    ? parseInt(o.gap, 10)
    : Math.max(2, Math.round(Math.min(w, h) * 0.01));
  const openR = o.open && o.open !== true ? parseInt(o.open, 10) : 1;

  const bg = floodBg(rgba, w, h, bgTol);
  let fgCount = 0;
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (!bg[i]) { fg[i] = 1; fgCount++; }
  if (!fgCount) {
    console.error('fundo tomou conta da imagem inteira — baixe --bg-tol');
    process.exit(1);
  }

  const grown = dilate(erode(fg, w, h, openR), w, h, openR + gap);
  const { lab, n } = label(grown, w, h);

  // caixa e área de cada rótulo, medidas no foreground ORIGINAL
  const box = new Array(n);
  const area = new Int32Array(n);
  for (let i = 0; i < w * h; i++) {
    if (!fg[i]) continue;
    const id = lab[i];
    if (id < 0) continue;
    const x = i % w, y = (i / w) | 0;
    const b = box[id];
    area[id]++;
    if (!b) box[id] = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < b.x0) b.x0 = x;
      if (y < b.y0) b.y0 = y;
      if (x > b.x1) b.x1 = x;
      if (y > b.y1) b.y1 = y;
    }
  }

  const minArea = Math.round(w * h * minAreaFrac);
  const found = [];
  for (let id = 0; id < n; id++) {
    const b = box[id];
    if (!b) continue;
    if (area[id] < minArea) continue;
    found.push({
      id,
      area: area[id],
      x0: b.x0, y0: b.y0,
      w: b.x1 - b.x0 + 1,
      h: b.y1 - b.y0 + 1
    });
  }

  // blocos anormalmente grandes = duas figuras que se encostam: tenta cortar
  const medArea = found.map(f => f.area).sort((a, b) => a - b)[Math.floor(found.length / 2)];
  const splitLimit = parseFloat(o['split-limit'] || 1.6);
  const splitOn = !o['no-split'];
  if (splitOn && found.length >= 4) {
    const queue = found.slice();
    const pieces = [];
    while (queue.length) {
      const f = queue.shift();
      if (f.area > medArea * splitLimit) {
        const two = splitOnce(fg, lab, w, f);
        if (two) { queue.push(two[0], two[1]); continue; }
      }
      pieces.push(f);
    }
    found.length = 0;
    found.push(...pieces);
  }

  // ordem de leitura: agrupa em linhas pela altura mediana
  if (!found.length) {
    console.error('nenhuma figura encontrada — tente --bg-tol maior ou --gap menor');
    process.exit(1);
  }
  const medH = found.map(f => f.h).sort((a, b) => a - b)[Math.floor(found.length / 2)];
  const rowTol = medH * 0.6;
  found.sort((a, b) => (a.y0 + a.h / 2) - (b.y0 + b.h / 2));
  const rows = [];
  for (const f of found) {
    const cy = f.y0 + f.h / 2;
    const last = rows[rows.length - 1];
    if (last && Math.abs(cy - last.cy) <= rowTol) { last.items.push(f); last.cy = (last.cy * (last.items.length - 1) + cy) / last.items.length; }
    else rows.push({ cy, items: [f] });
  }
  const ordered = [];
  for (const r of rows) { r.items.sort((a, b) => a.x0 - b.x0); ordered.push(...r.items); }

  // nomes vindos de arquivo, se houver
  let names = null;
  if (o.names && o.names !== true) {
    names = fs.readFileSync(o.names, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  console.log(`figuras: ${ordered.length}  (gap ${gap}px, área mínima ${minArea}px)`);

  let suspeitos = 0;
  const manifest = [];
  ordered.forEach((f, idx) => {
    const base = names && names[idx] ? slug(names[idx]) : `${name}-${String(idx + 1).padStart(2, '0')}`;
    const label_ = names && names[idx] ? names[idx] : `Figura ${idx + 1}`;

    // quadrado + respiro, sem sair da imagem
    const side = Math.max(f.w, f.h);
    const pad = Math.round(side * padFrac);
    const sq = side + pad * 2;
    let x = Math.round(f.x0 + f.w / 2 - sq / 2);
    let y = Math.round(f.y0 + f.h / 2 - sq / 2);
    x = Math.max(0, Math.min(w - sq, x));
    y = Math.max(0, Math.min(h - sq, y));
    const cw = Math.min(sq, w), ch = Math.min(sq, h);

    const px = resample(rgba, w, bg, { x, y, w: cw, h: ch }, size, lab, f.id);

    const file = base + '.png';
    manifest.push({ arquivo: file, nome: label_, box: [f.x0, f.y0, f.w, f.h] });

    const st = cutStats(fg, lab, w, f);
    const diag = `${(st.fill * 100).toFixed(0).padStart(3)}% preench, ` +
      `${st.islands} ilha${st.islands > 1 ? 's' : ''}` +
      (st.islands > 1 ? ` (maior ${(st.biggest * 100).toFixed(0)}%)` : '');
    if (st.islands > 1 || st.fill < 0.22) suspeitos++;

    if (dry) {
      console.log(`  ${file.padEnd(26)} ${f.w}x${f.h} @${f.x0},${f.y0}  ${diag}`);
    } else {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, file), encodePNG(px, size, size));
      console.log(`  ${file.padEnd(26)} ${f.w}x${f.h} -> ${size}x${size}  ${diag}`);
    }
  });

  if (!dry) {
    fs.writeFileSync(path.join(outDir, 'sprites.json'),
      JSON.stringify({ categoria: name, size, itens: manifest }, null, 2) + '\n');
    console.log(`\n${manifest.length} PNGs + sprites.json em ${path.relative(process.cwd(), outDir)}`);
    console.log('próximo passo: node tools/pack-stickers.js ' + path.relative(process.cwd(), outDir));
  } else {
    console.log('\n--dry-run: nada foi gravado');
  }
}

main();
