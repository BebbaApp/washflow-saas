import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type PdfCell = string | number | null | undefined;

export interface ExportTablePdfOptions {
  title: string;
  filename: string;
  headers: string[];
  rows: PdfCell[][];
  subtitle?: string;
  orientation?: "portrait" | "landscape";
  footer?: string;
}

/**
 * Shared branded PDF export used across the app next to CSV exports.
 * Produces a clean, printable table with a title, generation timestamp and page numbers.
 */
export function exportTablePdf(opts: ExportTablePdfOptions): void {
  const {
    title,
    filename,
    headers,
    rows,
    subtitle,
    orientation = headers.length > 6 ? "landscape" : "portrait",
    footer = "Washflow",
  } = opts;

  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 40, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  const stamp = `Generated ${new Date().toLocaleString()}`;
  doc.text(stamp, pageWidth - 40, 40, { align: "right" });
  if (subtitle) {
    doc.text(subtitle, 40, 56);
  }
  doc.setTextColor(0);

  autoTable(doc, {
    startY: subtitle ? 70 : 56,
    head: [headers],
    body: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
    styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(`${footer} · Page ${page}`, pageWidth / 2, pageHeight - 20, { align: "center" });
      doc.setTextColor(0);
    },
  });

  const safe = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(safe);
}
