// Y-Summit Season 4 2026 — admission desk
//
// Flow on admission day:
//   1. search the participant by name (typo-tolerant, one or two names)
//   2. "Mark paid"  -> confirms payment in person and uses up one slot on the
//                      parish's bank reference code (refused when none are left)
//   3. assign a dormitory
//   4. "Admit"      -> records the check-in
const { Router } = require("express");
const { z } = require("zod");
const { Op } = require("sequelize");
const {
  sequelize, User, Attendance, Parish, Church, Registration,
  Dormitory, GroupBankReference,
} = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");
const { getForm } = require("../services/settingsService");
const { rankByName } = require("../services/nameSearch");

const router = Router();
const staff = [requireAuth, requireRole(...ADMIN_ROLES)];
const moneyStaff = [requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN")];
const FALLBACK_PRICE = parseInt(process.env.TICKET_PRICE || "2200", 10);

// ---------------------------------------------------------------------
// Participant's own status (used by the participant dashboard)
// ---------------------------------------------------------------------
router.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.auth.userId, {
    attributes: ["id", "fullName", "email", "phone"],
    include: [
      { model: Parish, attributes: ["name"] },
      { model: Attendance, as: "attendances", where: { type: "CHECK_IN" }, required: false },
      { model: Registration, as: "registration", attributes: ["status", "paidAt"],
        include: [{ model: Dormitory, as: "dormitory", attributes: ["name"] }] },
    ],
  });
  if (!user) throw new ApiError(404, "Participant not found.");
  res.json({
    participant: user,
    admitted: Boolean(user.attendances?.length),
    paid: user.registration?.status === "CONFIRMED",
    dormitory: user.registration?.dormitory?.name || null,
  });
}));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Participant list cached for a few seconds so typing in the search box
// does not hit the database on every keystroke.
let cache = { at: 0, rows: [] };
function clearCache() { cache = { at: 0, rows: [] }; }

async function allParticipants() {
  if (Date.now() - cache.at < 15_000 && cache.rows.length) return cache.rows;
  const users = await User.findAll({
    where: { role: "PARTICIPANT" },
    attributes: ["id", "fullName", "phone", "gender", "parishId", "churchId"],
    include: [
      { model: Parish, attributes: ["id", "name"] },
      { model: Church, attributes: ["name"] },
      { model: Registration, as: "registration", attributes: ["status"] },
    ],
  });
  cache = { at: Date.now(), rows: users.map((u) => u.get({ plain: true })) };
  return cache.rows;
}

// Bank reference codes carry the slots a parish was awarded. The parish on a
// code is free text, so match it loosely ("Githunguri" == "Githunguri Parish").
const normParish = (name) => String(name || "").toLowerCase().replace(/\bparish\b/g, " ").replace(/[^a-z0-9]/g, "");

async function codesForParish(parishName, transaction, lock = false) {
  const key = normParish(parishName);
  if (!key) return [];
  const rows = await GroupBankReference.findAll({
    where: { isActive: true },
    order: [["code", "ASC"]],
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  return rows.filter((r) => normParish(r.parish) === key);
}

const codeView = (c) => ({
  id: c.id, code: c.code, total: c.totalSlots, used: c.usedSlots,
  remaining: Math.max(0, c.totalSlots - c.usedSlots),
});

async function parishSlots(parishName, transaction) {
  const codes = (await codesForParish(parishName, transaction)).map(codeView);
  const total = codes.reduce((n, c) => n + c.total, 0);
  const used = codes.reduce((n, c) => n + c.used, 0);
  return {
    configured: codes.length > 0,
    codes,
    total: codes.length ? total : null,
    used,
    remaining: codes.length ? Math.max(0, total - used) : null,
  };
}

async function loadParticipant(userId) {
  const user = await User.findOne({
    where: { id: userId, role: "PARTICIPANT" },
    attributes: [
      "id", "fullName", "email", "phone", "gender", "dateOfBirth", "idNumber", "avatarUrl", "parishId",
      "emergencyContactName", "emergencyContactPhone",
      "hasMedicalCondition", "medicalCondition", "medication", "allergies", "disability", "dietaryRequirements",
    ],
    include: [
      { model: Parish, attributes: ["id", "name"] },
      { model: Church, attributes: ["name"] },
      { model: Registration, as: "registration",
        include: [{ model: Dormitory, as: "dormitory", attributes: ["id", "name"] }] },
      { model: Attendance, as: "attendances", where: { type: "CHECK_IN" }, required: false, attributes: ["id", "scannedAt", "label"] },
    ],
  });
  if (!user) throw new ApiError(404, "Participant not found.");
  return user;
}

async function describe(userId) {
  const user = await loadParticipant(userId);
  const reg = user.registration;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    idNumber: user.idNumber,
    avatarUrl: user.avatarUrl,
    parish: user.Parish ? { id: user.Parish.id, name: user.Parish.name } : null,
    church: user.Church?.name || null,
    emergencyContactName: user.emergencyContactName,
    emergencyContactPhone: user.emergencyContactPhone,
    medical: {
      hasCondition: user.hasMedicalCondition,
      condition: user.medicalCondition,
      medication: user.medication,
      allergies: user.allergies,
      disability: user.disability,
      diet: user.dietaryRequirements,
    },
    paid: reg?.status === "CONFIRMED",
    amountDue: reg?.amountDue || 0,
    amountPaid: reg?.amountPaid ?? null,
    paidAt: reg?.paidAt || null,
    dormitory: reg?.dormitory ? { id: reg.dormitory.id, name: reg.dormitory.name } : null,
    admitted: Boolean(user.attendances?.length),
    admittedAt: user.attendances?.[0]?.scannedAt || null,
    slots: await parishSlots(user.Parish?.name),
    registeredWithCode: reg?.groupCode || null,
    paidWithCode: reg?.bankReferenceId ? (await GroupBankReference.findByPk(reg.bankReferenceId, { attributes: ["code"] }))?.code || null : null,
  };
}

// ---------------------------------------------------------------------
// Search — forgiving: one name or two, any order, misspellings, phone digits
// ---------------------------------------------------------------------
router.get("/search", ...staff, asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? req.query.name ?? "").trim();
  if (q.length < 2) return res.json({ items: [] });

  const people = await allParticipants();
  const ranked = rankByName(q, people, { limit: 12 });

  const ids = ranked.map((r) => r.item.id);
  const admitted = ids.length
    ? await Attendance.findAll({ where: { userId: { [Op.in]: ids }, type: "CHECK_IN" }, attributes: ["userId"], group: ["userId"] })
    : [];
  const admittedSet = new Set(admitted.map((a) => a.userId));

  res.json({
    items: ranked.map(({ item, score, exact }) => ({
      id: item.id,
      fullName: item.fullName,
      phone: item.phone,
      gender: item.gender,
      parish: item.Parish?.name || null,
      church: item.Church?.name || null,
      paid: item.registration?.status === "CONFIRMED",
      admitted: admittedSet.has(item.id),
      score: Math.round(score * 100),
      exact,
    })),
  });
}));

router.get("/participant/:userId", ...staff, asyncHandler(async (req, res) => {
  res.json({ participant: await describe(req.params.userId) });
}));

// ---------------------------------------------------------------------
// Mark paid — uses one slot on the parish's bank reference code, atomically
// ---------------------------------------------------------------------
router.post("/:userId/mark-paid", ...moneyStaff, asyncHandler(async (req, res) => {
  const body = z.object({
    amount: z.coerce.number().int().min(0).max(1_000_000).optional(),
    codeId: z.string().uuid().optional(),
    allowWithoutCode: z.boolean().optional(),
  }).parse(req.body || {});

  await sequelize.transaction(async (t) => {
    const user = await User.findOne({
      where: { id: req.params.userId, role: "PARTICIPANT" },
      include: [{ model: Parish, attributes: ["name"] }],
      transaction: t,
    });
    if (!user) throw new ApiError(404, "Participant not found.");

    let reg = await Registration.findOne({ where: { userId: user.id }, transaction: t, lock: t.LOCK.UPDATE });
    if (reg?.status === "CONFIRMED") throw new ApiError(409, "This participant is already marked as paid.");

    // Lock this parish's codes so two desks cannot both take the last slot.
    const codes = await codesForParish(user.Parish?.name, t, true);
    const open = codes.filter((c) => c.usedSlots < c.totalSlots);

    let chosen = null;
    if (body.codeId) {
      chosen = codes.find((c) => c.id === body.codeId);
      if (!chosen) throw new ApiError(409, "That bank reference code does not belong to this participant's parish.");
      if (chosen.usedSlots >= chosen.totalSlots) throw new ApiError(409, `Code ${chosen.code} has no slots left.`);
    } else {
      // Prefer the code the participant registered with, then any code with room.
      const own = reg?.groupCode ? open.find((c) => c.code.toLowerCase() === reg.groupCode.toLowerCase()) : null;
      chosen = own || open[0] || null;
    }

    if (!chosen) {
      const canOverride = ["SUPER_ADMIN", "ADMIN"].includes(req.auth.role);
      if (!(body.allowWithoutCode && canOverride)) {
        throw new ApiError(409, codes.length
          ? "All of this parish's bank reference slots are used. Increase the slots on the code first if more were approved."
          : "This parish has no bank reference code with slots. Add one in the Parish slots tab first.");
      }
    }

    const general = await getForm("generalSettingsForm");
    const fee = general.registrationFee !== undefined && general.registrationFee !== ""
      ? Number(general.registrationFee) : FALLBACK_PRICE;
    const amount = body.amount ?? (reg?.amountDue || fee);

    if (!reg) reg = await Registration.create({ userId: user.id, amountDue: fee }, { transaction: t });
    reg.status = "CONFIRMED";
    reg.amountPaid = amount;
    reg.paidAt = new Date();
    reg.paidById = req.auth.userId;
    if (chosen) {
      chosen.usedSlots += 1;
      await chosen.save({ transaction: t });
      reg.bankReferenceId = chosen.id;
      if (!reg.groupCode) reg.groupCode = chosen.code;
    }
    await reg.save({ transaction: t });

    await logAction(req.auth.userId, "ADMISSION_MARK_PAID", "registration", reg.id,
      { userId: user.id, amount, code: chosen?.code || null });
  });

  clearCache();
  res.json({ participant: await describe(req.params.userId) });
}));

// Undo a mistaken "paid" — gives the slot back.
router.post("/:userId/undo-paid", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN"), asyncHandler(async (req, res) => {
  const reg = await Registration.findOne({ where: { userId: req.params.userId } });
  if (!reg || reg.status !== "CONFIRMED") throw new ApiError(409, "This participant is not marked as paid.");
  const admitted = await Attendance.count({ where: { userId: req.params.userId, type: "CHECK_IN" } });
  if (admitted) throw new ApiError(409, "This participant is already admitted, so the payment cannot be undone.");
  await sequelize.transaction(async (t) => {
    if (reg.bankReferenceId) {
      const code = await GroupBankReference.findByPk(reg.bankReferenceId, { transaction: t, lock: t.LOCK.UPDATE });
      if (code && code.usedSlots > 0) { code.usedSlots -= 1; await code.save({ transaction: t }); }
    }
    reg.status = "PENDING_PAYMENT";
    reg.amountPaid = null;
    reg.paidAt = null;
    reg.paidById = null;
    reg.bankReferenceId = null;
    await reg.save({ transaction: t });
  });
  await logAction(req.auth.userId, "ADMISSION_UNDO_PAID", "registration", reg.id, { userId: req.params.userId });
  clearCache();
  res.json({ participant: await describe(req.params.userId) });
}));

// ---------------------------------------------------------------------
// Dormitory assignment
// ---------------------------------------------------------------------
router.post("/:userId/dormitory", ...staff, asyncHandler(async (req, res) => {
  const { dormitoryId } = z.object({ dormitoryId: z.coerce.number().int().nullable() }).parse(req.body || {});
  const user = await User.findOne({ where: { id: req.params.userId, role: "PARTICIPANT" }, attributes: ["id", "gender"] });
  if (!user) throw new ApiError(404, "Participant not found.");
  const reg = await Registration.findOne({ where: { userId: user.id } });
  if (!reg) throw new ApiError(409, "This participant has no registration record yet.");

  if (dormitoryId !== null) {
    const dorm = await Dormitory.findByPk(dormitoryId);
    if (!dorm) throw new ApiError(404, "Dormitory not found.");
    if (dorm.gender !== "MIXED" && user.gender && dorm.gender !== user.gender) {
      throw new ApiError(409, `${dorm.name} is a ${dorm.gender.toLowerCase()} dormitory.`);
    }
    if (dorm.capacity) {
      const taken = await Registration.count({ where: { dormitoryId: dorm.id, userId: { [Op.ne]: user.id } } });
      if (taken >= dorm.capacity) throw new ApiError(409, `${dorm.name} is full (${dorm.capacity} beds).`);
    }
  }
  reg.dormitoryId = dormitoryId;
  await reg.save();
  await logAction(req.auth.userId, "ADMISSION_ASSIGN_DORM", "registration", reg.id, { userId: user.id, dormitoryId });
  res.json({ participant: await describe(user.id) });
}));

// ---------------------------------------------------------------------
// Admit (check-in) — only once paid
// ---------------------------------------------------------------------
router.post("/:userId/admit", ...staff, asyncHandler(async (req, res) => {
  const user = await User.findOne({
    where: { id: req.params.userId, role: "PARTICIPANT" },
    include: [{ model: Parish, attributes: ["name"] }, { model: Registration, as: "registration", attributes: ["status"] }],
  });
  if (!user) throw new ApiError(404, "Participant not found.");
  if (user.registration?.status !== "CONFIRMED") {
    throw new ApiError(409, "Mark this participant as paid before admitting them.");
  }
  const label = String(req.body?.label || "").trim();
  const previousCheckIn = await Attendance.findOne({ where: { userId: user.id, type: "CHECK_IN" } });
  if (previousCheckIn && !label.toLowerCase().startsWith("re-entry")) {
    throw new ApiError(409, "This participant has already been admitted.");
  }
  await Attendance.create({
    userId: user.id,
    type: "CHECK_IN",
    label: label || "Admission desk",
    scannedById: req.auth.userId,
  });
  await logAction(req.auth.userId, "ADMISSION_ADMIT", "user", user.id, {});
  res.status(201).json({ participant: await describe(user.id) });
}));

// ---------------------------------------------------------------------
// Bank reference codes (the slots awarded to each parish)
// ---------------------------------------------------------------------
router.get("/codes", ...staff, asyncHandler(async (_req, res) => {
  const [codes, parishes] = await Promise.all([
    GroupBankReference.findAll({ order: [["parish", "ASC"], ["code", "ASC"]] }),
    Parish.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] }),
  ]);
  const summary = parishes.map((p) => {
    const mine = codes.filter((c) => c.isActive && normParish(c.parish) === normParish(p.name));
    const total = mine.reduce((n, c) => n + c.totalSlots, 0);
    const used = mine.reduce((n, c) => n + c.usedSlots, 0);
    return { parishId: p.id, parish: p.name, codes: mine.length, total, used, remaining: Math.max(0, total - used) };
  });
  res.json({
    items: codes.map((c) => ({ ...codeView(c), parish: c.parish, isActive: c.isActive })),
    parishes: summary,
  });
}));

// Add or update codes in bulk: [{ code, parish, totalSlots }]. A code that
// already exists has its parish and slots updated (used slots are kept).
router.post("/codes", ...moneyStaff, asyncHandler(async (req, res) => {
  const { items } = z.object({
    items: z.array(z.object({
      code: z.string().trim().min(2).max(40),
      parish: z.string().trim().min(2).max(120),
      totalSlots: z.coerce.number().int().min(0).max(100000),
    })).min(1).max(300),
  }).parse(req.body || {});

  const parishes = await Parish.findAll({ attributes: ["name"] });
  const canonical = new Map(parishes.map((p) => [normParish(p.name), p.name]));
  const unknown = items.filter((i) => !canonical.has(normParish(i.parish)));
  if (unknown.length) {
    throw new ApiError(400, `Unknown parish: ${[...new Set(unknown.map((u) => u.parish))].join(", ")}. Check the spelling against Structure.`);
  }

  let created = 0; let updated = 0;
  await sequelize.transaction(async (t) => {
    for (const i of items) {
      const code = i.code.toUpperCase();
      const parish = canonical.get(normParish(i.parish));
      const existing = await GroupBankReference.findOne({ where: { code }, transaction: t, lock: t.LOCK.UPDATE });
      if (existing) {
        await existing.update({ parish, totalSlots: i.totalSlots, isActive: true }, { transaction: t });
        updated++;
      } else {
        await GroupBankReference.create({ code, parish, totalSlots: i.totalSlots, usedSlots: 0 }, { transaction: t });
        created++;
      }
    }
  });
  await logAction(req.auth.userId, "ADMISSION_SET_CODES", "bankReference", null, { created, updated });
  res.status(201).json({ created, updated });
}));

router.patch("/codes/:id", ...moneyStaff, asyncHandler(async (req, res) => {
  const body = z.object({
    totalSlots: z.coerce.number().int().min(0).max(100000).optional(),
    isActive: z.boolean().optional(),
  }).parse(req.body || {});
  const code = await GroupBankReference.findByPk(req.params.id);
  if (!code) throw new ApiError(404, "Code not found.");
  if (body.totalSlots !== undefined && body.totalSlots < code.usedSlots) {
    throw new ApiError(409, `${code.usedSlots} slot(s) are already used on ${code.code}, so it cannot go below that.`);
  }
  await code.update(body);
  await logAction(req.auth.userId, "ADMISSION_UPDATE_CODE", "bankReference", String(code.id), body);
  res.json({ ok: true });
}));

router.delete("/codes/:id", ...moneyStaff, asyncHandler(async (req, res) => {
  const code = await GroupBankReference.findByPk(req.params.id);
  if (!code) throw new ApiError(404, "Code not found.");
  const inUse = await Registration.count({ where: { bankReferenceId: code.id } });
  if (code.usedSlots > 0 || inUse) throw new ApiError(409, `${code.code} already has payments recorded against it. Set it inactive instead of deleting.`);
  await code.destroy();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
// Dormitories
// ---------------------------------------------------------------------
async function dormitoriesWithOccupancy() {
  const dorms = await Dormitory.findAll({ order: [["name", "ASC"]] });
  const regs = await Registration.findAll({ where: { dormitoryId: { [Op.ne]: null } }, attributes: ["dormitoryId"] });
  const count = {};
  for (const r of regs) count[r.dormitoryId] = (count[r.dormitoryId] || 0) + 1;
  return dorms.map((d) => ({
    id: d.id, name: d.name, gender: d.gender, capacity: d.capacity,
    occupied: count[d.id] || 0,
    available: d.capacity ? Math.max(0, d.capacity - (count[d.id] || 0)) : null,
  }));
}

router.get("/dormitories", ...staff, asyncHandler(async (_req, res) => {
  res.json({ items: await dormitoriesWithOccupancy() });
}));

const dormSchema = z.object({
  name: z.string().trim().min(1).max(80),
  gender: z.enum(["MALE", "FEMALE", "MIXED"]).default("MIXED"),
  capacity: z.coerce.number().int().min(1).max(5000).nullable().optional(),
});

// Add one dormitory, or many at once by passing `names` (one per line in the UI).
router.post("/dormitories", ...staff, asyncHandler(async (req, res) => {
  const bulk = z.object({
    names: z.array(z.string().trim().min(1).max(80)).min(1).max(100),
    gender: z.enum(["MALE", "FEMALE", "MIXED"]).default("MIXED"),
    capacity: z.coerce.number().int().min(1).max(5000).nullable().optional(),
  }).safeParse(req.body || {});
  const entries = bulk.success
    ? bulk.data.names.map((name) => ({ name, gender: bulk.data.gender, capacity: bulk.data.capacity ?? null }))
    : [dormSchema.parse(req.body || {})].map((d) => ({ ...d, capacity: d.capacity ?? null }));

  for (const e of entries) {
    const exists = await Dormitory.findOne({ where: sequelize.where(sequelize.fn("lower", sequelize.col("name")), e.name.toLowerCase()) });
    if (!exists) await Dormitory.create(e);
  }
  res.status(201).json({ items: await dormitoriesWithOccupancy() });
}));

router.patch("/dormitories/:id", ...staff, asyncHandler(async (req, res) => {
  const body = dormSchema.partial().parse(req.body || {});
  const dorm = await Dormitory.findByPk(req.params.id);
  if (!dorm) throw new ApiError(404, "Dormitory not found.");
  await dorm.update(body);
  res.json({ items: await dormitoriesWithOccupancy() });
}));

router.delete("/dormitories/:id", ...staff, asyncHandler(async (req, res) => {
  const dorm = await Dormitory.findByPk(req.params.id);
  if (!dorm) throw new ApiError(404, "Dormitory not found.");
  const occupied = await Registration.count({ where: { dormitoryId: dorm.id } });
  if (occupied) throw new ApiError(409, `${dorm.name} still has ${occupied} participant(s) assigned. Move them first.`);
  await dorm.destroy();
  res.json({ items: await dormitoriesWithOccupancy() });
}));

// ---------------------------------------------------------------------
// Desk totals
// ---------------------------------------------------------------------
router.get("/summary", ...staff, asyncHandler(async (_req, res) => {
  const [registered, paid, admitted, collected] = await Promise.all([
    User.count({ where: { role: "PARTICIPANT" } }),
    Registration.count({ where: { status: "CONFIRMED" } }),
    Attendance.count({ where: { type: "CHECK_IN" }, distinct: true, col: "userId" }),
    Registration.sum("amountPaid", { where: { status: "CONFIRMED" } }),
  ]);
  res.json({ registered, paid, admitted, collected: collected || 0 });
}));

module.exports = router;
