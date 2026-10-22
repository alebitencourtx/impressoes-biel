# Impressao-Biel

- App de página única: tudo (CSS, JS, html2canvas inline) vive em `index.html`. Não há build nem dependências — basta abrir o arquivo / usar preview estático.
- Folha A4 medida em **mm**. O emoji (`type: 'sticker'` sem `src`) **não guarda** tamanho de fonte: `emojiFit()` deriva a fonte de `w`/`h` medindo a tinta real do glifo (`canvas.measureText` → `actualBoundingBox*`) e centraliza com `translateY`. Multiplica por `PATCHWORK_SCALE = 1.35` para igualar o tamanho total da figurinha Patchwork (que recebe `scale(1.35)`). Por isso o emoji preenche a caixa e escala com ela.
- O arrasto de redimensionar usa **apenas `paintGeometry`** (não recria o nó): qualquer propriedade que dependa da caixa precisa ser reaplicada ali — é o caso do `font-size` do emoji (via `paintEmojiFont`). Sem isso, só a `<img>` (que escala por CSS) acompanhava o gesto.
- Figurinha Patchwork (PNG embutido em `OFFLINE_PATCHWORK`, RGB sem alfa, 360×360) recebe `scale(1.35)` e ocupa a caixa inteira; o emoji é ajustado para preencher a mesma caixa.
- Estado em `localStorage`; em `load()` os campos antigos `fontSize`/`furatio` do emoji são descartados.
