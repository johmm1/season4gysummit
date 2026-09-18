// GY Summit 2026 — QR admission cards
const { Router } = require("express");
const { z } = require("zod");
const PDFDocument = require("pdfkit");
const { AdmissionCard, User, Attendance, Parish, Registration } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { renderQrDataUrl, renderQrBuffer, verifyAdmissionToken } = require("../services/qrService");
const { getForm } = require("../services/settingsService");

const router = Router();

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const card = await AdmissionCard.findOne({ where: { userId: req.auth.userId } });
    if (!card) throw new ApiError(404, "No admission card yet — payment must be confirmed first");
    const admissionSettings = await getForm("admissionSettingsForm");
    const qrImage = await renderQrDataUrl(card.qrCode, Number(admissionSettings.qrSize) || 480);
    res.json({ card, qrImage });
  })
);

router.get(
  "/me/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.auth.userId);
    const card = await AdmissionCard.findOne({ where: { userId: req.auth.userId } });
    if (!user || !card) throw new ApiError(404, "No admission card yet");

    const admissionSettings = await getForm("admissionSettingsForm");
    const qrBuffer = await renderQrBuffer(card.qrCode, Number(admissionSettings.qrSize) || 480);
    const general = await getForm("generalSettingsForm");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${card.cardNumber}.pdf"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text(general.summitName || "GY Summit 2026", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor("#555").text("Official Admission Pass", { align: "center" });
    doc.moveDown(1.5);

    doc.fillColor("#000").fontSize(14).text(user.fullName, { align: "center" });
    doc.moveDown(1);

    const qrSize = 220;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.image(qrBuffer, doc.page.margins.left + (pageWidth - qrSize) / 2, doc.y, { width: qrSize, height: qrSize });
    doc.moveDown(qrSize / 14);

    doc.fontSize(12).fillColor("#000").text(card.cardNumber, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#888").text(
      "Present this pass at all entry points. Keep it safe — it is unique to you.",
      { align: "center" }
    );

    doc.end();
  })
);

const scanSchema = z.object({
  token: z.string().min(10),
  type: z.enum(["CHECK_IN", "SESSION", "MEAL", "SPORTS"]).default("CHECK_IN"),
  label: z.string().max(120).optional(),
});

router.post(
  "/scan",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = scanSchema.parse(req.body);
    const verified = verifyAdmissionToken(body.token);
    if (!verified) throw new ApiError(400, "Invalid or tampered QR code");

    const card = await AdmissionCard.findOne({ where: { userId: verified.userId }, include: [{ model: User, as: "user", include: [{ model: Parish }] }] });
    if (!card) throw new ApiError(404, "No admission card matches this code");
    if (card.isRevoked) throw new ApiError(403, "This admission card has been revoked");

    const attendance = await Attendance.create({
      userId: card.userId,
      admissionCardId: card.id,
      type: body.type,
      label: body.label,
      scannedById: req.auth.userId,
    });

    res.status(201).json({
      attendance,
      participant: { fullName: card.user.fullName, cardNumber: card.cardNumber, parish: card.user.Parish?.name },
    });
  })
);

router.get(
  "/lookup/:cardNumber",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const card = await AdmissionCard.findOne({
      where: { cardNumber: req.params.cardNumber.trim().toUpperCase() },
      include: [{ model: User, as: "user", include: [{ model: Parish }] }],
    });
    if (!card) throw new ApiError(404, "No participant found with that admission code");

    const registration = await Registration.findOne({ where: { userId: card.userId } });
    const alreadyAdmitted = await Attendance.findOne({ where: { admissionCardId: card.id, type: "CHECK_IN" } });

    res.json({
      card,
      participant: card.user,
      registrationStatus: registration?.status || "PENDING",
      alreadyAdmitted: Boolean(alreadyAdmitted),
    });
  })
);

const manualAdmitSchema = z.object({ label: z.string().max(120).optional() });

router.post(
  "/:cardId/admit",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { label } = manualAdmitSchema.parse(req.body || {});
    const card = await AdmissionCard.findByPk(req.params.cardId, { include: [{ model: User, as: "user", include: [{ model: Parish }] }] });
    if (!card) throw new ApiError(404, "Card not found");
    if (card.isRevoked) throw new ApiError(403, "This admission card has been revoked");

    const attendance = await Attendance.create({
      userId: card.userId,
      admissionCardId: card.id,
      type: "CHECK_IN",
      label: label || "Manual admit (admission code lookup)",
      scannedById: req.auth.userId,
    });

    res.status(201).json({
      attendance,
      participant: { fullName: card.user.fullName, cardNumber: card.cardNumber, parish: card.user.Parish?.name },
    });
  })
);

router.post(
  "/:cardId/revoke",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "ADMISSIONS_ADMIN"),
  asyncHandler(async (req, res) => {
    const card = await AdmissionCard.findByPk(req.params.cardId);
    if (!card) throw new ApiError(404, "Card not found");
    card.isRevoked = true;
    await card.save();
    res.json({ card });
  })
);

module.exports = router;
