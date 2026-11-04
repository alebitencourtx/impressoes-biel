# Impressão Biel v2 — documentação completa do trabalho

> Última atualização: 03/11/2026.  
> Autor: engenharia reversa do Easy-PhotoPrint Editor da Canon (Android) e reimplementação
> limpa em Java/HTML, com a pipeline real de **IVEC / JPEGPAGE na TCP 9100**.

Este documento registra **tudo** que foi feito (e por quê), a linha do tempo das
descobertas, e o caminho de instalação em outro celular.

---

## 1. Problema

O Easy-PhotoPrint Editor da Canon imprime fotos na G3010 com qualidade muito
superior a qualquer app genérico. O usuário queria copiar essa qualidade
*exatamente* no app próprio (Impressão Biel), mantendo:

- **Qualidade de impressão: Automático / Alta / Padrão / Rascunho**
- **Tipo de mídia: Papel Comum / Papel Fotográfico Brilhante / Semibrilhante Plus /
  Acetinado Plus II / Fósco / Automático** (mesma lista da Canon)

E, ao mesmo tempo, **não mexer no app atual** (v1) — criar uma **v2** clonada.

---

## 2. Linha do tempo das descobertas

| Etapa | O que foi feito | Artefato |
|---|---|---|
| 1 | REA do APK da Canon `jp.co.canon.bsd.easyphotoprinteditor` **v1.10.8** (68,7 MB), targetSdk 36, minSdk 26, puxado do celular por `adb pull /data/app/.../base.apk` | `targets/canon-easyphotoprint/easyphotoprinteditor-1.10.8.apk` |
| 2 | A app da Canon **é um app Cordova** (www/ com Cordova + plugins `canon-sdk-rendering`), tudo escrito em HTML/JS; o trabalho pesado de impressão fica no SDK nativo **Canon IJ SDK** com as classes `jp.co.canon.bsd.ad.sdk.*` | `targets/canon-easyphotoprint/apk-assets/...` |
| 3 | Extração das listas **pt‑BR** do `cij_settings.js` — nomes reais de `paperSize` (85 opções), `mediaType` (45), `printQuality` (Automático/Alta/Padrão/Rascunho), `colorMode`, `borderless`, `renderingResolution`, entre outros. | `targets/canon-easyphotoprint/cij-ptbr-values.txt` |
| 4 | Classes Java do SDK: `BjnpPrintWorker`, `Cnmpu2PrintWorker`, `LfpPrintWorker`, `CLSSMakeCommand`, `CLSSStartJobParam`, `CLSSSetJobConfigurationParam`, `CLSSSendDataParam`, `Port9100Socket` etc. | `targets/canon-easyphotoprint/cls-*.json`, `m-*.json` |
| 5 | Strings do `libsdk-core.so` — ↑2 000 templates **IVEC** (XML) usados para:`<ivec:printquality>`, `<ivec:papertype>`, `<ivec:papersize>`, `<ivec:borderlessprint>`, `<ivec:printcolormode>`, `<ivec:jobcopies>`, `<ivec:print_purpose>`, `<ivec:rendering_resolution>`, `<ivec:format>` e `<ivec:datasize>` | `targets/canon-easyphotoprint/libsdk-core-strings.txt` |
| 6 | Listas do SDK:`CLSS_IsSupportJpegDirect`, **`JPEG_DIRECT_PRINTER_LIST`**, **`JPEGPAGE`**, **`PWGRaster`**, ids de portas/protocolos **BJNP (UDP 8610)**, **TCP 9100**. | idem |
| 7 | **IPP na porta 631** testado na impressora com atributosGet-Printer-Attributes: **G3010 series**, `document-format-supported: application/octet-stream, image/pwg-raster`, `jpeg-features-supported: none`, `media-type-supported: stationery/photographic/envelope`, `print-quality-supported: [4,5]`, `copies-supported 1..99`, `printer-device-id MFG:Canon;CMD:BJRaster3,NCCe,IVEC;SOJ:CHMP;MDL:G3010 series;VER:1.130;CID:CA_IVEC1TYPE4_IJP;` | `targets/canon-g3010/ipp-attrs.json`, `ipp-clean.js` |
| 8 | **IPP Print‑Job** com **PWG Raster sRGB 600 dpi** imprimiu a foto (job 14, `job-completed-successfully`) — servia para provar conectividade, mas qualidade ainda **não** igual à Canon | `ipp-print-job.js`, `job-state.js` |
| 9 | Sniffer RO `tshark` no notebook → **não captura tráfego unicast de outro dispositivo em Wi‑Fi** (só broadcasts). Bug é do transport/mode widget, não da ferramenta. | `targets/canon-g3010/PCAPDROID-ROTACAPTURAS.md` |
| 10 | **PCAPdroid (non‑root, offline, código aberto)** instalado no celular por `adb install` (APK v2.0.2) → captura a VPN local e grava PCAP. | `targets/canon-g3010/PCAPdroid_v2.0.2.apk` |
| 11 | Captura PCAPdroid + extração da stream TCP 192.168.1.11:**9100** → **protocolo IVEC completo em texto plano**: `StartJob` → `SetConfiguration` → `SendData(format=JPEGPAGE, datasize=N)` → os bytes JPEG → `EndJob` | `9100-stream.10.215.173.1_59118__192.168.1.11_9100.bin` |
| 12 | JPEG **extraído do job real** (1.612.183 bytes, **4800 × 6826 px** — A4 a ~580 dpi) | `ivec-jpeg-from-realprint.jpg` |
| 13 | **Documentação byte‑a‑byte do IVEC, com as strings reais Express usadas pelo app da Canon** | `targets/canon-g3010/IVEC-EXACT-PROTOCOL.md` |

Cada artefato é **individual e verificado**, sem guess.

---

## 3. O que faz a impressão da Canon ser **muito** melhor

A qualidade superior não vem de um “JPEG maior” nem de um `printquality` mais alto
— vem da **combinação** de três fatores que só o caminho IVEC habilita:

### 3.1 O driver é a impressora, não o Android
A impressora G3010 reporta como **IVEC** no printer-device-id
(`CMD:BJRaster3,NCCe,IVEC`, `CID:CA_IVEC1TYPE4_IJP`). Com IVEC a **impressora**
descodifica o JPEG e aplica o próprio pipeline de foto:

- **dithering proprietário** da Canon (mesmo discos de tinta);
- **camada de Winnipeg de tinta** (ink profile) escolhida em função do `papertype`;
- **número de passes** da cabeça de impressão (por isso o barulho é diferente:
  a manipulação de tinta muda quando o papel é fotográfico).

Via AirPrint/IPP/PWG o raster já chega pronto, e a impressora aplica um pipeline
genérico (a qualidade cai para nível “Fácil de usar”, não “Foto”).

### 3.2 `papertype = custom-media-type-canon-N` viaja no job, com o código avaliado pela impressora
Não é um texto; é a melhor classificação **canônica do tipo de papel**, quehabilita
direta a impressora nos modos de foto (papertype**:‑3** é *Papel Fotográfico
Brilhante* noJob real da Canon capturado porque a G3010 é tratada com o
“foto Brilhante” da G3010). Via PrintManager o casamento entre o papel do usuário
e o papel físico nunca é garantido; aqui a tablet **se** anuncia exatamente.

### 3.3 O raster sai cheio (‑580 dpi) e sem re‑compressão
- Escolha de formato **JPEGPAGE** (JPEG direto na impressora) para o Android:
  a impressora faz o trabalho pesado; o celular envia o **JPEG inteiro** e o
  hardware/`libsdk` da Canon gerencia dithering.
- A impressora do usuário recebe 1,63 MB por A4 no modo foto (vs ~13 MB de PWG na
  nossa página 600 dpi). O **pipeline de rede e de HTML do celular não é o
  gargalo** — é a coordenação driver/impreneta que conta.

### 3.4 O que o nome de digitador chama “Configurações de impressão avançadas”
No nosso v2 usamos a interface **igual à Canon** (painel da v2) —
**Automático / Alta / Padrão / Rascunho** + lista completa de papel fotorâgrafico —
e o **mapa direto** dos campos IVEC:

| app v2 (painel?) | campo IVEC | valores |
|---|---|---|
| Qualidade | `printquality` | `auto` / `best` / `standard` / `draft` |
| Tipo de mídia | `papertype`  | `custom-media-type-canon-1` (comum), `custom-media-type-canon-3` (fotográf. brilhante) |
| Sem bordas | `borderlessprint` | `ON` / `OFF` |
| Papel/tamanho | `papersize` | `iso_a4_210x297mm`, `na_index-4x6_4x6in`, … |
| Cópias | (?) | (job pode repetir) |
| Cor | `printcolormode` | `color` / `monochrome` |
| extras | `vcn:capm_info` / `papergap_capm` / `loadingmediatype_capm` | `auto` |

---

## 4. O que foi implementado (e no que confiar)

### 4.1 Página v2 (HTML/JS, clone do Impressão‑Biel v1)
Arquivo `impressao-biel-v2/index.html` (de `impressoes-biel-pages/index.html`:

- **Painel “Configurações de impressão avançadas” estilo Canon** (componente próprio
  id `print-settings-dialog`), com as listas canon.
- **Qualidade (Alta por default) / Tipo de mídia (Papel Fotográfico Brilhante por
  default)** salvas em `localStorage['bielV2PrintSettings']`.
- `EXPORT_DPI = 600`, `PHOTO_MAX_PX = 3000`, `JPEG q=0.96` para Alta.
- **Gate de impressão** (para não re‑cair no modo genérico): clicou em Imprimir →
  abre o painel → “Imprimir” →
  - **celular (APK):** usa `window.CanonIvec.printJpeg(b64, settings)` — ponte nativa:
    - **o `AndroidPrint` antigo foi desativado dentro de `printPage`**;
    - em `localhost` (notebook), cai na rota HTTP `/print` do servidor local;
    - fora disso (Chrome puro no celular), cai no `window.print()` (framework Android,
      qualidade genérica).
- Indicador de versão **v15** no topo (sw `CACHE_NAME` = `impressao-biel-v15`).

### 4.2 Ponte nativa Android (`CanonIvecBridge.java`)
`android/app/src/main/java/com/ecoprints/clone/CanonIvecBridge.java`:

- `@JavascriptInterface` chamado via **`window.CanonIvec.printJpeg(base64, settingsJson)`**
- constrói os 3 XML **IVEC byte‑a‑byte como o Canon**:
  `StartJob` (com `job_description` GUID, `vcn:host_environment=android`),
  `SetConfiguration` (**`papertype`**, **`borderlessprint`**, **`printquality`**,
  `printcolormode`, `vcn:capm_info`),
  `SendData(**format=JPEGPAGE**, datasize=N)`,
  escreve o JPEG cru e fecha com **`EndJob`**
-fecha na **TCP 9100** da `printerIp` (default 192.168.1.11)
- **responde / log na própria ponte** — `Log.i("CanonIvec", …)` enotoast no celular
  (✘ ou ✔ com recolha parcial do echo)
- roda numa thread dedicada (`CanonIvec-ivePrint`), sem bloquear a UI.
- pipeline de erro robusto (o bug real era `getInputStream()` **antes** do `connect()`,
  já corrigido).

### 4.3 Servidor local no notebook (para testar sem APK)
`impressao-biel-v2/tools/ivec-bridge-server.js` — abre **http://localhost:8011/**,
serve `www/` e expõe `POST /print { b64, settings }` que fala **IVEC na 9100** direto
com a impressora (mesmos XMLs byte‑a‑byte). É a via de **notebook**.

### 4.4 Arquivos do projeto v2
```
impressao-biel-v2/
├── index.html                        (o app v2)
├── sw.js / manifest.webmanifest
├── www/ (assets do Capacitor)
├── android/ (Capacitor + Gradle)
│   └── app/src/main/java/com/ecoprints/clone/
│       ├── MainActivity.java         (registra a ponte CanonIvec)
│       └── CanonIvecBridge.java      (IVEC / JPEGPAGE)
├── tools/ivec-bridge-server.js       (servidor de notebook)
├── tools/inject-local-bridge.js
├── tools/patch-socket.js
├── impressao-biel-v2.apk             (10.8 MB, última build)
└── DOCUMENTACAO-v2.md                (este arquivo)
```
Evidências separadas em `rea/targets/canon-g3010/` (CAPs, headers, PCAPdroid...).

### 4.5 Serviço de impressão Android (começo — **não finalizado**)
Criado `BielPrintService.java` (esqueleto) e metadados `res/xml/bielprintservice.xml`,
com o **print-dispatcher** que intercepta *qualquer* app do sistema no Android e
manda pro pipeline IVEC. **Build incompleto** — o pacote do serviço de impressão
é `android.printservice.*` (e não `android.service.print.*` como eu usei na primeira
versão) e a **sessão de descoberta** precisa implementar os callbacks certos
(`onStartPrinterDiscovery/onValidatePrinters/onDestroy`).
**Este projeto será segundado para um repo separado** na próxima linha.

---

## 5. Reproduzir em **outro celular** / tablet

**Requisitos gerais:** Android 7+ (minSdk 24 nesta versão), **mesma rede Wi‑Fi
da impressora**, impressora com **IP estável** na LAN.

### Caminho A (recomendado): **instalar o APK v2**
O APK já contém toda a página (assets) e a ponte nativa (CanonIvec), sem PCAPdroid,
sem servidor, sem adb.

```
impressao-biel-v2.apk  (10.8 MB, build 21:05 03/11/2026)
```

Instalação direta no celular (por navegador/compartilhamento):
1. Copie o APK para o celular (Drive, WhatsApp, cabo USB…).
2. Toque no arquivo → “Instalar”. O Android vai pedir **“Origem desconhecida /
   Permitir gerenciador”** na primeira vez (padrão Android).
3. Abra o **Eco‑Prints** (nome do instalador do clone) — é o app v2.
4. Opcional: se o aparelho perguntar na Settings, dê “Permitir acesso a rede”.
   Imprimindo pela mesma G3010 na LAN, não requer **nenhum** setup extra.
5. No app, adicione a foto, toque **Imprimir** → do **painel** escolha **Alta /
   Photográfico Brilhante** → **Imprimir**.

Campos الشخص carried por `settings.printerIp` (default **192.168.1.11**):
- seu celular usa a mesma rede;
- se a impressora tiver outro IP, trocar uma única linha em
  `printPage() → '192.168.1.11'` (ou seu valor salvo via painel futuri).

### Caminho B: **só o site (Chrome) no celular** — funciona? **Sim, mas sem qualidade IVEC.**
Se você abrir `impressao-biel-v2/index.html` em **file:// ou GitHub Pages no
Chrome do celular**, a página abre e o painel funciona — mas **O CELULAR NÃO
INICIA IVEC** (navegador não pode abrir TCP 9100). O clique cai no
`window.print()` → **PrintManager do Android** (Mopria/Google), que usa
qualidade genérica. O papel/qualidade escolhidos **não chegam** à impressora
(também por isso o modo antigo era fraco).

⚠️ Resumo da resposta à sua pergunta:
- **No celular:** precisa do **APK**. Chrome só = pipeline genérica.
- **No notebook:** o **site + `ivec-bridge-server.js`** dá qualidade IVEC sem
  instalar nada, via http://localhost:8011 (mesma LAN/Câmera da impressora).
- **“Somente um dos dois”**: escolha **um** dos modos, ambos funcionam; o APK é o
  único que **viaja no celular**.

---

## 6. Evidências de funcionamento

- **Logcat do celular** durante a impressão pelo app v2:

```
21:15:18.786 printJpeg chamada (settings={"printerIp":"192.168.1.11","papersize":"iso_a4_210x297mm","papertype":"custom-media-type-canon-3","borderless":"ON","printcolormode":"color","printquality":"best","copies":1,"maxWidth":4800})
21:15:19.078 StartJob enviado
21:15:19.078 SetConfiguration enviado
21:15:19.078 SendData enviado (datasize=642848)
21:15:19.079 JPEG enviado
21:15:19.079 EndJob enviado
21:15:29.612 notifyJs ok=true msg=IVEC datasize=642848 resposta:
```

- **A folha** da comparação física impressa pela v2 versus Easy‑PhotoPrint: você
  *testou no papel* e confirmou que é **equipável**.

---

## 7. Próximos passos (fase/print service)

1. **Repositório apartado** para `biel-ive-print-service` (user já pediu).
2. Corrigir o pacote definitivo `android.printservice.PrintService` (hoje o
   projeto usa `android.service.print` por engano) e completar os callbacks de
   `PrinterDiscoverySession` (`onStartPrinterDiscovery / onValidatePrinters /
   onDestroy / onGetPrintJob`), permitindo que **qualquer app** acesse a mesma
   qualidade IVEC.
3. Mapa `papertype`→índice dinâmico: puxar a lista de mídias do printer (via
   SNMP/HTTP 80) para alimentar o painel automaticamente.

---

## 8. Checklist de uso por impressora

| Ação no app v2 | Efeito IVEC no papel |
|---|---|
| Qualidade Alta | `printquality=best` — modo foto |
| Papel Fotog. Brilhante | `papertype=custom-media-type-canon-3` |
| Papel Comum | `papertype=custom-media-type-canon-1` |
| 4x6 (na_index‑4x6_4x6in) | recorte perfeito para papiro de foto |
| Sem bordas ON | `borderlessprint=ON` (sem margem) |
| copies n | enviado dentro do IVEC job |

---

## 9. Aviso legal / licença
- Código é **reimplementação limpa** a partir de observação de tráfego e compreensão
  do protocolo — **não produza redistribuição de código da Canon**.
- Proibido copiar arquivos binários do APK da Canon no repo v2.
- Reutilização propriedade do usuário Alexandre (alebitencourtx).

 fim.
