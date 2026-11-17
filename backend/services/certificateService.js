// Y-Summit Season 4 2026 — certificate PDF generation.
// Draws a full vector design matching the official Y-Summit certificate
// template (gold border, navy crest corner, ribbon badge, footer with QR +
// signatures) using PDFKit primitives — no external image is required, but
// if an admin uploads a background template/signatures in Settings, those
// are used instead/in addition.
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { SystemSetting } = require("../models");

const GOLD = "#F4A900";
const GOLD_DARK = "#9A5700";
const TURQUOISE = "#08B8C8";
const TURQUOISE_DARK = "#087F91";
const BROWN = "#603813";
const INK = "#38230F";
const MUTED = "#705E4C";

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

  const summitName = general.summitName || "Y-Summit Season 4 2026";
  const theme = general.theme || "P² – Pursuit of Purpose";
  const themeVerse = general.themeVerse || "Genesis 39:21";
  const venue = general.venue || "Kambui Girls’ Senior School";
  const dates = formatEventDates(general.eventStart, general.eventEnd) || "15–19 December 2026";

  const backgroundUrl = type === "SPORTS_WINNER" ? templates["winnerTemplate__url"] : templates["participationTemplate__url"];
  const [background, chaplainSig, chairSig, churchLogo, fellowshipLogo] = await Promise.all([
    fetchImageBuffer(backgroundUrl),
    fetchImageBuffer(signatures["chaplainSignature__url"] || signatures["secretarySignature__url"]),
    fetchImageBuffer(signatures["chairSignature__url"]),
    Promise.resolve(fs.readFileSync(path.join(__dirname, "../../frontend/assets/images/pcea-church-crest.jpg"))),
    Promise.resolve(fs.readFileSync(path.join(__dirname, "../../frontend/assets/images/pcea-youth-fellowship-crest.jpg")),
  ]);

  return {
    config, textSettings, summitName, theme, themeVerse, venue, dates,
    background, chaplainSig, chairSig, churchLogo, fellowshipLogo,
    chaplainName: leadership.chaplain || "Chaplain",
    chairName: leadership.chairman || "Chairperson",
  };
}

async function drawCertificatePage(doc, assets, { userFullName, type, category, serial }) {
  const { config, textSettings, summitName, theme, themeVerse, venue, dates, background, chaplainSig, chairSig, churchLogo, fellowshipLogo, chaplainName, chairName } = assets;
  const { width: W, height: H } = doc.page;
  const certId = `GYS${new Date().getFullYear()}-${String(serial).padStart(6, "0")}`;
  const qrBuffer = await QRCode.toBuffer(`${certId} | ${type} | ${userFullName}`, { errorCorrectionLevel: "M", margin: 0, width: 220 });

  // Warm cream base with the poster's turquoise, orange and deep-brown palette.
  doc.rect(0, 0, W, H).fill("#FFFCF4");
  if (background) doc.save().opacity(0.12).image(background, 0, 0, { width: W, height: H }).restore();
  doc.lineWidth(5).strokeColor(TURQUOISE).rect(16, 16, W - 32, H - 32).stroke();
  doc.lineWidth(1.5).strokeColor(GOLD).rect(24, 24, W - 48, H - 48).stroke();
  doc.rect(30, 30, W - 60, 5).fill(TURQUOISE);
  doc.rect(30, H - 35, W - 60, 5).fill(GOLD);

  // The two supplied institutional crests occupy balanced positions in the header.
  if (churchLogo) doc.image(churchLogo, 48, 46, { fit: [76, 94], align: "center", valign: "center" });
  if (fellowshipLogo) doc.image(fellowshipLogo, W - 124, 46, { fit: [76, 94], align: "center", valign: "center" });

  doc.fillColor(BROWN).font("Helvetica-Bold").fontSize(10)
    .text("PCEA GITHUNGURI PRESBYTERY", 145, 47, { width: W - 290, align: "center", characterSpacing: 1.2 });
  doc.fillColor(BROWN).font("Times-Bold").fontSize(20)
    .text(summitName.toUpperCase(), 135, 65, { width: W - 270, align: "center" });

  const themeLabel = theme.toUpperCase();
  doc.font("Helvetica-Bold").fontSize(10);
  const themeWidth = Math.min(doc.widthOfString(themeLabel) + 34, W - 250);
  doc.roundedRect((W - themeWidth) / 2, 98, themeWidth, 23, 10).fill(TURQUOISE);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(10)
    .text(themeLabel, (W - themeWidth) / 2, 105, { width: themeWidth, align: "center" });
  doc.fillColor(TURQUOISE_DARK).font("Helvetica-Bold").fontSize(9)
    .text(themeVerse, 0, 126, { width: W, align: "center" });

  doc.fillColor(BROWN).font("Times-Bold").fontSize(34)
    .text(config.heading, 0, 151, { width: W, align: "center" });
  doc.fillColor(TURQUOISE_DARK).font("Helvetica-Bold").fontSize(13)
    .text(config.subheading, 0, 190, { width: W, align: "center", characterSpacing: 3 });

  doc.fillColor(MUTED).font("Helvetica").fontSize(9)
    .text("THIS CERTIFICATE IS PROUDLY PRESENTED TO", 0, 222, { width: W, align: "center", characterSpacing: 1.6 });
  doc.fillColor(BROWN).font("Times-BoldItalic").fontSize(31)
    .text(userFullName, W * 0.13, 242, { width: W * 0.74, align: "center" });
  const lineY = 282;
  doc.lineWidth(1.2).strokeColor(GOLD).moveTo(W * 0.28, lineY).lineTo(W * 0.72, lineY).stroke();

  const rawMessage = textSettings[config.messageField] || config.defaultMessage;
  const message = rawMessage.replace("{name}", userFullName).replace("{summitName}", summitName)
    .replace("{dates}", dates).replace("{venue}", venue).replace("{category}", category || "their competition");
  doc.fillColor(INK).font("Helvetica").fontSize(10.5)
    .text(message, W * 0.18, 296, { align: "center", width: W * 0.64, lineGap: 3 });

  // Event facts are separated into a clear, high-contrast strip.
  const infoY = 382;
  doc.roundedRect(W * 0.17, infoY, W * 0.66, 37, 8).fill("#E5F8F8");
  doc.fillColor(TURQUOISE_DARK).font("Helvetica-Bold").fontSize(9)
    .text(`DATES  ${dates}`, W * 0.19, infoY + 6, { width: W * 0.30, align: "center" });
  doc.fillColor(BROWN).font("Helvetica-Bold").fontSize(9)
    .text(`VENUE  ${venue}`, W * 0.50, infoY + 6, { width: W * 0.31, align: "center" });
  doc.fillColor(BROWN).font("Helvetica").fontSize(8)
    .text("Githunguri Presbyterian Youth Ministry", 0, infoY + 22, { width: W, align: "center" });

  const footerY = H - 112;
  doc.image(qrBuffer, 42, footerY - 2, { width: 55 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(6.5)
    .text(`ID: ${certId}`, 32, footerY + 55, { width: 75, align: "center" });
  drawSignature(doc, chaplainSig, W * 0.31, footerY + 5, chaplainName, "CHAPLAIN");
  drawSignature(doc, chairSig, W * 0.70, footerY + 5, chairName, "CHAIRPERSON");
  doc.fillColor(MUTED).font("Helvetica").fontSize(7)
    .text(dates || "15–19 December 2026", W - 132, footerY + 61, { width: 100, align: "center" });
}

function drawDefaultBackground(doc, W, H) {
  doc.rect(0, 0, W, H).fill("#FFFCF4");
  doc.save();
  doc.polygon([W, H], [W, H * 0.45], [W * 0.7, H]).fill(TURQUOISE);
  doc.polygon([W, H * 0.5], [W * 0.68, H], [W * 0.6, H], [W, H * 0.42]).fill(GOLD);
  doc.restore();
}

function drawCrestCorner(doc, W, H) {
  doc.save();
  doc.polygon([0, 0], [190, 0], [0, 150]).fill(TURQUOISE);
  doc.fillColor(GOLD);
  doc.rect(38, 24, 6, 34).fill(GOLD);
  doc.rect(26, 34, 30, 6).fill(GOLD);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9)
    .text("Y-SUMMIT", 14, 70, { width: 90 });
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
    .text("Y-SUMMIT", cx - 24, cy - 6, { width: 48, align: "center" });
  doc.text("2026", cx - 24, cy + 3, { width: 48, align: "center" });
  doc.restore();
}

module.exports = { generateCertificatePdf, generateCertificatePdfBatch };
