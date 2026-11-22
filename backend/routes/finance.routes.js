// Y-Summit Season 4 2026 — registration and admission overview (no payment processing)
const { Router } = require("express");
const { Op } = require("sequelize");
const ExcelJS = require("exceljs");
const { Registration, User, Attendance, Parish, Church, GroupBankReference } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN"));

const slotKey = (parishId) => "SYS-PARISH-SLOT-" + parishId;
router.get("/parish-slots", asyncHandler(async (_req, res) => {
  const sequelize = User.sequelize;
  const [parishes, allocations, registeredRows, admittedRows] = await Promise.all([
    Parish.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]], raw: true }),
    GroupBankReference.findAll({ where: { code: { [Op.like]: "SYS-PARISH-SLOT-%" }, isActive: true }, attributes: ["code", "totalSlots"], raw: true }),
    User.findAll({
      attributes: ["parishId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: { role: "PARTICIPANT", parishId: { [Op.ne]: null } },
      group: ["parishId"], raw: true,
    }),
    Attendance.findAll({
      attributes: [[sequelize.col("user.parishId"), "parishId"], [sequelize.fn("COUNT", sequelize.fn("DISTINCT", sequelize.col("Attendance.userId"))), "count"]],
      include: [{ model: User, as: "user", attributes: [], where: { role: "PARTICIPANT" } }],
      where: { type: "CHECK_IN" },
      group: ["user.parishId"], raw: true,
    }),
  ]);
  const allocationByParish = new Map(allocations.map((row) => [Number(row.code.slice("SYS-PARISH-SLOT-".length)), Number(row.totalSlots || 0)]));
  const registeredByParish = new Map(registeredRows.map((row) => [Number(row.parishId), Number(row.count || 0)]));
  const admittedByParish = new Map(admittedRows.map((row) => [Number(row.parishId), Number(row.count || 0)]));
  const items = parishes.map((parish) => {
    const totalSlots = allocationByParish.get(parish.id) || 0;
    const registered = registeredByParish.get(parish.id) || 0;
    const admitted = admittedByParish.get(parish.id) || 0;
    return { parishId: parish.id, parish: parish.name, totalSlots, registered, admitted, remaining: Math.max(0, totalSlots - admitted) };
  });
  res.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
  res.json({ items });
}));

