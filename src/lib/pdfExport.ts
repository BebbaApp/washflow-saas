import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatReceiptDate } from "@/lib/thermalPrinter";

export type PdfCell = string | number | null | undefined;

export interface PdfBrand {
  shopName?: string | null;
  logoUrl?: string | null;
}

let currentBrand: PdfBrand = { shopName: null, logoUrl: null };

/**
 * Register the active workspace/shop for PDF exports. Called once by the
 * tenant provider so every subsequent `exportTablePdf` call is branded
 * without callers having to pass the shop name explicitly.
 */
export function setPdfBrand(brand: PdfBrand): void {
  currentBrand = { ...currentBrand, ...brand };
}

export interface ExportTablePdfOptions {
  title: string;
  filename: string;
  headers: string[];
  rows: PdfCell[][];
  subtitle?: string;
  orientation?: "portrait" | "landscape";
  /** Override the app-wide brand for this export only. */
  brand?: PdfBrand;
}

const APP_NAME = "Washflow";

/**
 * Shared branded PDF export used across the app next to CSV exports.
 * Produces a printable table with a workspace-branded header (shop name,
 * report title, generated timestamp) and a footer with page numbers.
 */
export function exportTablePdf(opts: ExportTablePdfOptions): void {
  const {
    title,
    filename,
    headers,
    rows,
    subtitle,
    orientation = headers.length > 6 ? "landscape" : "portrait",
    brand,
  } = opts;

  const effectiveBrand: PdfBrand = { ...currentBrand, ...(brand ?? {}) };
  const shopName = effectiveBrand.shopName?.trim() || APP_NAME;

  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const now = new Date();
  const generatedAt = `${formatReceiptDate(now)}, ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  const drawHeader = () => {
    // Shop name (brand)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(shopName, marginX, 34);

    // Report title
    doc.setFontSize(15);
    doc.setTextColor(15, 23, 42);
    doc.text(title, marginX, 54);

    // Right-aligned meta: generated timestamp
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(`Generated ${generatedAt}`, pageWidth - marginX, 34, { align: "right" });
    doc.text(APP_NAME, pageWidth - marginX, 48, { align: "right" });

    if (subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(subtitle, marginX, 70);
    }

    // Divider under header
    doc.setDrawColor(220, 224, 232);
    doc.setLineWidth(0.6);
    const dividerY = subtitle ? 78 : 62;
    doc.line(marginX, dividerY, pageWidth - marginX, dividerY);
    doc.setTextColor(0);
  };

  const drawFooter = () => {
    const totalPages = doc.getNumberOfPages();
    const current = doc.getCurrentPageInfo().pageNumber;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    // Left: shop / app footer
    doc.text(`${shopName} · ${APP_NAME}`, marginX, pageHeight - 20);
    // Center: generated timestamp
    doc.text(generatedAt, pageWidth / 2, pageHeight - 20, { align: "center" });
    // Right: page number
    doc.text(`Page ${current} of ${totalPages}`, pageWidth - marginX, pageHeight - 20, { align: "right" });
    doc.setTextColor(0);
  };

  const tableStartY = subtitle ? 90 : 74;

  autoTable(doc, {
    startY: tableStartY,
    head: [headers],
    body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: marginX, right: marginX, top: tableStartY, bottom: 40 },
    didDrawPage: () => {
      drawHeader();
      drawFooter();
    },
  });

  // Re-stamp footers so "Page X of Y" reflects the final total page count.
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // Blank out the previous footer strip before re-drawing.
    doc.setFillColor(255, 255, 255);
    doc.rect(0, pageHeight - 30, pageWidth, 30, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`${shopName} · ${APP_NAME}`, marginX, pageHeight - 20);
    doc.text(generatedAt, pageWidth / 2, pageHeight - 20, { align: "center" });
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 20, { align: "right" });
    doc.setTextColor(0);
  }

  const safe = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(safe);
}
