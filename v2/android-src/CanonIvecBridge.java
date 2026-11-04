package com.ecoprints.clone;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;
import android.widget.Toast;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Ponte nativa (v2) do app Impressao-Biel — modo IVEC direto (TCP 9100),
 * byte-a-byte como o Easy-PhotoPrint da Canon fala com a G3010.
 *
 * window.CanonIvec.printJpeg(base64, settingsJson)
 *
 * settingsJson:
 * {
 *   "printerIp": "192.168.1.11",
 *   "papersize":    "iso_a4_210x297mm" | "na_index-4x6_4x6in",
 *   "papertype":    "custom-media-type-canon-1" (Papel Comum)
 *                | "custom-media-type-canon-3" (Papel Fotográfico Brilhante),
 *   "borderless":   "ON" | "OFF",
 *   "printcolormode": "color" | "monochrome",
 *   "printquality": "auto" | "draft" | "standard" | "best",
 *   "copies": 1,
 *   "maxWidth": 4800,       // lado maior do JPEG no modo IVEC (Canon usa 4800x6826)
 * }
 *
 * Sequência real capturada (handshake em texto na TCP 9100):
 *   StartJob → SetConfiguration → SendData(format=JPEGPAGE, datasize=N) → <JPEG> → EndJob
 */
public class CanonIvecBridge {

    private static final String TAG = "CanonIvec";
    private static final int IVEC_PORT = 9100;

    private final MainActivity activity;
    private final WebView webView;

    public CanonIvecBridge(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    /** Mapeia o printQuality do painel para os nomes usados pelo IVEC. */
    public static String ivecQualityFromIndex(int idx) {
        switch (idx) {
            case 2: return "best";
            case 3: return "standard";
            case 4: return "draft";
            default: return "auto";
        }
    }

    /** Mapeia o mediaType (índice pt_BR de cij_settings.js) para o papertype IVEC da Canon. */
    public static String ivecPaperTypeFromIndex(int idx) {
        // spec de papertype (tipos de mídia por SID) — custom-media-type-canon-N
        // (N conforme o ID usado pela lista real da impressora)
        switch (idx) {
            case 1: return "custom-media-type-canon-1";      // Papel Comum
            case 10: return "custom-media-type-canon-3";     // Papel Fotográfico Brilhante
            default: return "custom-media-type-canon-3";
        }
    }

    @JavascriptInterface
    public void printJpeg(String base64Data, String settingsJson) {
        Log.i(TAG, "printJpeg chamada (settings=" + settingsJson + ")");
        new Thread(() -> {
            try { ivecPrintInternal(base64Data, settingsJson); }
            catch (Throwable t) {
                t.printStackTrace();
                Log.e(TAG, "Falha no IVEC: " + t);
                notifyJs(false, "Falha no IVEC: " + t.getMessage());
            }
        }, "CanonIvec-ivePrint").start();
    }

    private void ivecPrintInternal(String base64, String settingsJson) throws Exception {
        JSONObject cj = new JSONObject(settingsJson == null ? "{}" : settingsJson);
        String printerIp = cj.optString("printerIp", "192.168.1.11");
        String papersize = cj.optString("papersize", "iso_a4_210x297mm");
        String papertype = cj.optString("papertype", "custom-media-type-canon-3");
        String borderless = cj.optString("borderless", "OFF");
        String colorMode = cj.optString("printcolormode", "color");
        String quality = cj.optString("printquality", "best");
        int maxWidth = Math.max(1, cj.optInt("maxWidth", 4800));

        byte[] jpegRaw = Base64.decode(base64, Base64.DEFAULT);
        Bitmap bm = BitmapFactory.decodeByteArray(jpegRaw, 0, jpegRaw.length);
        if (bm == null) throw new IllegalStateException("JPEG do app inválido");

        // Canon envia o job no tamanho "photographic" com maxWidth grande;
        // se a imagem do app for menor, mantém (não upscale) — menor Ink
        int w = bm.getWidth(), h = bm.getHeight();
        if (Math.max(w, h) > maxWidth) {
            float scale = maxWidth / (float) Math.max(w, h);
            Bitmap scaled = Bitmap.createScaledBitmap(bm, Math.round(w * scale), Math.round(h * scale), true);
            bm = scaled; w = scaled.getWidth(); h = scaled.getHeight();
        }

        Bytes job = reencodeJpeg(bm);
        byte[] jpeg = job.bytes;

        String uid = UUID.randomUUID().toString();
        String jobID = "00000002";

        StringBuilder sStart = new StringBuilder();
        sStart.append("<?xml version=\"1.0\" encoding=\"utf-8\" ?>")
              .append("<cmd xmlns:ivec=\"http://www.canon.com/ns/cmd/2008/07/common/\" xmlns:vcn=\"http://www.canon.com/ns/cmd/2008/07/canon/\">")
              .append("<ivec:contents><ivec:operation>StartJob</ivec:operation>")
              .append("<ivec:param_set servicetype=\"print\">")
              .append("<ivec:jobID>").append(jobID).append("</ivec:jobID>")
              .append("<ivec:bidi>1</ivec:bidi>")
              .append("<ivec:jobname/>")
              .append("<ivec:username/>")
              .append("<ivec:computername/>")
              .append("<ivec:job_description><![CDATA[").append(uid).append("]]></ivec:job_description>")
              .append("<vcn:host_environment>android</vcn:host_environment>")
              .append("</ivec:param_set></ivec:contents></cmd>");

        StringBuilder sConf = new StringBuilder();
        sConf.append("<?xml version=\"1.0\" encoding=\"utf-8\" ?>")
             .append("<cmd xmlns:ivec=\"http://www.canon.com/ns/cmd/2008/07/common/\" xmlns:vcn=\"http://www.canon.com/ns/cmd/2008/07/canon/\">")
             .append("<ivec:contents><ivec:operation>SetConfiguration</ivec:operation>")
             .append("<ivec:param_set servicetype=\"print\">")
             .append("<ivec:jobID>").append(jobID).append("</ivec:jobID>")
             .append("<ivec:papersize>").append(papersize).append("</ivec:papersize>")
             .append("<ivec:papertype>").append(papertype).append("</ivec:papertype>")
             .append("<ivec:borderlessprint>").append(borderless).append("</ivec:borderlessprint>")
             .append("<ivec:printcolormode>").append(colorMode).append("</ivec:printcolormode>")
             .append("<ivec:printquality>").append(quality).append("</ivec:printquality>")
             .append("<vcn:capm_info>")
             .append("<vcn:papergap_capm>auto</vcn:papergap_capm>")
             .append("<vcn:loadingmediatype_capm>auto</vcn:loadingmediatype_capm>")
             .append("</vcn:capm_info>")
             .append("</ivec:param_set></ivec:contents></cmd>");

        StringBuilder sSend = new StringBuilder();
        sSend.append("<?xml version=\"1.0\" encoding=\"utf-8\" ?>")
             .append("<cmd xmlns:ivec=\"http://www.canon.com/ns/cmd/2008/07/common/\">")
             .append("<ivec:contents><ivec:operation>SendData</ivec:operation>")
             .append("<ivec:param_set servicetype=\"print\">")
             .append("<ivec:jobID>").append(jobID).append("</ivec:jobID>")
             .append("<ivec:format>JPEGPAGE</ivec:format>")
             .append("<ivec:datasize>").append(jpeg.length).append("</ivec:datasize>")
             .append("</ivec:param_set></ivec:contents></cmd>");

        StringBuilder sEnd = new StringBuilder();
        sEnd.append("<?xml version=\"1.0\" encoding=\"utf-8\" ?>")
            .append("<cmd xmlns:ivec=\"http://www.canon.com/ns/cmd/2008/07/common/\">")
            .append("<ivec:contents><ivec:operation>EndJob</ivec:operation>")
            .append("<ivec:param_set servicetype=\"print\">")
            .append("<ivec:jobID>").append(jobID).append("</ivec:jobID>")
            .append("</ivec:param_set></ivec:contents></cmd> ");

        InetSocketAddress addr = new InetSocketAddress(printerIp, IVEC_PORT);
        Socket socket = new Socket();
        InputStream in = null;
        try {
            socket.connect(addr, 8000);
            socket.setSoTimeout(1500);   // leituras curtas — não bloqueia o envio do EndJob
            OutputStream out = socket.getOutputStream();
            in = socket.getInputStream();
            write(out, sStart.toString().getBytes(StandardCharsets.UTF_8));
            Log.i(TAG, "StartJob enviado");
            write(out, sConf.toString().getBytes(StandardCharsets.UTF_8));
            Log.i(TAG, "SetConfiguration enviado");
            write(out, sSend.toString().getBytes(StandardCharsets.UTF_8));
            Log.i(TAG, "SendData enviado (datasize=" + jpeg.length + ")");
            out.write(jpeg);
            Log.i(TAG, "JPEG enviado");
            write(out, sEnd.toString().getBytes(StandardCharsets.UTF_8));
            Log.i(TAG, "EndJob enviado");
            out.flush();

            // Drena as respostas (ACKs XML) por até ~10 s, sem travar a Thread de UI
            StringBuilder echo = new StringBuilder();
            byte[] buf = new byte[8192];
            long deadline = System.currentTimeMillis() + 10000;
            while (System.currentTimeMillis() < deadline && echo.length() < 64000) {
                int n;
                try { n = in.read(buf); }
                catch (java.net.SocketTimeoutException te) { continue; }
                if (n < 0) break;
                echo.append(new String(buf, 0, n, StandardCharsets.UTF_8));
            }
            String e = echo.toString();
            boolean ok = !e.contains("error") && !e.contains("Error") ;
            notifyJs(ok, "IVEC datasize=" + jpeg.length + " resposta:" + (e.length() > 220 ? e.substring(0, 220) : e));
        } finally {
            try { socket.close(); } catch (Throwable tt) { }
        }
    }

    private static void write(OutputStream out, byte[] data) throws Exception { out.write(data); out.flush(); }

    /** Recodifica bitmap para JPEG limpo (qualidade 97) — job pesado não deve subir em PNG. */
    private Bytes reencodeJpeg(Bitmap bm) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        bm.compress(Bitmap.CompressFormat.JPEG, 97, b);
        return new Bytes(b.toByteArray());
    }

    private static final class Bytes { final byte[] bytes; Bytes(byte[] b) { this.bytes = b; } }

    void notifyJs(boolean ok, String msg) {
        final String esc = (msg == null ? "" : msg).replace("\\", "\\\\").replace("'", "\\'");
        String s = (msg == null ? "" : msg);
        if (s.length() > 120) s = s.substring(0, 120) + "…";
        final String toast = s;
        activity.runOnUiThread(() -> {
            Log.i(TAG, "notifyJs ok=" + ok + " msg=" + toast);
            Toast.makeText(activity, (ok ? "✔ " : "✘ ") + toast, Toast.LENGTH_LONG).show();
            webView.evaluateJavascript(
                "window.CanonIvecDone && window.CanonIvecDone(" + ok + ",'" + esc + "');", null);
        });
    }
}
