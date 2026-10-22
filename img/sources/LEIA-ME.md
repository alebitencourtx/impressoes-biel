# Pranchas de origem

Coloque aqui as imagens "com várias figuras" que servem de matéria-prima.
Elas **não** vão para o app: são só a entrada do recorte.

```bash
node tools/extract-sprites.js img/sources/eric-carle.jpg --name eric-carle --dry-run
node tools/extract-sprites.js img/sources/eric-carle.jpg --name eric-carle --size 200
node tools/pack-stickers.js img/stickers/eric-carle --embed
```

Guia completo: `FIGURINHAS.md` na raiz do projeto.
