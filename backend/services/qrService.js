// GY Summit 2026 — QR admission token utilities
const crypto = require("crypto");
const QRCode = require("qrcode");

const ADMISSION_QR_SECRET = process.env.ADMISSION_QR_SECRET;
if (!ADMISSION_QR_SECRET) {
  throw new Error("Missing required environment variable: ADMISSION_QR_SECRET");
}

function signAdmissionToken(userId) {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const signature = crypto.createHmac("sha256", ADMISSION_QR_SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function verifyAdmissionToken(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const [userId, issuedAtStr, signature] = parts;
  const payload = `${userId}.${issuedAtStr}`;
  const expected = crypto.createHmac("sha256", ADMISSION_QR_SECRET).update(payload).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return { userId, issuedAt: parseInt(issuedAtStr, 10) };
}

function generateCardNumber(sequence, prefix = "GY26") {
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}

async function renderQrDataUrl(token, width = 480) {
  return QRCode.toDataURL(token, { errorCorrectionLevel: "H", margin: 1, width });
}

async function renderQrBuffer(token, width = 480) {
  return QRCode.toBuffer(token, { errorCorrectionLevel: "H", margin: 1, width });
}

module.exports = { signAdmissionToken, verifyAdmissionToken, generateCardNumber, renderQrDataUrl, renderQrBuffer };
