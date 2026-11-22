// Y-Summit Season 4 2026 — registration and admission overview (no payment processing)
const { Router } = require("express");
const ExcelJS = require("exceljs");
const { Registration, User, Attendance, Parish, Church, GroupBankReference } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN"));

const slotKey = (parishId) => "SYS-PARISH-SLOT-" + parishId;
router.get("/parish-slots", asyncHandler(async (_req, res) => {
  const parishes = await Parish.findAll({ order: [["name", "ASC"]] });
  const items = await Promise.all(parishes.map(async (parish) => {
    const allocation = await GroupBankReference.findOne({ where: { code: slotKey(parish.id) } });
    const [registered, admitted] = await Promise.all([
      User.count({ where: { role: "PARTICIPANT", parishId: parish.id } }),
      Attendance.count({ where: { type: "CHECK_IN" }, include: [{ model: User, where: { role: "PARTICIPANT", parishId: parish.id }, attributes: [] }] }),
    ]);
    const totalSlots = allocation ? allocation.totalSlots : 0;
    return { parishId: parish.id, parish: parish.name, totalSlots, registered, admitted, remaining: Math.max(0, totalSlots - admitted) };
  }));
  res.json({ items });
}));
router.put("/parish-slots/:parishId", asyncHandler(async (req, res) => {
  const parishId = Number(req.params.parishId);
  const { totalSlots } = require("zod").z.object({ totalSlots: require("zod").z.coerce.number().int().min(0).max(100000) }).parse(req.body || {});
  const parish = await Parish.findByPk(parishId);
  if (!parish) return res.status(404).json({ error: "Parish not found." });
  const key = slotKey(parish.id);
  const [admitted, existing] = await Promise.all([
    Attendance.count({ where: { type: "CHECK_IN" }, include: [{ model: User, where: { role: "PARTICIPANT", parishId }, attributes: [] }] }),
    GroupBankReference.findOne({ where: { code: key } }),
  ]);
  if (totalSlots < admitted) return res.status(409).json({ error: "Allocation cannot be lower than the number already admitted (" + admitted + ")." });
  if (existing) await existing.update({ parish: parish.name, totalSlots, usedSlots: 0, isActive: true });
  else await GroupBankReference.create({ code: key, parish: parish.name, totalSlots, usedSlots: 0, isActive: true });
  res.json({ ok: true, parishId, totalSlots });
}));
router.get("/summary", asyncHandler(async (_req, res) => {
  const [registeredCount, admittedCount, byTicketType, congregationCount] = await Promise.all([
    User.count({ where: { role: "PARTICIPANT" } }),
    Attendance.count({ where: { type: "CHECK_IN" }, distinct: true, col: "userId" }),
    Registration.findAll({
      attributes: ["ticketType", [Registration.sequelize.fn("COUNT", "*"), "count"]],
      group: ["ticketType"],
    }),
    Church.count(),
  ]);
  res.json({
    registeredCount,
    admittedCount,
    congregationCount,
    awaitingAdmission: Math.max(0, registeredCount - admittedCount),
    byTicketType: byTicketType.map((item) => ({ ticketType: item.ticketType, count: Number(item.get("count")) })),
  });
}));

router.get("/export", asyncHandler(async (_req, res) => {
  const participants = await User.findAll({
    where: { role: "PARTICIPANT" },
    include: [
      { model: Registration, as: "registration" },
      { model: Attendance, as: "attendances", where: { type: "CHECK_IN" }, required: false },
      { model: Parish },
      { model: Church },
    ],
    order: [["createdAt", "ASC"]],
  });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Registrations");
  sheet.columns = [
    { header: "Registered", key: "date", width: 22 },
    { header: "Participant", key: "name", width: 28 },
    { header: "Email", key: "email", width: 30 },
    { header: "Phone", key: "phone", width: 18 },
    { header: "Parish", key: "parish", width: 22 },
    { header: "Church", key: "church", width: 22 },
    { header: "Admission Status", key: "admission", width: 18 },
  ];
  for (const user of participants) sheet.addRow({
    date: user.createdAt?.toISOString?.() || "",
    name: user.fullName,
    email: user.email,
    phone: user.phone,
    parish: user.Parish?.name || "",
    church: user.Church?.name || "",
    admission: user.attendances?.length ? "CHECKED IN" : "NOT CHECKED IN",
  });
  sheet.getRow(1).font = { bold: true };
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="y-summit-2026-registrations.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = router;
