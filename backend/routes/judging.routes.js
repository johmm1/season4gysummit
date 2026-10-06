// Y-Summit Season 4 2026 — judges platform API.
//
//   Judges (role JUDGE)         GET  /performances   performances to mark + their own marks
//                               GET  /criteria       criteria and weights for a category
//                               PUT  /events/:id/score   save / update their marks
//   Admins (SUPER_ADMIN, ADMIN, SPORTS_ADMIN)
//                               GET/POST /judges     list / create judge accounts
//                               PATCH /judges/:id    reset password / activate / deactivate
//                               GET  /events/:id/results  every judge's marks for a performance
//                               GET  /leaderboard    ranked results per category
//
// A judge only ever sees their own marks - never other judges' - so scores
// can't be influenced. Marks lock once a performance is marked COMPLETED.

const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { Op } = require("sequelize");
const { SportsEvent, JudgeScore, DanceScore, User } = require("../models");
const judging = require("../services/judgingService");
const planner = require("../services/fixturePlanner");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");
const { getForm } = require("../services/settingsService");
const { normalizePhone } = require("../services/mpesaService");

const router = Router();
const ADMINS = ["SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"];

const categorySchema = z.enum(judging.JUDGED_CATEGORIES);

async function danceWeights() {
  return getForm("danceScoringForm");
}

// ---------------------------- judge-facing ----------------------------

router.get(
  "/criteria",
  requireAuth,
  requireRole("JUDGE", ...ADMINS),
  asyncHandler(async (req, res) => {
    const category = categorySchema.parse(req.query.category);
    res.json({ category, criteria: judging.criteriaFor(category, await danceWeights()), max: judging.MAX_PER_CRITERION });
  })
);

router.get(
  "/performances",
  requireAuth,
  requireRole("JUDGE"),
  asyncHandler(async (req, res) => {
    const where = { category: { [Op.in]: judging.JUDGED_CATEGORIES } };
    if (req.query.category) where.category = categorySchema.parse(req.query.category);

    const events = await SportsEvent.findAll({
      where,
      include: [{ model: JudgeScore, as: "judgeScores", required: false, where: { judgeId: req.auth.userId } }],
      order: [["startsAt", "ASC"]],
    });
    const weights = await danceWeights();

    const items = events.map((e) => {
      const { date, time } = planner.splitEat(e.startsAt);
      const mine = (e.judgeScores || [])[0] || null;
      return {
        id: e.id,
        category: e.category,
        round: e.round,
        group: e.group,
        bracketSlot: e.bracketSlot,
        team: e.teamHome,
        venue: e.venue,
        date,
        time,
        status: e.status,
        locked: e.status === "COMPLETED",
        ready: Boolean(e.teamHome) && !/TBD/i.test(e.teamHome), // finals only become markable once finalists are known
        myScore: mine ? { scores: mine.scores, total: Number(mine.total), comments: mine.comments } : null,
      };
    });
    const criteria = {};
    for (const c of judging.JUDGED_CATEGORIES) criteria[c] = judging.criteriaFor(c, weights);
    res.json({ performances: items, criteria, max: judging.MAX_PER_CRITERION });
  })
);

const scoreSchema = z.object({
  scores: z.record(z.any()),
  comments: z.string().max(500).optional(),
});

router.put(
  "/events/:id/score",
  requireAuth,
  requireRole("JUDGE"),
  asyncHandler(async (req, res) => {
    const event = await SportsEvent.findByPk(req.params.id);
    if (!event || !judging.isJudged(event.category)) throw new ApiError(404, "Performance not found.");
    if (event.status === "COMPLETED") throw new ApiError(409, "This performance is closed — marks can no longer be changed.");
    if (!event.teamHome || /TBD/i.test(event.teamHome)) throw new ApiError(409, "This performance doesn't have a team yet.");

    const body = scoreSchema.parse(req.body);
    const criteria = judging.criteriaFor(event.category, await danceWeights());
    const check = judging.validateMarks(criteria, body.scores);
    if (!check.ok) throw new ApiError(400, check.error);
    const total = judging.computeTotal(criteria, check.scores);

    const existing = await JudgeScore.findOne({ where: { sportsEventId: event.id, judgeId: req.auth.userId } });
    if (existing) {
      await existing.update({ scores: check.scores, total, comments: body.comments || null });
    } else {
      await JudgeScore.create({ sportsEventId: event.id, judgeId: req.auth.userId, scores: check.scores, total, comments: body.comments || null });
    }
    await logAction(req.auth.userId, "JUDGE_SCORE_SAVED", "sports", event.id, { category: event.category, team: event.teamHome, total });
    res.json({ saved: true, total, scores: check.scores });
  })
);

// ---------------------------- admin-facing ----------------------------

router.get(
  "/judges",
  requireAuth,
  requireRole(...ADMINS),
  asyncHandler(async (_req, res) => {
    const judges = await User.findAll({
      where: { role: "JUDGE" },
      attributes: ["id", "fullName", "email", "phone", "isActive", "createdAt"],
      order: [["fullName", "ASC"]],
    });
    const counts = await JudgeScore.findAll({ attributes: ["judgeId"], raw: true });
    const byJudge = {};
    for (const c of counts) byJudge[c.judgeId] = (byJudge[c.judgeId] || 0) + 1;
    res.json({ judges: judges.map((j) => ({ ...j.toJSON(), marked: byJudge[j.id] || 0 })) });
  })
);

const createJudgeSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(9).max(20),
  password: z.string().min(8).max(100),
});

router.post(
  "/judges",
  requireAuth,
  requireRole(...ADMINS),
  asyncHandler(async (req, res) => {
    const body = createJudgeSchema.parse(req.body);
    const email = body.email.toLowerCase();
    const phone = normalizePhone(body.phone);
    if (await User.findOne({ where: { email } })) throw new ApiError(409, "An account with this email already exists.");
    if (await User.findOne({ where: { phone } })) throw new ApiError(409, "An account with this phone number already exists.");
    const judge = await User.create({
      fullName: body.fullName,
      email,
      phone,
      passwordHash: await bcrypt.hash(body.password, 12),
      isVerified: true,
      role: "JUDGE",
    });
    await logAction(req.auth.userId, "JUDGE_CREATED", "sports", judge.id, { email });
    res.status(201).json({ judge: { id: judge.id, fullName: judge.fullName, email: judge.email, phone: judge.phone } });
  })
);

const patchJudgeSchema = z.object({
  password: z.string().min(8).max(100).optional(),
  isActive: z.boolean().optional(),
});

router.patch(
  "/judges/:id",
  requireAuth,
  requireRole(...ADMINS),
  asyncHandler(async (req, res) => {
    const judge = await User.findOne({ where: { id: req.params.id, role: "JUDGE" } });
    if (!judge) throw new ApiError(404, "Judge not found.");
    const body = patchJudgeSchema.parse(req.body);
    if (body.password) judge.passwordHash = await bcrypt.hash(body.password, 12);
    if (body.isActive !== undefined) judge.isActive = body.isActive;
    await judge.save();
    await logAction(req.auth.userId, "JUDGE_UPDATED", "sports", judge.id, { passwordReset: Boolean(body.password), isActive: body.isActive });
    res.json({ updated: true });
  })
);

router.get(
  "/events/:id/results",
  requireAuth,
  requireRole(...ADMINS),
  asyncHandler(async (req, res) => {
    const event = await SportsEvent.findByPk(req.params.id, {
      include: [
        { model: JudgeScore, as: "judgeScores", required: false, include: [{ model: User, as: "judge", attributes: ["id", "fullName"] }] },
        { model: DanceScore, as: "danceScores", required: false },
      ],
    });
    if (!event || !judging.isJudged(event.category)) throw new ApiError(404, "Performance not found.");
    const weights = await danceWeights();
    res.json({
      team: event.teamHome,
      category: event.category,
      criteria: judging.criteriaFor(event.category, weights),
      marks: event.judgeScores.map((s) => ({ judge: s.judge?.fullName || "Judge", scores: s.scores, total: Number(s.total), comments: s.comments })),
      average: judging.eventAverage(event, weights),
    });
  })
);

router.get(
  "/leaderboard",
  requireAuth,
  requireRole(...ADMINS),
  asyncHandler(async (req, res) => {
    const category = categorySchema.parse(req.query.category || "Dance");
    const events = await SportsEvent.findAll({
      where: { category },
      include: [
        { model: JudgeScore, as: "judgeScores", required: false },
        { model: DanceScore, as: "danceScores", required: false },
      ],
      order: [["startsAt", "ASC"]],
    });
    const weights = await danceWeights();
    const rows = events
      .filter((e) => e.teamHome && !/TBD/i.test(e.teamHome))
      .map((e) => ({
        id: e.id,
        team: e.teamHome,
        round: e.round,
        group: e.group,
        judges: judging.judgeCount(e),
        average: judging.eventAverage(e, weights),
      }));
    const ranked = rows
      .filter((r) => r.average !== null)
      .sort((a, b) => b.average - a.average)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    const unmarked = rows.filter((r) => r.average === null);
    res.json({ category, ranked, unmarked });
  })
);

module.exports = router;
