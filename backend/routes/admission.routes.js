// Y-Summit Season 4 2026 — name-based participant admissions
const { Router } = require("express");
const { Op } = require("sequelize");
const { User, Attendance, Parish, Church, Registration } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

const router = Router();

// Participant's own admission status; no pass number or QR code is issued.
router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.auth.userId, {
    attributes: ["id", "fullName", "email", "phone"],
    include: [
      { model: Parish, attributes: ["name"] },
      { model: Attendance, as: "attendances", where: { type: "CHECK_IN" }, required: false },
    ],
  });
  if (!user) throw new ApiError(404, "Participant not found.");
  res.json({ participant: user, admitted: Boolean(user.attendances?.length) });
}));

// Search by name. Multiple matches are returned so staff can choose the
// correct person using parish and phone rather than relying on an ID code.
router.get("/search", requireAuth, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const name = String(req.query.name || "").trim();
  if (name.length < 2) throw new ApiError(400, "Enter at least two letters of the participant's name.");
  const items = await User.findAll({
    where: { role: "PARTICIPANT", fullName: { [Op.iLike]: `%${name}%` } },
    attributes: ["id", "fullName", "email", "phone", "gender", "dateOfBirth", "idNumber", "avatarUrl", "createdAt", "hasMedicalCondition", "medicalCondition", "medication", "allergies", "disability"],
    include: [
      { model: Parish, attributes: ["name"] },
      { model: Church, attributes: ["name"] },
      { model: Registration, as: "registration", attributes: ["status"] },
      { model: Attendance, as: "attendances", where: { type: "CHECK_IN" }, required: false, attributes: ["id", "scannedAt", "label"] },
    ],
    order: [["fullName", "ASC"]],
    limit: 25,
  });
  res.json({ items });
}));

// Check in a participant directly by their internal account record. The
// internal UUID is never displayed as an admission code or given to them.
router.post("/:userId/admit", requireAuth, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const user = await User.findOne({
    where: { id: req.params.userId, role: "PARTICIPANT" },
    include: [{ model: Parish, attributes: ["name"] }],
  });
  if (!user) throw new ApiError(404, "Participant not found.");
  const label = String(req.body?.label || "").trim();
  const previousCheckIn = await Attendance.findOne({ where: { userId: user.id, type: "CHECK_IN" } });
  if (previousCheckIn && !label.toLowerCase().startsWith("re-entry")) {
    throw new ApiError(409, "This participant has already been checked in.");
  }
  const attendance = await Attendance.create({
    userId: user.id,
    type: "CHECK_IN",
    label: label || "Name-based admission",
    scannedById: req.auth.userId,
  });
  res.status(201).json({
    attendance,
    participant: { id: user.id, fullName: user.fullName, parish: user.Parish?.name },
  });
}));

module.exports = router;
