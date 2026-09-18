// GY Summit 2026 — attendance
const { Router } = require("express");
const { Op } = require("sequelize");
const { Attendance, User, Parish } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const attendances = await Attendance.findAll({ where: { userId: req.auth.userId }, order: [["scannedAt", "DESC"]] });
    res.json({ attendances });
  })
);

router.get(
  "/",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "25", 10)));
    const where = req.query.type ? { type: req.query.type } : {};

    const { rows, count } = await Attendance.findAndCountAll({
      where,
      include: [{ model: User, as: "user", attributes: ["fullName"], include: [{ model: Parish, attributes: ["name"] }] }],
      order: [["scannedAt", "DESC"]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.json({ items: rows, total: count, page, pageSize, totalPages: Math.ceil(count / pageSize) });
  })
);

module.exports = router;
