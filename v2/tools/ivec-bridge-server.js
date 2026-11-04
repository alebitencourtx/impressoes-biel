// Servidor local do impressao-biel-v2 (notebook, modo teste)
// - serve www/ estático em http://localhost:8011/
// - POST /print  { b64, settings } → fala IVEC byte-a-byte com a G3010 (TCP 9100)
// IVEC capturado do Easy-PhotoPrint (targets/canon-g3010/IVEC-EXACT-PROTOCOL.md):
// StartJob → SetConfiguration → SendData(format=JPEGPAGE, datasize=N) → <JPEG> → EndJob
const http = require("http");
const fs = require("fs");
const path = require("path");
const net = require("net");

const PORT = 8011;
const WWW = path.join(__dirname, "..", "www");
const DEFAULT_PRINTER = "192.168.1.11";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };

function serveStatic(req, res) {
  let url = (req.url || "/").split("?")[0];
  if (url === "/") url = "/index.html";
  const file = path.normalize(path.join(WWW, url));
  if (!file.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

function ivecPrint(b64, settings, cb) {
  let jpeg;
  try { jpeg = Buffer.from(b64, "base64"); }
  catch (e) { cb({ ok: false, error: "base64 inválido: " + e.message }); return; }

  const s = Object.assign({}, settings || {});
  const printerIp = s.printerIp || DEFAULT_PRINTER;
  const jobID = "00000002";
  const uid = "nodebridge-" + Date.now().toString(16);

  const q = (t) => `<?xml version="1.0" encoding="utf-8" ?>`.concat(t);

  const startJob = q(`<cmd xmlns:ivec="http://www.canon.com/ns/cmd/2008/07/common/" xmlns:vcn="http://www.canon.com/ns/cmd/2008/07/canon/"><ivec:contents><ivec:operation>StartJob</ivec:operation><ivec:param_set servicetype="print"><ivec:jobID>${jobID}</ivec:jobID><ivec:bidi>1</ivec:bidi><ivec:jobname/><ivec:username/><ivec:computername/><ivec:job_description><![CDATA[${uid}]]></ivec:job_description><vcn:host_environment>android</vcn:host_environment></ivec:param_set></ivec:contents></cmd>`);
  const setConf = q(`<cmd xmlns:ivec="http://www.canon.com/ns/cmd/2008/07/common/" xmlns:vcn="http://www.canon.com/ns/cmd/2008/07/canon/"><ivec:contents><ivec:operation>SetConfiguration</ivec:operation><ivec:param_set servicetype="print"><ivec:jobID>${jobID}</ivec:jobID><ivec:papersize>${s.papersize || "iso_a4_210x297mm"}</ivec:papersize><ivec:papertype>${s.papertype || "custom-media-type-canon-3"}</ivec:papertype><ivec:borderlessprint>${s.borderless || "OFF"}</ivec:borderlessprint><ivec:printcolormode>${s.printcolormode || "color"}</ivec:printcolormode><ivec:printquality>${s.printquality || "best"}</ivec:printquality><vcn:capm_info><vcn:papergap_capm>auto</vcn:papergap_capm><vcn:loadingmediatype_capm>auto</vcn:loadingmediatype_capm></vcn:capm_info></ivec:param_set></ivec:contents></cmd>`);
  const sendData = q(`<cmd xmlns:ivec="http://www.canon.com/ns/cmd/2008/07/common/"><ivec:contents><ivec:operation>SendData</ivec:operation><ivec:param_set servicetype="print"><ivec:jobID>${jobID}</ivec:jobID><ivec:format>JPEGPAGE</ivec:format><ivec:datasize>${jpeg.length}</ivec:datasize></ivec:param_set></ivec:contents></cmd>`);
  const endJob = q(`<cmd xmlns:ivec="http://www.canon.com/ns/cmd/2008/07/common/"><ivec:contents><ivec:operation>EndJob</ivec:operation><ivec:param_set servicetype="print"><ivec:jobID>${jobID}</ivec:jobID></ivec:param_set></ivec:contents></cmd>`);

  const socket = net.connect(9100, printerIp);
  const chunks = [];
  socket.setTimeout(15000);
  socket.on("connect", () => {
    socket.write(startJob);
    socket.write(setConf);
    socket.write(sendData);
    socket.write(jpeg);
    socket.write(endJob);
    socket.end();
    console.log(`[IVEC] enviado para ${printerIp}:9100 — JPEG ${jpeg.length} bytes; conf:`, JSON.stringify(s));
  });
  socket.on("data", d => { chunks.push(d); });
  socket.on("timeout", finish);
  socket.on("close", finish);
  socket.on("error", e => finish(e));
  let done = false;
  function finish(err) {
    if (done) return; done = true;
    try { socket.destroy(); } catch (_) { }
    const reply = Buffer.concat(chunks).toString("utf8").replace(/[^\x20-\x7e]/g, " ").slice(0, 400);
    console.log("[IVEC] resposta:", reply || "(vazia)", err ? ("ERRO: " + err.message) : "");
    cb({ ok: !err, error: err ? err.message : null, reply });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "POST" && (req.url === "/print")) {
    let body = [];
    req.on("data", c => body.push(c));
    req.on("end", () => {
      let js;
      try {
        js = JSON.parse(Buffer.concat(body).toString("utf8"));
      } catch (e) { res.writeHead(400); res.end("bad json"); return; }
      ivecPrint(js.b64, js.settings, (result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      });
    });
    return;
  }
  serveStatic(req, res);
});
server.listen(PORT, "0.0.0.0", () => console.log(`IMpressão v2 (Modo teste IVEC) em http://localhost:${PORT}/ — impressora ${DEFAULT_PRINTER}:9100`));
