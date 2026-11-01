// Y-Summit Season 4 2026 — small PDFKit helpers for clean, branded table reports.
const PDFDocument = require("pdfkit");

const BRAND = "#C95500";
const TEAL = "#157C94";
const INK = "#1B1B1B";
const MUTED = "#666666";
const STRIPE = "#F4F7F9";
const LINE = "#D9DEE3";

function createDoc({ title, subtitle, landscape = false }) {
  const doc = new PDFDocument({
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    margin: 36,
    bufferPages: true,
    info: { Title: title, Author: "Y-Summit Season 4 2026" },
  });
  doc.__title = title;
  doc.__subtitle = subtitle;
  drawHeader(doc);
  return doc;
}

function drawHeader(doc) {
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.save();
  doc.rect(doc.page.margins.left, doc.page.margins.top, w, 4).fill(BRAND);
  doc.restore();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(17)
    .text(doc.__title, doc.page.margins.left, doc.page.margins.top + 12, { width: w });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9.5)
    .text(doc.__subtitle || "Y-Summit Season 4 2026 · PCEA Githunguri Presbytery", { width: w });
  doc.moveDown(0.8);
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom - 20;
  if (doc.y + needed > bottom) {
    doc.addPage();
    drawHeader(doc);
    return true;
  }
  return false;
}

function sectionTitle(doc, text, color = TEAL) {
  ensureSpace(doc, 50);
  doc.moveDown(0.4);
  doc.fillColor(color).font("Helvetica-Bold").fontSize(12).text(text, doc.page.margins.left, doc.y);
  doc.moveDown(0.3);
}

/**
 * columns: [{ header, width, align? }]   rows: arrays of strings
 * Repeats the header row after a page break and wraps long text.
 */
function table(doc, columns, rows) {
  const x0 = doc.page.margins.left;
  const pad = 5;
  const drawHead = () => {
    const y = doc.y;
    const h = 20;
    doc.rect(x0, y, columns.reduce((s, c) => s + c.width, 0), h).fill(TEAL);
    let x = x0;
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9);
    for (const c of columns) {
      doc.text(c.header, x + pad, y + 6, { width: c.width - pad * 2, align: c.align || "left", lineBreak: false });
      x += c.width;
    }
    doc.y = y + h;
  };

  ensureSpace(doc, 60);
  drawHead();

  rows.forEach((row, idx) => {
    doc.font("Helvetica").fontSize(9);
    const heights = row.map((cell, i) =>
      doc.heightOfString(String(cell ?? ""), { width: columns[i].width - pad * 2 }));
    const h = Math.max(18, Math.max(...heights) + 8);
    if (ensureSpace(doc, h + 2)) drawHead();
    const y = doc.y;
    const totalW = columns.reduce((s, c) => s + c.width, 0);
    if (idx % 2 === 0) doc.rect(x0, y, totalW, h).fill(STRIPE);
    let x = x0;
    doc.fillColor(INK).font("Helvetica").fontSize(9);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ""), x + pad, y + 4, { width: columns[i].width - pad * 2, align: columns[i].align || "left" });
      x += columns[i].width;
    });
    doc.moveTo(x0, y + h).lineTo(x0 + totalW, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  });
  doc.moveDown(0.6);
}

function finish(doc, res, filename) {
  const range = doc.bufferedPageRange();
  const stamp = new Date().toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" });
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - doc.page.margins.bottom + 8;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text(`Generated ${stamp}`, doc.page.margins.left, y, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, y, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "right", lineBreak: false,
      });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}

module.exports = { createDoc, sectionTitle, table, finish, ensureSpace };
