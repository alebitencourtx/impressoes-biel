# Como reduzir imagens (futuras figurinhas/fotos)

## Figurinhas Patchwork (embutidas offline)

As 33 figurinhas Patchwork vivem no bloco `window.OFFLINE_PATCHWORK` no fim do `<body>` do `index.html`, em base64. Para reencodar/otimizar:

1. Instalar ferramentas (uma vez):
   ```sh
   apk add libwebp-tools
   ```
2. Garantir que `index.html` já tenha o bloco `window.OFFLINE_PATCHWORK = {...};`.
3. Rodar:
   ```sh
   node tools/encode-figurinhas.js            # aplica
   node tools/encode-figurinhas.js --dry-run  # só mostra, não altera
   ```
   O script:
   - decodifica cada PNG/WebP embutido,
   - recomprime para WebP com `cwebp` (-m 6, -sharp_yuv),
   - testa qualidades 80..98 e para na primeira com **PSNR ≥ 42 dB** (imperceptível até na impressão),
   - regrava o bloco e reporta `index.html: X MB -> Y MB`.

Para adicionar uma nova figurinha:
- Coloque o PNG original em `img/stickers/patchwork/<nome>.png`.
- Adicione entrada ao array `PATCHWORK` em `index.html` (campo `arquivo`).
- Embuta o PNG como base64 no bloco `OFFLINE_PATCHWORK` (chave `<nome>.png`).
- Rode `node tools/encode-figurinhas.js` para converter para WebP.

## Fotos do usuário

Já otimizadas automaticamente em `downscalePhoto()`:
- redimensiona por escala adaptativa (canvas, `imageSmoothingQuality='high'`);
- PNG/WebP com transparência → PNG; demais → JPEG com `PHOTO_QUALITY`;
- mantém o original se a versão processada não for menor.

Para ajustar: edite `PHOTO_QUALITY` e a lógica de escala em `downscalePhoto()`.

## Dicas gerais

- Prefira WebP para assets embutidos (menor que PNG/JPEG a qualidade equivalente).
- Sempre medir PSNR (≥ 42 dB) antes de trocar qualidade.
- Não commitar binários grandes em `img/`; embutir em base64 via script.
- Bumpar `CACHE_NAME` no `sw.js` após mudanças grandes para forçar atualização offline.
