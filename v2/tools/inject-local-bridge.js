// Injeta a rota de teste via servidor local na printPage() do index.html e replica para www/ e assets.
const fs = require("fs");
const FILE = "C:/Users/alebi/rea/impressao-biel-v2/index.html";
let s = fs.readFileSync(FILE, "utf8");

const anchor = "    const prevSelected = state.selectedId;";
if (!s.includes(anchor)) { console.error("âncora não encontrada"); process.exit(1); }

const bridge = (
`    if (typeof window.CanonIvec === 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      const mm = { a4: [210, 297], letter: [216, 279], '4x6': [102, 152] }[String(state.pageSize || 'a4').toLowerCase()] || [210, 297];
      const b64 = await exportBase64(qualityJpeg);
      const mediaKeyword = ({ a4: 'iso_a4_210x297mm', letter: 'na_letter_8.5x11in', '4x6': 'na_index-4x6_4x6in' })[String(state.pageSize || 'a4').toLowerCase()] || 'iso_a4_210x297mm';
      const ivecQuality = { 1: 'auto', 2: 'best', 3: 'standard', 4: 'draft' }[printSettings.quality] || 'auto';
      const settings = { printerIp: printSettings.printerIp || '192.168.1.11', papersize: mediaKeyword,
        papertype: printSettings.mediaType === 1 ? 'custom-media-type-canon-1' : 'custom-media-type-canon-3',
        borderless: printSettings.borderless ? 'ON' : 'OFF', printcolormode: 'color',
        printquality: ivecQuality, copies: printSettings.copies || 1 };
      const r = await fetch('/print', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ b64, settings }) });
      const j = await r.json();
      alert(j.ok ? 'IVEC enviado: ' + (j.reply || 'ok') : 'Falha no IVEC: ' + (j.error || j.reply || 'desconhecida'));
      return;
    }
` + anchor);

s = s.replace(anchor, bridge);
fs.writeFileSync(FILE, s);
fs.copyFileSync(FILE, "C:/Users/alebi/rea/impressao-biel-v2/www/index.html");
fs.copyFileSync(FILE, "C:/Users/alebi/rea/impressao-biel-v2/android/app/src/main/assets/public/index.html");
console.log("bridge local injetada em printPage(); replicado para www/ e assets/");
