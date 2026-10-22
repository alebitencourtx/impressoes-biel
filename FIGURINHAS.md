# Figurinhas: da prancha ao app

Como transformar **uma imagem com vários desenhos** (prancha / *sprite sheet*) em
figurinhas individuais prontas para o editor, sem trabalho manual de recorte.

```
prancha.jpg ──▶ extract-sprites.js ──▶ pasta de PNGs 360×360 (fundo transparente)
                                     ──▶ sprites.json (nome + caixa de cada figura)
                                     ──▶ pack-stickers.js ──▶ WebP + blob OFFLINE_* + array da categoria
```

## 1. Recortar a prancha

```bash
node tools/extract-sprites.js img/sources/eric-carle.jpg --name eric-carle
```

Saída padrão: `img/stickers/eric-carle/` com `eric-carle-01.png` … e `sprites.json`.

O script, em ordem:

1. **Normaliza** qualquer entrada (JPG, WebP, PNG indexado, 16-bit) para PNG RGBA
   8-bit usando o `magick` do ImageMagick.
2. **Acha o fundo** por inundação a partir das quatro bordas: só o branco (ou o
   alfa 0) *conectado ao lado de fora* vira transparente. Branco no meio do
   bicho — barriga do pinguim, olho do urso — continua opaco.
3. **Dilata** o que sobrou e rotula os componentes conexos. A dilatação junta
   partes que se tocam por pouco (pata, asa, antena, rabo) num bicho só, sem
   grudar figuras que estão separadas.
4. **Recorta** a caixa de cada figura, deixa quadrada com respiro e reamostra
   para o lado final com alfa pré-multiplicado (sem franja branca na borda).
5. Grava **PNG + `sprites.json`**, na ordem de leitura da prancha
   (linha por linha, da esquerda para a direita).

### Ajustes que você vai querer usar

| Opção | Para quê |
|---|---|
| `--gap <px>` | Aumente se uma figura sair partida em duas (perna solta). Diminua se dois bichos grudarem num só. |
| `--open <px>` | Abertura morfológica antes da dilatação: corta pontes finas de JPEG. |
| `--split-limit <x>` | Um bloco com mais de `x` × a área mediana é suspeito de ser **dois bichos encostados**; o script procura a linha de menor espessura (o "pescoço") e corta ali. Padrão 1,6. Suba para cortar menos, desça para cortar mais. |
| `--no-split` | Desliga o corte por pescoço. |
| `--bg-tol <0-255>` | Fundo não é branco puro (papel amarelado, sombra clara): suba para 40–60. |
| `--min-area <frac>` | Some com pontinhos de sujeira/ruído (padrão descarta 0,12% da área). |
| `--pad <frac>` | Respiro em volta da figura dentro do quadrado. |
| `--size <px>` | Lado final. Veja a nota de resolução abaixo. |
| `--names lista.txt` | Um nome por linha, na ordem de leitura — vira o nome exibido no app. |
| `--dry-run` | Só lista as caixas detectadas, não grava nada. **Use primeiro.** |

Fluxo recomendado: rode `--dry-run`, confira a contagem de figuras e as caixas,
ajuste `--gap`/`--bg-tol`, e só então rode de verdade.

### Resolução: não exagere no `--size`

O tamanho final não cria detalhe que a prancha não tem. Regra prática:
**meça a maior figura da prancha em pixels e use no máximo 2× esse valor.**

Uma prancha de 675×1200 com ~35 animais dá figuras de ~110 px; gerar em 360
significa ampliar 3× — fica borrado na impressão. Para esse caso use
`--size 200` (ou consiga a prancha original em resolução maior, que é sempre
melhor).

Referência atual do app: o Patchwork usa **360×360**.

## 2. Empacotar para o app

```bash
node tools/pack-stickers.js img/stickers/eric-carle --embed
```

O que ele faz:

- recomprime cada PNG em **WebP** e procura a **menor qualidade que ainda dê
  PSNR ≥ 42 dB** contra o original (imperceptível até na impressão, mesma meta
  do `encode-figurinhas.js` do Patchwork). A busca é adaptativa: começa em q90 e
  anda em passos grandes para o lado certo — 2 a 3 compressões por figura em vez
  de 10 (30 figurinhas: ~11 min → ~25 s);
- mantém o **canal alfa** (`-alpha_q 100`), então o fundo recortado continua
  transparente;
- grava `<categoria>.array.js` com o array pronto para colar no `index.html`;
- com `--embed`, injeta (ou substitui) `window.OFFLINE_<CATEGORIA>` no
  `index.html`, antes de `</body>`, igual ao `OFFLINE_PATCHWORK`.

Ganho típico: **WebP ≈ 14% do tamanho dos PNGs**.

### Receita real (categoria Eric Carle)

```bash
# 1. olhar antes de gravar
node tools/extract-sprites.js img/sources/eric-carle.jpg --name eric-carle --dry-run

# 2. prancha de 675x1200 com ~31 animais de ~150 px → 240 px é 1,6x, sem borrar
node tools/extract-sprites.js img/sources/eric-carle.jpg \
     --name eric-carle --size 240 --gap 0 --open 0

# 3. empacotar medindo PSNR e embutir o blob
node tools/pack-stickers.js img/stickers/eric-carle --cat eric-carle --size 240 --embed
```

Resultado: **30 figurinhas**, 2,57 MB de PNG → **0,56 MB** de WebP (22%),
`index.html` de 1,25 MB → 2,04 MB. O `sprites.json` mostra `preench` (quanto da
caixa a figura ocupa) e `ilhas` por recorte — **ilhas > 1** ou `preench` muito
baixo é sinal de corte ruim; ajuste `--gap`/`--split-limit` e rode de novo.

`img/sources/` e `img/stickers/` estão no `.gitignore`: o repositório guarda só o
blob embutido, não a prancha original (que costuma ter direitos autorais).

## 3. Ligar a categoria no editor

O app lê as figurinhas de duas fontes que precisam casar:

```js
const PATCHWORK_DIR = 'img/stickers/patchwork/';
const PATCHWORK = [ { arquivo: "coruja-laranja.png", nome: "Coruja laranja" }, … ];
```

e, no fim do `<body>`, o blob:

```js
window.OFFLINE_PATCHWORK = { "coruja-laranja.png": "data:image/webp;base64,…" };
```

Para uma categoria nova, são **três passos** (o exemplo é a categoria Eric Carle,
já no ar):

1. `const ERIC_CARLE_DIR = 'img/stickers/eric-carle/';` + `const ERIC_CARLE = […]`
   (conteúdo de `eric-carle.array.js`);
2. registrar a categoria em `STICKERS`, com o `dir` dela:

   ```js
   'Eric Carle': { tipo: 'imagem', dir: ERIC_CARLE_DIR, itens: ERIC_CARLE },
   ```

   A lista de abas é gerada de `Object.keys(STICKERS)` e `addStickerImage()`
   monta o caminho com o `dir` da categoria — não precisa mexer em mais nada;
3. acrescentar `'OFFLINE_ERIC_CARLE'` em **`OFFLINE_MAPS`** e deixar o `--embed`
   criar o blob (`window.OFFLINE_ERIC_CARLE = {…}`).

Regras que não mudam:

- `OFFLINE_MAPS` é a **única** lista de blobs: `figurinhasData()` funde todos num
  mapa só (`nome-do-arquivo → data URL`), então dois arquivos com o mesmo nome em
  categorias diferentes colidem — prefixe os nomes (`eric-carle-01.webp`);
- o item guarda **o caminho**, nunca o data URL (senão estoura a cota do
  `localStorage`); na hora de desenhar, `figurinhaSrc()` / `offlineFigurinhaSource()`
  troca o caminho pelo data URL do blob pelo nome do arquivo;
- **o blob é lido em tempo de uso, nunca no topo do script** — o app começa antes
  de o blob chegar, e `onFigurinhasReady()` resolve isso.

## 4. Problemas comuns

| Sintoma | Causa | Saída |
|---|---|---|
| Uma figura virou duas | Parte solta além do `--gap` | Suba `--gap` |
| Dois bichos num só | Estão mais perto que o `--gap` | Desça `--gap` |
| "fundo tomou conta da imagem inteira" | Fundo escuro/colorido | Use uma prancha com fundo claro, ou `--bg-tol` baixo |
| Borda branca na figura | Fundo não é branco puro | Suba `--bg-tol` |
| Figura virou fatia fina | O corte por pescoço errou o lugar | Use `--no-split` ou suba `--split-limit` |
| `magick: not found` | Sem ImageMagick | `apk add imagemagick` |
| `cwebp: not found` | Sem libwebp | `apk add libwebp-tools` |

## 5. Scripts antigos (ainda válidos)

- `tools/encode-figurinhas.js` — reencoda o que **já está embutido** no
  `index.html` (Patchwork), sem mexer nos recortes.
- `tools/report-figurinhas.js` — mede PSNR/tamanho do que está embutido.
- `tools/pngcodec.js` — decodificador/encodificador PNG em Node puro.
