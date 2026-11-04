// Corrige a ordem do socket: connect() antes de getInputStream(); fecha no finally.
const fs = require("fs");
const f = "C:/Users/alebi/rea/impressao-biel-v2/android/app/src/main/java/com/ecoprints/clone/CanonIvecBridge.java";
let t = fs.readFileSync(f, "utf8");

const oldBlock =
`        try (Socket socket = new Socket();
             InputStream in = socket.getInputStream()) {
            socket.connect(addr, 8000);`;

const newBlock =
`        Socket socket = new Socket();
        try {
            socket.connect(addr, 8000);`;

if (!t.includes(oldBlock)) { console.error("bloco old não encontrado"); process.exit(1); }
t = t.replace(oldBlock, newBlock);

const anchorEnd =
`            notifyJs(ok, "IVEC datasize=" + jpeg.length + " resposta:" + (e.length() > 220 ? e.substring(0, 220) : e));
        }
`;

const fixedEnd =
`            notifyJs(ok, "IVEC datasize=" + jpeg.length + " resposta:" + (e.length() > 220 ? e.substring(0, 220) : e));
        } finally {
            try { socket.close(); } catch (Throwable tt) { }
        }
`;

if (!t.includes(anchorEnd)) { console.error("âncora final não encontrada"); process.exit(1); }
t = t.replace(anchorEnd, fixedEnd);
fs.writeFileSync(f, t, "utf8");
console.log("socket patch ok");
