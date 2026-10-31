// Y-Summit Season 4 2026 — registration and admission overview (no payment processing)
const { Router } = require("express");
const ExcelJS = require("exceljs");
const { Registration, User, AdmissionCard, Attendance, Parish, Church } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN"));

router.get("/summary", asyncHandler(async (_req, res) => {
  const [registeredCount, issuedPassCount, admittedCount, byTicketType, congregationCount] = await Promise.all([
    User.count({ where: { role: "PARTICIPANT" } }),
    AdmissionCard.count(),
    Attendance.count({ where: { type: "CHECK_IN" } }),
    Registration.findAll({
      attributes: ["ticketType", [Registration.sequelize.fn("COUNT", "*"), "count"]],
      group: ["ticketType"],
    }),
    Church.count(),
  ]);
  res.json({
    registeredCount,
    issuedPassCount,
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
      { model: AdmissionCard, as: "admissionCard" },
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
    { header: "Admission Code", key: "code", width: 20 },
    { header: "Admission Status", key: "admission", width: 18 },
  ];
  for (const user of participants) sheet.addRow({
    date: user.createdAt?.toISOString?.() || "",
    name: user.fullName,
    email: user.email,
    phone: user.phone,
    parish: user.Parish?.name || "",
    church: user.Church?.name || "",
    code: user.admissionCard?.cardNumber || "",
    admission: user.admissionCard?.isRevoked ? "REVOKED" : user.admissionCard ? "ISSUED" : "NOT ISSUED",
  });
  sheet.getRow(1).font = { bold: true };
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="y-summit-2026-registrations.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = router;
