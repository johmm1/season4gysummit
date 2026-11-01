// Y-Summit Season 4 2026 — department reports (PDF) sent to the super admin
const express = require("express");
const { Router } = express;
const { z } = require("zod");
const { Report, User } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");

const router = Router();
const MAX_BYTES = 10 * 1024 * 1024;
const REVIEWERS = ["SUPER_ADMIN", "ADMIN"];
const LIST_ATTRS = { exclude: ["fileData"] };

router.use(requireAuth, requireRole(...ADMIN_ROLES));

const isReviewer = (req) => REVIEWERS.includes(req.auth.role);

const shape = (r) => ({
  id: r.id,
  title: r.title,
  department: r.department,
  summary: r.summary,
  fileName: r.fileName,
  fileSize: r.fileSize,
  status: r.status,
  reviewNote: r.reviewNote,
  reviewedAt: r.reviewedAt,
  createdAt: r.createdAt,
  submittedBy: r.submittedBy?.fullName || null,
  reviewedBy: r.reviewedBy?.fullName || null,
});

// Send a report. The PDF is the raw request body; details travel in the query string.
router.post(
  "/",
  express.raw({ type: ["application/pdf", "application/octet-stream"], limit: MAX_BYTES }),
  asyncHandler(async (req, res) => {
    const meta = z.object({
      title: z.string().trim().min(3).max(160),
      department: z.string().trim().min(2).max(80),
      summary: z.string().trim().max(2000).optional(),
      fileName: z.string().trim().max(200).optional(),
    }).parse(req.query);

    const file = req.body;
    if (!Buffer.isBuffer(file) || file.length === 0) throw new ApiError(400, "Attach a PDF file.");
    if (file.length > MAX_BYTES) throw new ApiError(413, "The PDF is too large (10 MB maximum).");
    if (file.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ApiError(400, "Only PDF files are accepted.");

    const fileName = (meta.fileName || `${meta.title}.pdf`).replace(/[^\w.\- ()]/g, "_").slice(0, 200);
    const report = await Report.create({
      title: meta.title,
      department: meta.department,
      summary: meta.summary || null,
      fileName: fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`,
      fileSize: file.length,
      fileData: file,
      submittedById: req.auth.userId,
    });
    await logAction(req.auth.userId, "REPORT_SUBMITTED", "report", report.id, { department: meta.department });
    res.status(201).json({ report: shape(report) });
  })
);

// Super admin / admin see everything; everyone else sees only their own.
router.get("/", asyncHandler(async (req, res) => {
  const where = isReviewer(req) ? {} : { submittedById: req.auth.userId };
  if (req.query.department) where.department = String(req.query.department);
  if (req.query.status) where.status = String(req.query.status);
  const rows = await Report.findAll({
    where,
    attributes: LIST_ATTRS,
    include: [
      { model: User, as: "submittedBy", attributes: ["fullName"] },
      { model: User, as: "reviewedBy", attributes: ["fullName"] },
    ],
    order: [["createdAt", "DESC"]],
    limit: 300,
  });
  res.json({ items: rows.map((r) => ({ ...shape(r), mine: r.submittedById === req.auth.userId })), canReview: isReviewer(req) });
}));

router.get("/:id/download", asyncHandler(async (req, res) => {
  const report = await Report.findByPk(req.params.id);
  if (!report) throw new ApiError(404, "Report not found.");
  if (!isReviewer(req) && report.submittedById !== req.auth.userId) throw new ApiError(403, "You can only open your own reports.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${report.fileName.replace(/"/g, "")}"`);
  res.setHeader("Content-Length", report.fileData.length);
  res.end(report.fileData);
}));

router.patch("/:id/review", requireRole(...REVIEWERS), asyncHandler(async (req, res) => {
  const body = z.object({
    status: z.enum(["SUBMITTED", "REVIEWED"]).default("REVIEWED"),
    reviewNote: z.string().trim().max(1000).optional(),
  }).parse(req.body || {});
  const report = await Report.findByPk(req.params.id, { attributes: LIST_ATTRS });
  if (!report) throw new ApiError(404, "Report not found.");
  report.status = body.status;
  report.reviewNote = body.reviewNote ?? report.reviewNote;
  report.reviewedAt = body.status === "REVIEWED" ? new Date() : null;
  report.reviewedById = body.status === "REVIEWED" ? req.auth.userId : null;
  await report.save();
  await logAction(req.auth.userId, "REPORT_REVIEWED", "report", report.id, { status: body.status });
  res.json({ ok: true });
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const report = await Report.findByPk(req.params.id, { attributes: LIST_ATTRS });
  if (!report) throw new ApiError(404, "Report not found.");
  const own = report.submittedById === req.auth.userId;
  if (!(req.auth.role === "SUPER_ADMIN" || (own && report.status === "SUBMITTED"))) {
    throw new ApiError(403, "Only the sender (before review) or the super admin can delete a report.");
  }
  await report.destroy();
  await logAction(req.auth.userId, "REPORT_DELETED", "report", req.params.id, {});
  res.json({ ok: true });
}));

module.exports = router;
