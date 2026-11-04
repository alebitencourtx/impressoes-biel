> # Impressão Biel v2 — branch `feat/v2-ivec-canon`
> Este folder é o “apartado v2” do app Impressão-Biel, colocado no mesmo repositório
> (github.com/alebitencourtx/impressoes-biel) mas **num branch separado** para não tocar a main.
>
> Leia `DOCUMENTACAO-v2.md` para tudo: descobertas, IVEC byte-a-byte, evidências e passos.
>
> Arquivos principais neste branch:
> - `v2/DOCUMENTACAO-v2.md` — documentação completa
> - `v2/index.html` — app v2 (clone da v1 + painel “Configurações de impressão avançadas”)
> - `v2/sw.js`, `v2/manifest.webmanifest`
> - `v2/tools/ivec-bridge-server.js` — servidor de notebook (http://localhost:8011)
> - `v2/android-src/CanonIvecBridge.java` + `v2/android-src/MainActivity-patch.txt`
>   (fontes Android do plugin IVEC — gerado com Gradle fora deste repo)
> - `v2/android-src/BielPrintService.java` (protótipo não finalizado do serviço de impressão)
> - `v2/android-src/AndroidManifest-patch.txt` ( trecho do service )
>
> APK pronto (não versionado aqui): `rea/impressao-biel-v2/impressao-biel-v2.apk` (10.8 MB).
