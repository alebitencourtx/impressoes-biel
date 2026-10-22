# Impressao-Biel

- App de página única: tudo (CSS, JS, html2canvas inline) vive em `index.html`. Não há build nem dependências — basta abrir o arquivo / usar preview estático.
- Folha A4 medida em **mm**. O emoji (`type: 'sticker'` sem `src`) **não guarda** tamanho de fonte: `emojiFit()` deriva a fonte de `w`/`h` e a centraliza com `translate(dx, dy)`, de modo que a **tinta** do glifo preencha a caixa (~98%) sem ser cortada.
- Medir o emoji: `measureEmoji()` desenha o glifo num canvas 4×REF e varre os pixels pintados. **Não usar `measureText().actualBoundingBox*`** — em fontes de emoji ele devolve uma caixa quadrada (1.18em) em vez da tinta, e o resultado estoura a caixa (emoji cortado).
- O texto é centralizado pelo *advance* (caixa da fonte), e a tinta do emoji é assimétrica (o 🐶 vaza ~0,08em à direita): por isso a medição é relativa à origem do texto e o `dx` corrige o centro.
- O arrasto de redimensionar usa **apenas `paintGeometry`** (não recria o nó): qualquer propriedade que dependa da caixa precisa ser reaplicada ali — é o caso do `font-size`/transform do emoji (via `paintEmojiFont`).
- Figurinha Patchwork (PNG embutido em `OFFLINE_PATCHWORK`, RGB sem alfa, 360×360, arte de ponta a ponta) recebe `scale(1.35)` e preenche a caixa inteira; o emoji foi calibrado para o mesmo tamanho total **sem** corte (não aplicar zoom no emoji).
- Estado em `localStorage`; em `load()` os campos antigos `fontSize`/`fu`/`fsRatio` do emoji são descartados.
