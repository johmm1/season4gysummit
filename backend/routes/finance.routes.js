// GY Summit 2026 — finance
const { Router } = require("express");
const { Op } = require("sequelize");
const ExcelJS = require("exceljs");
const { Payment, Registration, User, AdmissionCard } = require("../models");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();
router.use(requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN"));

const TICKET_PRICE = parseInt(process.env.TICKET_PRICE || "1900", 10);

router.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const [succeededSum, succeededCount, pendingSum, pendingCount, failedSum, failedCount, byTicketType, registeredCount, admittedCount] = await Promise.all([
      Payment.sum("amount", { where: { status: "SUCCESS" } }),
      Payment.count({ where: { status: "SUCCESS" } }),
      Payment.sum("amount", { where: { status: "PENDING" } }),
      Payment.count({ where: { status: "PENDING" } }),
      Payment.sum("amount", { where: { status: { [Op.in]: ["FAILED", "CANCELLED", "TIMEOUT"] } } }),
      Payment.count({ where: { status: { [Op.in]: ["FAILED", "CANCELLED", "TIMEOUT"] } } }),
      Registration.findAll({
        attributes: ["ticketType", [Registration.sequelize.fn("COUNT", "*"), "count"]],
        where: { status: "CONFIRMED" },
        group: ["ticketType"],
      }),
      User.count({ where: { role: "PARTICIPANT" } }),
      AdmissionCard.count(),
    ]);

    res.json({
      succeeded: { total: succeededSum || 0, count: succeededCount },
      pending: { total: pendingSum || 0, count: pendingCount },
      failed: { total: failedSum || 0, count: failedCount },
      byTicketType: byTicketType.map((t) => ({ ticketType: t.ticketType, count: Number(t.get("count")) })),
      admittedCount,
      calculator: {
        registeredCount,
        ticketPrice: TICKET_PRICE,
        // Every registrant is treated as fully paid at signup, so the real
        // amount in account is simply registered count × ticket price —
        // not a projection waiting on separate payment confirmation.
        amountInAccount: registeredCount * TICKET_PRICE,
        mpesaVerifiedTotal: succeededSum || 0,
      },
    });
  })
);

router.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
    const where = req.query.status ? { status: req.query.status } : {};

    const { rows, count } = await Payment.findAndCountAll({
      where,
      include: [{ model: Registration, as: "registration", include: [{ model: User, as: "user", attributes: ["fullName", "phone"] }] }],
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.json({ items: rows, total: count, page, pageSize, totalPages: Math.ceil(count / pageSize) });
  })
);

router.get(
  "/export",
  asyncHandler(async (_req, res) => {
    const payments = await Payment.findAll({
      include: [{ model: Registration, as: "registration", include: [{ model: User, as: "user" }] }],
      order: [["createdAt", "DESC"]],
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Payments");
    sheet.columns = [
      { header: "Date", key: "date", width: 20 },
      { header: "Participant", key: "name", width: 28 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Ticket Type", key: "ticketType", width: 14 },
      { header: "Amount (KES)", key: "amount", width: 14 },
      { header: "Status", key: "status", width: 12 },
      { header: "M-Pesa Receipt", key: "receipt", width: 18 },
      { header: "Checkout Request ID", key: "checkoutRequestId", width: 28 },
    ];

    for (const p of payments) {
      sheet.addRow({
        date: p.createdAt.toISOString(),
        name: p.registration.user.fullName,
        phone: p.phone,
        ticketType: p.registration.ticketType,
        amount: p.amount,
        status: p.status,
        receipt: p.mpesaReceiptNumber || "",
        checkoutRequestId: p.checkoutRequestId || "",
      });
    }
    sheet.getRow(1).font = { bold: true };

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="gy-summit-2026-payments.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  })
);

module.exports = router;
