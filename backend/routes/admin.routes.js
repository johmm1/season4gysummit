// Y-Summit Season 4 2026 — admin: dashboard, participants, settings and admin accounts
const { Router } = require("express");
const { Op, fn, col } = require("sequelize");
const { z } = require("zod");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const {
  User, Registration, Attendance, SystemSetting, Presbytery, Parish, Church, AuditLog,
} = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { getRequestCount } = require("../middleware/requestCounter");
const { logAction } = require("../services/auditService");
const { runBackup, listBackups, getBackupPath } = require("../services/backupService");
const { normalizePhone } = require("../services/phoneUtils");
const { invalidateSettingsCache, getForm } = require("../services/settingsService");
const { notify, emailStatus, sendTransactionalEmail } = require("../services/notificationService");

const router = Router();
router.use(requireAuth, requireRole(...ADMIN_ROLES));

// Email diagnostics — answers "why aren't my emails sending?" without
// digging through server logs.
router.get(
  "/email/status",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json(await emailStatus());
  })
);

router.post(
  "/email/test",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { to } = z.object({ to: z.string().email() }).parse(req.body);
    try {
      await sendTransactionalEmail(to, "Y-Summit Season 4 2026 — test email", "If you can read this, email sending works.\n\nSent from the Y-Summit admin panel.");
      res.json({ sent: true, status: await emailStatus() });
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      res.status(502).json({ sent: false, error: detail, status: await emailStatus() });
    }
  })
);

router.get(
  "/dashboard/stats",
  asyncHandler(async (_req, res) => {
    const [totalUsers, confirmedRegistrations, totalCongregations, totalCheckIns, byParish] =
      await Promise.all([
        User.count({ where: { role: "PARTICIPANT" } }),
        Registration.count({ where: { status: "CONFIRMED" } }),
        Church.count(),
        Attendance.count({ where: { type: "CHECK_IN" }, distinct: true, col: "userId" }),
        User.findAll({
          attributes: ["parishId", [fn("COUNT", col("User.id")), "count"]],
          where: { role: "PARTICIPANT", parishId: { [Op.ne]: null } },
          include: [{ model: Parish, attributes: ["name"] }],
          group: ["parishId", "Parish.id"],
          order: [[fn("COUNT", col("User.id")), "DESC"]],
          limit: 15,
        }),
      ]);

    res.json({
      totalUsers,
      confirmedRegistrations,
      totalCongregations,
      totalCheckIns,
      topPresbyteries: byParish.map((r) => ({
        presbytery: r.Parish?.name || "Unassigned",
        count: Number(r.get("count")),
      })),
    });
  })
);

router.get(
  "/participants",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "25", 10)));
    const search = (req.query.search || "").trim();

    const where = { role: "PARTICIPANT" };
    if (req.query.parishId) where.parishId = req.query.parishId;
    if (req.query.presbyteryId) where.presbyteryId = req.query.presbyteryId;
    if (req.query.churchId) where.churchId = req.query.churchId;
    if (req.query.gender) where.gender = req.query.gender;
    if (req.query.medical === "yes") where.hasMedicalCondition = true;
    if (req.query.medical === "no") where.hasMedicalCondition = false;
    if (req.query.createdFrom || req.query.createdTo) {
      where.createdAt = {};
      if (req.query.createdFrom) where.createdAt[Op.gte] = new Date(`${req.query.createdFrom}T00:00:00.000Z`);
      if (req.query.createdTo) where.createdAt[Op.lte] = new Date(`${req.query.createdTo}T23:59:59.999Z`);
    }
    if (search) {
      where[Op.or] = [
        { fullName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } },
        { idNumber: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const include = [
      { model: Registration, as: "registration", where: req.query.status ? { status: req.query.status } : undefined, required: Boolean(req.query.status) },
      { model: Attendance, as: "attendances", required: false },
      { model: Presbytery },
      { model: Parish },
      { model: Church },
    ];

    const { rows, count } = await User.findAndCountAll({
      where,
      include,
      order: [["createdAt", "DESC"]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      distinct: true,
    });

    res.json({ items: rows, total: count, page, pageSize, totalPages: Math.ceil(count / pageSize) });
  })
);

router.get(
  "/participants/:id",
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id, {
      include: [
        { model: Registration, as: "registration" },
        { model: Attendance, as: "attendances" },
        { model: Presbytery },
        { model: Parish },
        { model: Church },
      ],
    });
    if (!user) throw new ApiError(404, "Participant not found");
    res.json({ user });
  })
);

router.patch(
  "/participants/:id",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        fullName: z.string().min(2).max(120).optional(),
        isActive: z.boolean().optional(),
        role: z.enum(["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN", "PARTICIPANT"]).optional(),
      })
      .parse(req.body);
    const user = await User.findByPk(req.params.id);
    if (!user) throw new ApiError(404, "Participant not found");
    await user.update(body);
    res.json({ user });
  })
);

// ---- Admin accounts ----

router.get(
  "/admins",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const admins = await User.findAll({ where: { role: { [Op.ne]: "PARTICIPANT" } }, order: [["createdAt", "DESC"]] });
    res.json({ admins });
  })
);

router.post(
  "/admins",
  requireRole("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2).max(120),
        phone: z.string().min(9).default("0700000000"),
        role: z.enum(["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN"]),
        temporaryPassword: z.string().min(8),
      })
      .parse(req.body);

    const existing = await User.findOne({ where: { email: body.email.toLowerCase() } });
    if (existing) throw new ApiError(409, "An account with this email already exists.");

    const passwordHash = await bcrypt.hash(body.temporaryPassword, 12);
    const admin = await User.create({
      email: body.email.toLowerCase(),
      phone: normalizePhone(body.phone),
      fullName: body.fullName,
      passwordHash,
      role: body.role,
      isVerified: false,
    });
    const rawOtp = String(crypto.randomInt(100000, 1000000));
    admin.otpHash = crypto.createHash("sha256").update(rawOtp).digest("hex");
    admin.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    admin.otpChannel = "email";
    await admin.save();
    const frontendUrl = ((process.env.FRONTEND_URL || "").split(",")[0].trim() || req.get("origin") || "").replace(/\/$/, "");
    const verifyLink = frontendUrl + "/verify-otp.html?email=" + encodeURIComponent(admin.email);
    try {
      await sendTransactionalEmail(admin.email, "Y-Summit administrator account verification",
        "Hello " + admin.fullName + ", your administrator verification code is " + rawOtp +
        ". It expires in 10 minutes.\n\nVerify your email here: " + verifyLink +
        "\n\nAfter verification, use Forgot Password on the login page to set your password.");
    } catch (err) {
      console.error("[admin-create] verification email failed:", err.message);
    }
    res.status(201).json({ admin, verificationRequired: true });
    await logAction(req.auth.userId, "ADMIN_CREATED", "admin_account", admin.id, { email: admin.email, role: admin.role });
  })
);

// ---- System settings ----

router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const rows = await SystemSetting.findAll();
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  })
);

router.put(
  "/settings",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.record(z.any()).parse(req.body);
    for (const [key, value] of Object.entries(body)) {
      await SystemSetting.upsert({ key, value });
    }
    invalidateSettingsCache();
    res.json({ ok: true });
    await logAction(req.auth.userId, "SETTINGS_UPDATED", "settings", null, { forms: Object.keys(body) });
  })
);

// ---- System health ----

router.get(
  "/system-health",
  asyncHandler(async (_req, res) => {
    const os = require("os");
    const { sequelize, GalleryItem } = require("../models");

    let dbStatus = "offline";
    let dbPingMs = null;
    try {
      const start = Date.now();
      await sequelize.authenticate();
      dbPingMs = Date.now() - start;
      dbStatus = "online";
    } catch {
      dbStatus = "offline";
    }

    let databaseBytes = null;
    try {
      const [rows] = await sequelize.query("SELECT pg_database_size(current_database()) AS bytes");
      databaseBytes = Number(rows?.[0]?.bytes) || 0;
    } catch {
      databaseBytes = null;
    }

    const galleryBytes = (await GalleryItem.sum("bytes")) || 0;
    const participantCount = await User.count({ where: { role: "PARTICIPANT" } });

    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
    const loadAvg = os.loadavg()[0];
    const cpuPercent = Math.min(100, Math.round((loadAvg / os.cpus().length) * 100));

    res.json({
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      deployment: "Node.js / Express",
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      db: { status: dbStatus, pingMs: dbPingMs, sizeBytes: databaseBytes },
      storageConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      storage: { galleryBytes },
      participantCount,
      memory: { usedMb: Math.round(mem.rss / 1024 / 1024), percent: memPercent },
      cpuPercent,
      requestCount24h: getRequestCount(),
    });
  })
);

// ---- Backups (real pg_dump files, listed/streamed from disk) ----

router.post(
  "/backups",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    try {
      const filename = await runBackup();
      const backups = listBackups();
      const created = backups.find((b) => b.filename === filename);
      res.status(201).json({ backup: created });
      await logAction(req.auth.userId, "BACKUP_CREATED", "backup", filename, { bytes: created?.bytes });
    } catch (err) {
      throw new ApiError(500, `Backup failed: ${err.message}`);
    }
  })
);

router.get(
  "/backups",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json({ backups: listBackups() });
  })
);

router.get(
  "/backups/:filename/download",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const filepath = getBackupPath(req.params.filename);
    if (!filepath) throw new ApiError(404, "Backup file not found");
    res.download(filepath);
  })
);

// ---- Audit logs ----

router.get(
  "/audit-logs",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "50", 10)));
    const where = {};
    if (req.query.entityType) where.entityType = req.query.entityType;
    if (req.query.action) where.action = req.query.action;

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      include: [{ model: User, as: "actor", attributes: ["id", "fullName", "email"] }],
      order: [["createdAt", "DESC"]],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const securityActions = ["LOGIN", "LOGIN_FAILED", "ADMIN_CREATED"];
    const securityCount = await AuditLog.count({ where: { action: securityActions } });
    const totalCount = await AuditLog.count();

    res.json({
      logs: rows,
      total: count,
      page,
      pageSize,
      stats: { total: totalCount, security: securityCount },
    });
  })
);

router.delete(
  "/audit-logs",
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const days = Math.max(1, parseInt(req.query.olderThanDays || "365", 10));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { Op } = require("sequelize");
    const deleted = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
    res.json({ deleted });
    await logAction(req.auth.userId, "AUDIT_LOGS_PURGED", "settings", null, { deleted, olderThanDays: days });
  })
);

module.exports = router;
