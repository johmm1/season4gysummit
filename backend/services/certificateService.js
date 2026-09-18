// GY Summit 2026 — certificate PDF generation.
// Draws a full vector design matching the official GY Summit certificate
// template (gold border, navy crest corner, ribbon badge, footer with QR +
// signatures) using PDFKit primitives — no external image is required, but
// if an admin uploads a background template/signatures in Settings, those
// are used instead/in addition.
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { SystemSetting } = require("../models");

const GOLD = "#C8A24A";
const GOLD_DARK = "#A8842F";
const NAVY = "#0B1B33";
const INK = "#1B1B1B";
const MUTED = "#666666";

async function getForm(formId) {
  const row = await SystemSetting.findOne({ where: { key: formId } });
  return row?.value || {};
}

async function fetchImageBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function formatEventDates(startsAt, endsAt) {
  if (!startsAt) return "";
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const opts = { day: "numeric", month: "long" };
  if (!end || start.toDateString() === end.toDateString()) {
    return start.toLocaleDateString("en-KE", { ...opts, year: "numeric" });
  }
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString("en-KE", sameMonth ? { day: "numeric" } : opts);
  const endStr = end.toLocaleDateString("en-KE", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

const TYPE_CONFIG = {
  PARTICIPATION: {
    heading: "CERTIFICATE",
    subheading: "OF PARTICIPATION",
    badgeLines: ["FAITH", "LEADERSHIP", "PURPOSE"],
    messageField: "participationMessage",
    defaultMessage:
      "has participated in the {summitName} held from {dates} at {venue}. " +
      "Thank you for being part of this transformational journey.",
  },
  SPORTS_WINNER: {
    heading: "CERTIFICATE",
    subheading: "OF ACHIEVEMENT",
    badgeLines: ["CHAMPION", "2026"],
    messageField: "winnerMessage",
    defaultMessage:
      "has been part of the championship-winning team in {category} at the {summitName}, " +
      "held from {dates} at {venue}. Congratulations on this outstanding achievement.",
  },
};

async function generateCertificatePdf({ userFullName, type, category, serial }, res) {
  const assets = await loadCertificateAssets(type);
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  doc.pipe(res);
  await drawCertificatePage(doc, assets, { userFullName, type, category, serial });
  doc.end();
}

/**
 * One combined multi-page PDF — one certificate per page — for an admin to
 * download and send straight to a printer, instead of opening and printing
 * every participant's certificate one at a time.
 * @param {Array<{userFullName, type, category, serial}>} items
 */
async function generateCertificatePdfBatch(items, res) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
  doc.pipe(res);

  // Background image / signatures / settings text are identical for every
  // certificate of the same type — fetched once per type and reused,
  // instead of re-downloading the same signature image N times.
  const assetsByType = {};
  let first = true;
  for (const item of items) {
    if (!assetsByType[item.type]) assetsByType[item.type] = await loadCertificateAssets(item.type);
    if (!first) doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
    first = false;
    await drawCertificatePage(doc, assetsByType[item.type], item);
  }

  if (first) {
    // No items at all — still return a valid (empty-message) PDF rather
    // than a zero-byte file the browser can't open.
    doc.font("Helvetica").fontSize(14).text("No certificates match this filter.", 50, 50);
  }

  doc.end();
}

async function loadCertificateAssets(type) {
  const config = TYPE_CONFIG[type];
  if (!config) throw new Error(`Unknown certificate type: ${type}`);

  const [general, templates, signatures, textSettings, leadership] = await Promise.all([
    getForm("generalSettingsForm"),
    getForm("certificateTemplatesForm"),
    getForm("digitalSignaturesForm"),
    getForm("certificateTextForm"),
    getForm("leadershipForm"),
  ]);

  const summitName = general.summitName || "GY Summit 2026";
  const theme = general.theme || "Rise · Connect · Transform";
  const themeVerse = general.themeVerse || "";
  const venue = general.venue || "TBD";
  const dates = formatEventDates(general.eventStart, general.eventEnd);

  const backgroundUrl = type === "SPORTS_WINNER" ? templates["winnerTemplate__url"] : templates["participationTemplate__url"];
  const [background, chairSig, secretarySig] = await Promise.all([
    fetchImageBuffer(backgroundUrl),
    fetchImageBuffer(signatures["chairSignature__url"]),
    fetchImageBuffer(signatures["secretarySignature__url"]),
  ]);

  return {
    config, textSettings, summitName, theme, themeVerse, venue, dates,
    background, chairSig, secretarySig,
    chairName: leadership.chairman || "Chairperson",
    secretaryName: leadership.secretary || "Secretary",
  };
}

async function drawCertificatePage(doc, assets, { userFullName, type, category, serial }) {
  const { config, textSettings, summitName, theme, themeVerse, venue, dates, background, chairSig, secretarySig, chairName, secretaryName } = assets;
  const { width: W, height: H } = doc.page;

  const certId = `GYS${new Date().getFullYear()}-${String(serial).padStart(6, "0")}`;
  const qrBuffer = await QRCode.toBuffer(`${certId} | ${type} | ${userFullName}`, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: 240,
  });

  // ---------- Background ----------
  if (background) {
    doc.image(background, 0, 0, { width: W, height: H });
  } else {
    drawDefaultBackground(doc, W, H);
  }

  // ---------- Gold border frame ----------
  doc.lineWidth(2).strokeColor(GOLD).rect(18, 18, W - 36, H - 36).stroke();
  doc.lineWidth(0.75).strokeColor(GOLD).rect(24, 24, W - 48, H - 48).stroke();

  // ---------- Header ----------
  doc.fillColor(INK).font("Times-Bold").fontSize(24)
    .text(summitName.toUpperCase(), 0, 52, { align: "center", width: W });

  const tagY = 84;
  const tagText = theme.toUpperCase();
  doc.font("Helvetica-Bold").fontSize(10);
  const tagWidth = doc.widthOfString(tagText) + 40;
  doc.fillColor(GOLD).rect((W - tagWidth) / 2, tagY, tagWidth, 18).fill();
  doc.fillColor("#fff").text(tagText, 0, tagY + 5, { align: "center", width: W });

  if (themeVerse) {
    doc.fillColor(MUTED).font("Times-Italic").fontSize(9)
      .text(themeVerse, W * 0.22, tagY + 26, { align: "center", width: W * 0.56 });
  }

  // ---------- CERTIFICATE title ----------
  doc.fillColor(INK).font("Times-Bold").fontSize(40)
    .text(config.heading, 0, 148, { align: "center", width: W });
  doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(15).text(config.subheading, 0, 195, {
    align: "center",
    width: W,
    characterSpacing: 3,
  });

  // ---------- "This is to certify that" + Name ----------
  doc.fillColor(MUTED).font("Helvetica").fontSize(10)
    .text("THIS IS TO CERTIFY THAT", 0, 232, { align: "center", width: W, characterSpacing: 2 });

  doc.fillColor(GOLD_DARK).font("Times-BoldItalic").fontSize(34)
    .text(userFullName, W * 0.15, 254, { align: "center", width: W * 0.7 });
  const nameLineY = 254 + 44;
  doc.lineWidth(0.75).strokeColor(GOLD).moveTo(W * 0.32, nameLineY).lineTo(W * 0.68, nameLineY).stroke();

  // ---------- Body message ----------
  const rawMessage = textSettings[config.messageField] || config.defaultMessage;
  const message = rawMessage
    .replace("{name}", userFullName)
    .replace("{summitName}", summitName)
    .replace("{dates}", dates)
    .replace("{venue}", venue)
    .replace("{category}", category || "their competition");

  doc.fillColor(INK).font("Helvetica").fontSize(11.5)
    .text(message, W * 0.2, nameLineY + 14, { align: "center", width: W * 0.6, lineGap: 3 });

  // ---------- Badge (top-right ribbon medallion) ----------
  drawBadge(doc, W - 100, 70, config.badgeLines);

  // ---------- Crest corner (top-left) ----------
  drawCrestCorner(doc, W, H);

  // ---------- Footer ----------
  const footerY = H - 120;

  // QR + certificate ID (left)
  doc.image(qrBuffer, 48, footerY, { width: 64 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(`ID: ${certId}`, 40, footerY + 68, { width: 80, align: "center" });

  // Signature 1 — Chairperson (center-left)
  drawSignature(doc, chairSig, W * 0.36, footerY, chairName, "Chairperson");

  // Seal (center)
  drawSeal(doc, W / 2, footerY + 20);

  // Signature 2 — Secretary (center-right)
  drawSignature(doc, secretarySig, W * 0.64, footerY, secretaryName, "Secretary");

  // Date (bottom-right)
  doc.fillColor(MUTED).font("Helvetica").fontSize(8)
    .text(dates || new Date().toLocaleDateString("en-KE"), W - 160, footerY + 55, { width: 112, align: "center" });
  doc.fontSize(6).text("DATE", W - 160, footerY + 68, { width: 112, align: "center", characterSpacing: 1 });
}

function drawDefaultBackground(doc, W, H) {
  doc.rect(0, 0, W, H).fill("#FFFDF8");
  doc.save();
  doc.polygon([W, H], [W, H * 0.45], [W * 0.7, H]).fill(NAVY);
  doc.polygon([W, H * 0.5], [W * 0.68, H], [W * 0.6, H], [W, H * 0.42]).fill(GOLD);
  doc.restore();
}

function drawCrestCorner(doc, W, H) {
  doc.save();
  doc.polygon([0, 0], [190, 0], [0, 150]).fill(NAVY);
  doc.fillColor(GOLD);
  doc.rect(38, 24, 6, 34).fill(GOLD);
  doc.rect(26, 34, 30, 6).fill(GOLD);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9)
    .text("GY SUMMIT", 14, 70, { width: 90 });
  doc.fontSize(9).text("2026", 14, 82, { width: 90 });
  doc.restore();
}

function drawBadge(doc, cx, cy, lines) {
  doc.save();
  doc.rect(cx - 5, cy + 24, 10, 30).fill(GOLD_DARK);
  doc.rect(cx + 26, cy + 24, 10, 30).fill(GOLD_DARK);
  doc.circle(cx + 16, cy + 20, 30).fill(NAVY);
  doc.lineWidth(2).strokeColor(GOLD).circle(cx + 16, cy + 20, 30).stroke();
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(7);
  lines.forEach((line, i) => {
    doc.text(line, cx - 14, cy + 10 + i * 9, { width: 60, align: "center" });
  });
  doc.restore();
}

function drawSignature(doc, sigBuffer, cx, y, name, title) {
  if (sigBuffer) {
    doc.image(sigBuffer, cx - 45, y - 10, { width: 90, height: 34, fit: [90, 34] });
  }
  doc.lineWidth(0.75).strokeColor(MUTED).moveTo(cx - 55, y + 28).lineTo(cx + 55, y + 28).stroke();
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text(name.toUpperCase(), cx - 70, y + 33, { width: 140, align: "center" });
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(title, cx - 70, y + 44, { width: 140, align: "center" });
}

function drawSeal(doc, cx, cy) {
  doc.save();
  doc.lineWidth(1.5).strokeColor(GOLD).circle(cx, cy, 26).stroke();
  doc.lineWidth(0.5).circle(cx, cy, 21).stroke();
  doc.fillColor(GOLD_DARK).font("Helvetica-Bold").fontSize(6)
    .text("GY SUMMIT", cx - 24, cy - 6, { width: 48, align: "center" });
  doc.text("2026", cx - 24, cy + 3, { width: 48, align: "center" });
  doc.restore();
}

module.exports = { generateCertificatePdf, generateCertificatePdfBatch };
