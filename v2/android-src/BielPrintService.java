package com.ecoprints.clone;

import android.content.Context;
import android.content.SharedPreferences;
import android.print.PrinterId;
import android.print.PrinterInfo;
import android.service.print.PrintService;
import android.printservice.PrintJob;
import android.printservice.PrintDocument;
import android.printservice.PrinterDiscoverySession;

import java.io.OutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import android.graphics.Bitmap;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;

/**
 * Serviço de impressão Android "Biel IVEC" — conversa direto com a impressora
 * da Canon no protocolo IVEC/JPEGPAGE (igual ao Easy-PhotoPrint da Canon),
 * para qualquer app que mandar imprimir (WhatsApp, Gmail, Galeria, PDFs, etc).
 *
 * Pipeline:
 *   app qualquer → Android Print Framework → PrintJob (PDF)
 *   → PdfRenderer (raster @4800 px no lado maior)
 *   → JPEG qualidade 97
 *   → IVEC (StartJob/SetConfiguration/SendData) na TCP 9100
 *
 * Aparece em Configurações → Impressão → "Serviços de impressão" → ative "Biel IVEC".
 */
public class BielPrintService extends PrintService {
    private static final String TAG = "BielPrint";
    private static final String PREFS = "bielprintserv";
    private static final String PRINTER_LOCAL_ID = "biel-ivec-1";
    private static final int PIX = 4800;

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String getPrinterIp() {
        String v = prefs().getString("printerIp", null);
        return (v == null || v.trim().isEmpty()) ? "192.168.1.11" : v.trim();
    }

    public String getPapertype() {
        String v = prefs().getString("papertype", null);
        return (v == null || v.trim().isEmpty()) ? "custom-media-type-canon-3" : v.trim();
    }

    public String getPrintQuality() {
        String v = prefs().getString("printquality", null);
        return (v == null || v.trim().isEmpty()) ? "best" : v.trim();
    }

    public String getBorderless() {
        String v = prefs().getString("borderless", null);
        return (v == null || v.trim().isEmpty()) ? "ON" : v.trim();
    }

    public String getPaper() {
        String v = prefs().getString("papersize", null);
        return (v == null || v.trim().isEmpty()) ? "iso_a4_210x297mm" : v.trim();
    }

    /* ============ PrinterDiscoverySession ============ */

    final class Session extends PrinterDiscoverySession {
        @Override
        public void onStartPrinterDiscovery(List<PrinterId> priorityList) {
            PrinterId id = generatePrinterId(PRINTER_LOCAL_ID);
            List<PrinterInfo> found = new ArrayList<>();
            found.add(new PrinterInfo.Builder(id, "Canon G3010 (Biel IVEC)",
                    PrinterInfo.STATUS_IDLE).build());
            addDiscoveredPrinters(found);
        }
        @Override
        public void onValidatePrinters(List<PrinterId> printerIds) { }
    }

    @Override
    public PrinterDiscoverySession onCreatePrinterDiscoverySession(String tag) {
        return new Session();
    }

    /* ============ impressão ============ */

    @Override
    protected void onPrintJobQueued(final PrintJob job) {
        new Thread(() -> {
            try {
                job.start();
                byte[] jpeg = renderJobToJpeg(job.getDocument());
                if (jpeg == null) { job.fail("Biel IVEC: documento inválido"); return; }
                int copies = Math.max(1, job.getInfo().getCopies());
                IvecReply reply = IvecClient.sendJpeg(
                        getPrinterIp(), jpeg,
                        getPaper(), getPapertype(), "color", getBorderless(), getPrintQuality(), copies);
                if (!reply.ok) { job.fail("IVEC: " + reply.reply); return; }
                job.complete();
            } catch (Throwable t) {
                try { job.fail("Biel IVEC: " + t.getMessage()); } catch (Throwable ignore) { }
            }
        }, "biel-printsvc").start();
    }

    @Override
    public void onPrintJobCancelled(PrintJob job) { }

    /** Rasteriza a 1ª página do PDF do PrintJob em JPEG (maxWidth 4800px). */
    private byte[] renderJobToJpeg(PrintDocument doc) throws Exception {
        ParcelFileDescriptor pdfFd = null;
        try {
            pdfFd = doc.getData();
            if (pdfFd == null) return null;
            PdfRenderer renderer = new PdfRenderer(pdfFd);
            try {
                PdfRenderer.Page page = renderer.openPage(0);
                try {
                    int pageW = Math.min(PIX, page.getWidth());
                    int pageH = Math.round((float) page.getHeight() * pageW / page.getWidth());
                    Bitmap bm = Bitmap.createBitmap(pageW, pageH, Bitmap.Config.ARGB_8888);
                    page.render(bm, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
                    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
                    bm.compress(Bitmap.CompressFormat.JPEG, 97, bos);
                    return bos.toByteArray();
                } finally { page.close(); }
            } finally { renderer.close(); }
        } finally {
            try { pdfFd.close(); } catch (Throwable ignore) { }
        }
    }

    /* ============ IVEC (JPEGPAGE na TCP 9100) ============ */

    public static final class IvecReply { public final boolean ok; public final String reply;
        IvecReply(boolean ok, String reply) { this.ok = ok; this.reply = reply; }
    }

    public static final class IvecClient {
        public static IvecReply sendJpeg(String printerIp, byte[] jpeg, String papersize,
                                         String papertype, String colormode, String borderless,
                                         String quality, int copies) throws Exception {
            String jobID = "00000002";
            String uid = UUID.randomUUID().toString();
            String H = "<?xml version=\"1.0\" encoding=\"utf-8\" ?><cmd xmlns:ivec=\"http://www.canon.com/ns/cmd/2008/07/common/\"";

            String startJob = H + " xmlns:vcn=\"http://www.canon.com/ns/cmd/2008/07/canon/\">"
                + "<ivec:contents><ivec:operation>StartJob</ivec:operation><ivec:param_set servicetype=\"print\">"
                + "<ivec:jobID>" + jobID + "</ivec:jobID><ivec:bidi>1</ivec:bidi>"
                + "<ivec:jobname/><ivec:username/><ivec:computername/>"
                + "<ivec:job_description><![CDATA[" + uid + "]]></ivec:job_description>"
                + "<vcn:host_environment>android</vcn:host_environment>"
                + "</ivec:param_set></ivec:contents></cmd>";

            String setConf = H + " xmlns:vcn=\"http://www.canon.com/ns/cmd/2008/07/canon/\">"
                + "<ivec:contents><ivec:operation>SetConfiguration</ivec:operation><ivec:param_set servicetype=\"print\">"
                + "<ivec:jobID>" + jobID + "</ivec:jobID>"
                + "<ivec:papersize>" + papersize + "</ivec:papersize>"
                + "<ivec:papertype>" + papertype + "</ivec:papertype>"
                + "<ivec:borderlessprint>" + borderless + "</ivec:borderlessprint>"
                + "<ivec:printcolormode>" + colormode + "</ivec:printcolormode>"
                + "<ivec:printquality>" + quality + "</ivec:printquality>"
                + "<vcn:capm_info><vcn:papergap_capm>auto</vcn:papergap_capm>"
                + "<vcn:loadingmediatype_capm>auto</vcn:loadingmediatype_capm></vcn:capm_info>"
                + "</ivec:param_set></ivec:contents></cmd>";

            String sendData = H + ">"
                + "<ivec:contents><ivec:operation>SendData</ivec:operation><ivec:param_set servicetype=\"print\">"
                + "<ivec:jobID>" + jobID + "</ivec:jobID>"
                + "<ivec:format>JPEGPAGE</ivec:format>"
                + "<ivec:datasize>" + jpeg.length + "</ivec:datasize>"
                + "</ivec:param_set></ivec:contents></cmd>";

            String endJob = H + ">"
                + "<ivec:contents><ivec:operation>EndJob</ivec:operation>"
                + "<ivec:param_set servicetype=\"print\"><ivec:jobID>" + jobID + "</ivec:jobID>"
                + "</ivec:param_set></ivec:contents></cmd>";

            InetSocketAddress addr = new InetSocketAddress(printerIp, 9100);
            Socket socket = new Socket();
            try {
                socket.connect(addr, 8000);
                socket.setSoTimeout(1500);
                OutputStream out = socket.getOutputStream();
                InputStream in = socket.getInputStream();
                out.write(startJob.getBytes(StandardCharsets.UTF_8));
                out.write(setConf.getBytes(StandardCharsets.UTF_8));
                out.write(sendData.getBytes(StandardCharsets.UTF_8));
                out.write(jpeg);
                out.write(endJob.getBytes(StandardCharsets.UTF_8));
                out.flush();

                StringBuilder echo = new StringBuilder();
                byte[] buf = new byte[8192];
                long deadline = System.currentTimeMillis() + 12000;
                while (System.currentTimeMillis() < deadline && echo.length() < 64000) {
                    int n;
                    try { n = in.read(buf); }
                    catch (java.net.SocketTimeoutException te) { continue; }
                    if (n < 0) break;
                    echo.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }
                String e = echo.toString();
                boolean ok = !e.contains("error") && !e.contains("Error");
                return new IvecReply(ok, e.length() > 260 ? e.substring(0, 260) : e);
            } finally {
                try { socket.close(); } catch (Throwable ignore) { }
            }
        }
    }
}
