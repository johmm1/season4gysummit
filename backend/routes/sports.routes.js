// Y-Summit Season 4 2026 — sports fixtures, results, entries
const { Router } = require("express");
const { z } = require("zod");
const { Op } = require("sequelize");
const { sequelize, SportsEvent, SportsEntry, SportsTeam, SportsTeamMember, DanceScore, JudgeScore, User, Parish } = require("../models");
const planner = require("../services/fixturePlanner");
const judging = require("../services/judgingService");
const { requireAuth, requireRole } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");
const { getForm } = require("../services/settingsService");

const router = Router();

// Sports > General > Enable Football/Volleyball/Dance — a real switch on
// whether new fixtures can be created in that category, not just a label.
async function assertCategoryEnabled(category) {
  const general = await getForm("generalSportsForm");
  const c = category.toLowerCase();
  if (c.includes("football") && general.enableFootball === false) {
    throw new ApiError(403, "Football is currently disabled in Sports settings.");
  }
  if (c.includes("volleyball") && general.enableVolleyball === false) {
    throw new ApiError(403, "Volleyball is currently disabled in Sports settings.");
  }
  if (c.includes("dance") && general.enableDance === false) {
    throw new ApiError(403, "Dance is currently disabled in Sports settings.");
  }
  if (c.includes("folk") && general.enableFolkSong === false) {
    throw new ApiError(403, "Folk Song is currently disabled in Sports settings.");
  }
}

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const memberships = await SportsTeamMember.findAll({
      where: { userId: req.auth.userId },
      include: [{ model: SportsTeam, include: [{ model: Parish, attributes: ["id", "name"] }] }],
    });
    res.json({ memberships });
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = req.query.category ? { category: req.query.category } : {};
    const events = await SportsEvent.findAll({ where, order: [["startsAt", "ASC"]] });
    res.json({ events });
  })
);

const eventSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().min(2).max(60),
  gender: z.enum(["MALE", "FEMALE", "MIXED"]),
  startsAt: z.string(),
  venue: z.string().min(2).max(120),
  teamHome: z.string().max(80).optional(),
  teamAway: z.string().max(80).optional(),
  round: z.enum(["GROUP", "QUARTER", "SEMI", "FINAL"]).optional(),
  group: z.string().max(1).optional(),
  bracketSlot: z.string().max(10).optional(),
});

router.post(
  "/",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = eventSchema.parse(req.body);
    await assertCategoryEnabled(body.category);
    const event = await SportsEvent.create(body);
    res.status(201).json({ event });
  })
);

// Knockouts are semi-finals then the final (only the four group winners
// qualify), so a manual bracket is 4 teams (two semi-finals) or 2 (a final).
// QUARTER stays in the round ENUM only so older saved fixtures still load.
const BRACKET_SIZES = {
  2: { round: "FINAL", slots: ["F"] },
  4: { round: "SEMI", slots: ["SF1", "SF2"] },
};
const NEXT_ROUND = { QUARTER: "SEMI", SEMI: "FINAL" };
// Which next-round slot (and home/away position within it) each
// current-round slot feeds into.
const ADVANCE_MAP = {
  SF1: { slot: "F", side: "teamHome" }, SF2: { slot: "F", side: "teamAway" },
};

const bracketSchema = z.object({
  category: z.string().min(2).max(60),
  gender: z.enum(["MALE", "FEMALE", "MIXED"]).default("MIXED"),
  venue: z.string().min(2).max(120),
  teams: z.array(z.string().min(1).max(80)).refine((t) => [2, 4].includes(t.length), {
    message: "Bracket size must be exactly 4 teams (two semi-finals then the final) or 2 teams (a final).",
  }),
  firstRoundStartsAt: z.string(),
  roundGapHours: z.number().positive().default(24),
});

router.post(
  "/generate-bracket",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = bracketSchema.parse(req.body);
    await assertCategoryEnabled(body.category);

    const { round, slots } = BRACKET_SIZES[body.teams.length];
    const start = new Date(body.firstRoundStartsAt);
    const created = [];

    // Round 1 — real pairings from the given team list.
    for (let i = 0; i < slots.length; i++) {
      const startsAt = new Date(start.getTime() + i * 20 * 60000); // stagger kickoffs 20 min apart
      const event = await SportsEvent.create({
        name: `${body.category} ${round === "QUARTER" ? "Quarter-Final" : round === "SEMI" ? "Semi-Final" : "Final"} — ${slots[i]}`,
        category: body.category,
        gender: body.gender,
        venue: body.venue,
        startsAt,
        round,
        bracketSlot: slots[i],
        teamHome: body.teams[i * 2],
        teamAway: body.teams[i * 2 + 1],
      });
      created.push(event);
    }

    // Placeholder fixtures for later rounds — filled in automatically by
    // the PATCH /:id winner-advancement logic below as each match completes.
    let nextRound = NEXT_ROUND[round];
    let roundIndex = 1;
    while (nextRound) {
      const remainingTeams = body.teams.length / Math.pow(2, roundIndex);
      const nextInfo = BRACKET_SIZES[remainingTeams];
      if (!nextInfo) break;
      for (let i = 0; i < nextInfo.slots.length; i++) {
        const startsAt = new Date(start.getTime() + roundIndex * body.roundGapHours * 3600000 + i * 20 * 60000);
        const event = await SportsEvent.create({
          name: `${body.category} ${nextInfo.round === "SEMI" ? "Semi-Final" : "Final"} — ${nextInfo.slots[i]}`,
          category: body.category,
          gender: body.gender,
          venue: body.venue,
          startsAt,
          round: nextInfo.round,
          bracketSlot: nextInfo.slots[i],
          teamHome: null,
          teamAway: null,
        });
        created.push(event);
      }
      nextRound = NEXT_ROUND[nextInfo.round];
      roundIndex++;
    }

    await logAction(req.auth.userId, "BRACKET_GENERATED", "sports", null, { category: body.category, teams: body.teams.length });
    res.status(201).json({ events: created });
  })
);

const updateSchema = z.object({
  status: z.enum(["SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"]).optional(),
  scoreHome: z.number().int().optional(),
  scoreAway: z.number().int().optional(),
  teamHome: z.string().max(80).optional(),
  teamAway: z.string().max(80).optional(),
  venue: z.string().max(120).optional(),
  startsAt: z.string().optional(),
  round: z.enum(["GROUP", "QUARTER", "SEMI", "FINAL"]).optional(),
  group: z.string().max(1).optional(),
  bracketSlot: z.string().max(10).optional(),
  gender: z.enum(["MALE", "FEMALE", "MIXED"]).optional(),
});

router.patch(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const event = await SportsEvent.findByPk(req.params.id);
    if (!event) throw new ApiError(404, "Event not found");
    await event.update(body);

    // Bracket winner advancement — if this result completes a QUARTER or
    // SEMI fixture with a decisive score, drop the winning team's name
    // into the placeholder slot in the next round created by
    // /generate-bracket, instead of an admin having to copy it over by hand.
    if (
      event.status === "COMPLETED" &&
      event.bracketSlot &&
      ADVANCE_MAP[event.bracketSlot] &&
      event.scoreHome !== null &&
      event.scoreAway !== null &&
      event.scoreHome !== event.scoreAway
    ) {
      const winner = event.scoreHome > event.scoreAway ? event.teamHome : event.teamAway;
      const { slot: nextSlot, side } = ADVANCE_MAP[event.bracketSlot];
      const nextEvent = await SportsEvent.findOne({
        where: { category: event.category, bracketSlot: nextSlot },
      });
      if (nextEvent) {
        await nextEvent.update({ [side]: winner });
      }
    }

    res.json({ event });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const deleted = await SportsEvent.destroy({ where: { id: req.params.id } });
    if (!deleted) throw new ApiError(404, "Event not found");
    res.status(204).send();
  })
);

router.post(
  "/:id/join",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ teamName: z.string().max(80).optional() }).parse(req.body);
    const event = await SportsEvent.findByPk(req.params.id);
    if (!event) throw new ApiError(404, "Event not found");

    const [entry] = await SportsEntry.upsert(
      { sportsEventId: event.id, userId: req.auth.userId, teamName: body.teamName },
      { returning: true }
    );
    res.status(201).json({ entry });
  })
);

// ---- Teams (seeded per parish/category — never created from the app) ----

router.get(
  "/teams",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.category) where.category = req.query.category;
    if (req.query.parishId) where.parishId = req.query.parishId;

    const teams = await SportsTeam.findAll({
      where,
      include: [
        { model: Parish, attributes: ["id", "name"] },
        { model: SportsTeamMember, as: "members", attributes: ["id"] },
      ],
      order: [["category", "ASC"], ["name", "ASC"]],
    });
    res.json({
      teams: teams.map((t) => ({ ...t.toJSON(), memberCount: t.members.length })),
    });
  })
);

router.get(
  "/teams/:id/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const team = await SportsTeam.findByPk(req.params.id);
    if (!team) throw new ApiError(404, "Team not found");
    const members = await SportsTeamMember.findAll({
      where: { sportsTeamId: team.id },
      include: [{ model: User, as: "user", attributes: ["id", "fullName", "gender", "dateOfBirth", "avatarUrl"] }],
      order: [["isCaptain", "DESC"], ["createdAt", "ASC"]],
    });
    res.json({ team, members });
  })
);

const teamUpdateSchema = z.object({
  coachName: z.string().max(120).optional(),
  chairpersonName: z.string().max(120).optional(),
  chairpersonPhone: z.string().max(20).optional(),
});

router.patch(
  "/teams/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = teamUpdateSchema.parse(req.body);
    const team = await SportsTeam.findByPk(req.params.id);
    if (!team) throw new ApiError(404, "Team not found — teams are pre-set per parish and can't be created here.");
    await team.update(body);
    res.json({ team });
  })
);

const memberSchema = z.object({
  userId: z.string().uuid(),
  position: z.string().max(60).optional(),
  jerseyNumber: z.number().int().positive().optional(),
  isCaptain: z.boolean().optional(),
});

router.post(
  "/teams/:id/members",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = memberSchema.parse(req.body);
    const team = await SportsTeam.findByPk(req.params.id);
    if (!team) throw new ApiError(404, "Team not found — teams are pre-set per parish and can't be created here.");

    const user = await User.findByPk(body.userId);
    if (!user || user.role !== "PARTICIPANT") throw new ApiError(404, "Participant not found");
    if (user.parishId !== team.parishId) {
      throw new ApiError(400, "This participant belongs to a different parish than this team.");
    }

    const existing = await SportsTeamMember.findOne({ where: { sportsTeamId: team.id, userId: user.id } });
    if (existing) throw new ApiError(409, "This participant is already on the team.");

    const member = await SportsTeamMember.create({ ...body, sportsTeamId: team.id });
    res.status(201).json({ member });
    await logAction(req.auth.userId, "ROSTER_MEMBER_ADDED", "sports_roster", team.id, { userId: user.id, team: team.name });
  })
);

const memberUpdateSchema = z.object({
  position: z.string().max(60).optional(),
  jerseyNumber: z.number().int().positive().nullable().optional(),
  isCaptain: z.boolean().optional(),
  isEligible: z.boolean().optional(),
});

router.patch(
  "/teams/:id/members/:userId",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = memberUpdateSchema.parse(req.body);
    const member = await SportsTeamMember.findOne({ where: { sportsTeamId: req.params.id, userId: req.params.userId } });
    if (!member) throw new ApiError(404, "This participant is not on the team.");
    await member.update(body);
    res.json({ member });
  })
);

router.delete(
  "/teams/:id/members/:userId",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const deleted = await SportsTeamMember.destroy({ where: { sportsTeamId: req.params.id, userId: req.params.userId } });
    if (!deleted) throw new ApiError(404, "This participant is not on the team.");
    res.status(204).send();
    await logAction(req.auth.userId, "ROSTER_MEMBER_REMOVED", "sports_roster", req.params.id, { userId: req.params.userId });
  })
);

// ---- Standings (Football/Volleyball — points table from completed fixtures) ----

router.get(
  "/standings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const category = req.query.category;
    if (!category) throw new ApiError(400, "category query param is required");

    const rules = await getForm("footballRulesForm");
    const winPoints = Number(rules.footballWinPoints) || 3;
    const drawPoints = Number(rules.footballDrawPoints) || 1;

    const events = await SportsEvent.findAll({
      where: { category, status: "COMPLETED", round: "GROUP" },
    });

    const table = {};
    const ensure = (name, group) => {
      if (!table[name]) table[name] = { team: name, group, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 };
      return table[name];
    };

    for (const e of events) {
      if (e.scoreHome === null || e.scoreAway === null || !e.teamHome || !e.teamAway) continue;
      const home = ensure(e.teamHome, e.group);
      const away = ensure(e.teamAway, e.group);
      home.played++; away.played++;
      home.gf += e.scoreHome; home.ga += e.scoreAway;
      away.gf += e.scoreAway; away.ga += e.scoreHome;
      if (e.scoreHome > e.scoreAway) { home.won++; away.lost++; home.points += winPoints; }
      else if (e.scoreHome < e.scoreAway) { away.won++; home.lost++; away.points += winPoints; }
      else { home.drawn++; away.drawn++; home.points += drawPoints; away.points += drawPoints; }
    }

    const standings = Object.values(table).sort(
      (a, b) => b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga)
    );
    res.json({ standings, pointsRule: { winPoints, drawPoints } });
  })
);

// ---- Dance judging ----

const danceScoreSchema = z.object({
  judgeName: z.string().min(2).max(120),
  themeScore: z.number().min(0).max(100),
  creativityScore: z.number().min(0).max(100),
  syncScore: z.number().min(0).max(100),
  presenceScore: z.number().min(0).max(100),
  costumeScore: z.number().min(0).max(100),
  comments: z.string().max(500).optional(),
});

router.post(
  "/:id/dance-scores",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const event = await SportsEvent.findByPk(req.params.id);
    if (!event) throw new ApiError(404, "Event not found");
    const body = danceScoreSchema.parse(req.body);

    const [score] = await DanceScore.upsert(
      { ...body, sportsEventId: event.id },
      { returning: true }
    );
    res.status(201).json({ score });
    await logAction(req.auth.userId, "DANCE_SCORE_SUBMITTED", "sports", event.id, { judgeName: body.judgeName });
  })
);

// Weighted total per Sports > Dance Scoring settings — defaults to equal
// 20% weights (matching the admin UI's default sliders) if unset.
function weightedTotal(score, weights) {
  const w = {
    theme: Number(weights.danceWeightTheme ?? 20),
    creativity: Number(weights.danceWeightCreativity ?? 20),
    sync: Number(weights.danceWeightSync ?? 20),
    presence: Number(weights.danceWeightPresence ?? 20),
    costume: Number(weights.danceWeightCostume ?? 20),
  };
  const totalWeight = w.theme + w.creativity + w.sync + w.presence + w.costume || 100;
  const raw =
    (score.themeScore * w.theme) +
    (score.creativityScore * w.creativity) +
    (score.syncScore * w.sync) +
    (score.presenceScore * w.presence) +
    (score.costumeScore * w.costume);
  return raw / totalWeight;
}

router.get(
  "/:id/dance-scores",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const scores = await DanceScore.findAll({ where: { sportsEventId: req.params.id } });
    const weights = await getForm("danceScoringForm");
    const withTotals = scores.map((s) => ({ ...s.toJSON(), weightedTotal: weightedTotal(s, weights) }));
    const average = withTotals.length ? withTotals.reduce((sum, s) => sum + s.weightedTotal, 0) / withTotals.length : null;
    res.json({ scores: withTotals, average });
  })
);

// Ranks every Dance performance by average weighted judge score — the
// leaderboard Dance Competition > "Winner Criteria" points toward.
router.get(
  "/dance-leaderboard",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [events, weights] = await Promise.all([
      SportsEvent.findAll({ where: { category: "Dance" }, include: [{ model: DanceScore, as: "danceScores" }] }),
      getForm("danceScoringForm"),
    ]);

    const leaderboard = events
      .map((e) => {
        const scores = e.danceScores || [];
        const average = scores.length
          ? scores.reduce((sum, s) => sum + weightedTotal(s, weights), 0) / scores.length
          : null;
        return { eventId: e.id, name: e.name, teamHome: e.teamHome, judgeCount: scores.length, average };
      })
      .filter((r) => r.average !== null)
      .sort((a, b) => b.average - a.average);

    res.json({ leaderboard });
  })
);

// ---- Groups, day-by-day planning, advancement -------------------------------
//
// POST /plan-fixtures        build groups + fixtures for a category and spread
//                            them over the event days (preview or save)
// POST /advance-from-groups  once group fixtures/heats are done, put the
//                            qualifiers into the knockout / final slots
// GET  /groups               group tables (or heat rankings for Dance)
// GET  /schedule             every fixture grouped by event day

const PLAN_CATEGORIES = ["Football", "Volleyball", "Dance", "Folk Song"];

const planSchema = z.object({
  category: z.enum(PLAN_CATEGORIES),
  groupCount: z.number().int().min(1).max(8).optional(), // judged competitions only; Football/Volleyball always use 4 groups
  days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  venues: z.array(z.string().min(1).max(120)).optional(),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
  maxPerDay: z.number().int().min(1).max(3).optional(),
  preview: z.boolean().default(false),
  replace: z.boolean().default(false),
});

function serializeFixture(f) {
  const { date, time } = planner.splitEat(f.startsAt);
  return {
    name: f.name, category: f.category, round: f.round, group: f.group, bracketSlot: f.bracketSlot,
    teamHome: f.teamHome, teamAway: f.teamAway, venue: f.venue, date, time, startsAt: new Date(f.startsAt).toISOString(),
  };
}

async function eventDates() {
  const general = await getForm("generalSettingsForm");
  const iso = (v, fallback) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : fallback);
  return { eventStart: iso(general.eventStart, "2026-12-15"), eventEnd: iso(general.eventEnd, "2026-12-19") };
}

router.post(
  "/plan-fixtures",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = planSchema.parse(req.body);
    await assertCategoryEnabled(body.category);

    // Every parish gets a team in each competition. Create any that are
    // missing (e.g. Folk Song was added after the original seed).
    const allParishes = await Parish.findAll();
    for (const parish of allParishes) {
      await SportsTeam.findOrCreate({
        where: { parishId: parish.id, category: body.category },
        defaults: { name: `${parish.name} ${body.category}`, gender: "MIXED" },
      });
    }
    const teams = await SportsTeam.findAll({ where: { category: body.category }, order: [["name", "ASC"]] });
    if (teams.length === 0) {
      throw new ApiError(400, `No parishes exist yet, so there are no ${body.category} teams to plan.`);
    }

    const planned = await SportsEvent.findAll({ where: { category: body.category, round: { [Op.ne]: null } } });
    if (planned.some((e) => e.status !== "SCHEDULED")) {
      throw new ApiError(409, `Some ${body.category} fixtures have already started or finished, so the plan can't be regenerated.`);
    }
    if (planned.length && !body.replace && !body.preview) {
      throw new ApiError(409, `${body.category} already has ${planned.length} planned fixtures. Send replace: true to rebuild them.`);
    }

    // Everything else on the calendar (other categories, manual fixtures)
    // must be respected so a parish is never double-booked.
    const plannedIds = new Set(planned.map((e) => e.id));
    const others = (await SportsEvent.findAll({ where: { status: { [Op.ne]: "CANCELLED" } } })).filter((e) => !plannedIds.has(e.id));
    const existing = others.map((e) => ({ startsAt: e.startsAt, venue: e.venue, teamHome: e.teamHome, teamAway: e.teamAway, category: e.category }));

    const dates = await eventDates();
    const common = {
      ...dates,
      days: body.days,
      groupCount: judging.isJudged(body.category) ? body.groupCount : undefined,
      venues: body.venues,
      existing,
      teams: teams.map((t) => t.name),
    };

    let plan;
    try {
      if (judging.isJudged(body.category)) {
        plan = planner.planJudged({ ...common, category: body.category });
      } else {
        const rules = body.category === "Football" ? await getForm("footballRulesForm") : {};
        const duration = Number(rules.footballDuration);
        plan = planner.planGroupCompetition({
          ...common,
          category: body.category,
          slots: body.slots,
          maxPerDay: body.maxPerDay,
          durationMin: Number.isFinite(duration) && duration >= 20 && duration <= 120 ? duration : undefined,
        });
      }
    } catch (err) {
      throw new ApiError(400, err.message);
    }

    const fixtures = plan.fixtures.sort((a, b) => a.startsAt - b.startsAt);
    const perDay = {};
    for (const f of fixtures) {
      const { date } = planner.splitEat(f.startsAt);
      perDay[date] = (perDay[date] || 0) + 1;
    }

    if (!body.preview) {
      await sequelize.transaction(async (transaction) => {
        if (planned.length) await SportsEvent.destroy({ where: { id: { [Op.in]: [...plannedIds] } }, transaction });
        await SportsEvent.bulkCreate(
          fixtures.map(({ matchday, ...f }) => f),
          { transaction }
        );
      });
      await logAction(req.auth.userId, "FIXTURES_PLANNED", "sports", null, { category: body.category, groups: plan.groupCount, fixtures: fixtures.length });
    }

    res.status(body.preview ? 200 : 201).json({
      preview: body.preview,
      category: body.category,
      groups: plan.groups,
      perDay,
      fixtures: fixtures.map(serializeFixture),
    });
  })
);

const advanceSchema = z.object({ category: z.enum(PLAN_CATEGORIES) });

function rankGroupTables(events, winPoints, drawPoints) {
  const groups = {};
  const row = (g, team) => {
    groups[g] = groups[g] || {};
    groups[g][team] = groups[g][team] || { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
    return groups[g][team];
  };
  for (const e of events) {
    if (!e.group || !e.teamHome || !e.teamAway) continue;
    const home = row(e.group, e.teamHome);
    const away = row(e.group, e.teamAway);
    if (e.status !== "COMPLETED" || e.scoreHome === null || e.scoreAway === null) continue;
    home.played++; away.played++;
    home.gf += e.scoreHome; home.ga += e.scoreAway;
    away.gf += e.scoreAway; away.ga += e.scoreHome;
    if (e.scoreHome > e.scoreAway) { home.won++; away.lost++; home.points += winPoints; }
    else if (e.scoreHome < e.scoreAway) { away.won++; home.lost++; away.points += winPoints; }
    else { home.drawn++; away.drawn++; home.points += drawPoints; away.points += drawPoints; }
  }
  const out = {};
  for (const [g, teams] of Object.entries(groups)) {
    out[g] = Object.values(teams)
      .map((t) => ({ ...t, gd: t.gf - t.ga }))
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  }
  return out;
}

router.post(
  "/advance-from-groups",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (req, res) => {
    const { category } = advanceSchema.parse(req.body);

    const judged = judging.isJudged(category);
    const groupEvents = await SportsEvent.findAll({
      where: { category, round: "GROUP" },
      include: judged
        ? [{ model: JudgeScore, as: "judgeScores", required: false }, ...(category === "Dance" ? [{ model: DanceScore, as: "danceScores", required: false }] : [])]
        : [],
    });
    if (!groupEvents.length) throw new ApiError(404, `No ${category} group fixtures found. Plan the fixtures first.`);

    const pending = groupEvents.filter((e) => e.status !== "COMPLETED");
    if (!judged && pending.length) {
      throw new ApiError(409, `${pending.length} group fixture(s) are still to be completed.`);
    }

    // ---------- Dance / Folk Song: top two per heat by judges' average ----------
    if (judged) {
      const unscored = groupEvents.filter((e) => judging.judgeCount(e) === 0);
      if (unscored.length) {
        throw new ApiError(409, `${unscored.length} performance(s) have no judge marks yet: ${unscored.map((e) => e.teamHome).join(", ")}.`);
      }
      const weights = await getForm("danceScoringForm");
      const scored = groupEvents.map((e) => ({ team: e.teamHome, group: e.group, average: judging.eventAverage(e, weights) }));
      const byGroup = {};
      for (const r of scored) (byGroup[r.group] = byGroup[r.group] || []).push(r);
      const finalists = Object.values(byGroup)
        .flatMap((list) => list.sort((a, b) => b.average - a.average).slice(0, 2))
        .sort((a, b) => a.average - b.average); // lowest-ranked performs first, best last

      const finals = await SportsEvent.findAll({ where: { category, round: "FINAL" }, order: [["startsAt", "ASC"]] });
      let filled = 0;
      for (let i = 0; i < finals.length && i < finalists.length; i++) {
        if (finals[i].status !== "SCHEDULED") continue;
        await finals[i].update({ teamHome: finalists[i].team });
        filled++;
      }
      await logAction(req.auth.userId, "FINALISTS_ADVANCED", "sports", null, { category, filled });
      return res.json({ category, finalists: finalists.map((f) => ({ team: f.team, group: f.group, average: Number(f.average.toFixed(2)) })), filled });
    }

    // ---------- Football / Volleyball: ONLY group winners go to the semi-finals ----------
    const rules = category === "Football" ? await getForm("footballRulesForm") : {};
    const winPoints = category === "Football" ? Number(rules.footballWinPoints) || 3 : 3;
    const drawPoints = category === "Football" ? Number(rules.footballDrawPoints) || 1 : 0;
    const tables = rankGroupTables(groupEvents, winPoints, drawPoints);
    const letters = Object.keys(tables).sort();
    const seeds = planner.KNOCKOUT_SEEDS[letters.length];
    if (!seeds) throw new ApiError(409, `${letters.length} groups can't be mapped onto the semi-finals (exactly 4 groups are needed).`);

    const warnings = [];
    for (const g of letters) {
      const t = tables[g];
      if (t.length < 2) throw new ApiError(409, `Group ${g} has fewer than two teams.`);
      if (t[0].points === t[1].points && t[0].gd === t[1].gd && t[0].gf === t[1].gf) {
        warnings.push(`Group ${g}: the top two teams (${t[0].team}, ${t[1].team}) are level on points, goal difference and goals scored — confirm the winner and edit the semi-final by hand if needed.`);
      }
    }

    const pick = ([rank, g]) => tables[g][rank - 1].team;
    const knockouts = await SportsEvent.findAll({ where: { category, bracketSlot: { [Op.in]: Object.keys(seeds) } } });
    let filled = 0;
    for (const ev of knockouts) {
      if (ev.status !== "SCHEDULED") continue;
      const [homeSeed, awaySeed] = seeds[ev.bracketSlot];
      await ev.update({ teamHome: pick(homeSeed), teamAway: pick(awaySeed) });
      filled++;
    }
    await logAction(req.auth.userId, "QUALIFIERS_ADVANCED", "sports", null, { category, filled });
    res.json({
      category,
      qualifiers: Object.fromEntries(letters.map((g) => [g, [tables[g][0].team]])),
      filled,
      warnings,
    });
  })
);

router.get(
  "/groups",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = { round: "GROUP" };
    if (req.query.category) where.category = req.query.category;
    const events = await SportsEvent.findAll({
      where,
      include: [
        { model: DanceScore, as: "danceScores", required: false },
        { model: JudgeScore, as: "judgeScores", required: false },
      ],
      order: [["startsAt", "ASC"]],
    });

    const rules = await getForm("footballRulesForm");
    const winPoints = Number(rules.footballWinPoints) || 3;
    const drawPoints = Number(rules.footballDrawPoints) || 1;
    const weights = await getForm("danceScoringForm");

    const result = [];
    for (const category of [...new Set(events.map((e) => e.category))].sort()) {
      const catEvents = events.filter((e) => e.category === category);
      if (judging.isJudged(category)) {
        const byGroup = {};
        for (const e of catEvents) {
          const average = judging.eventAverage(e, weights);
          (byGroup[e.group] = byGroup[e.group] || []).push({ team: e.teamHome, startsAt: e.startsAt, venue: e.venue, judgeCount: judging.judgeCount(e), average });
        }
        for (const g of Object.keys(byGroup).sort()) {
          const teams = byGroup[g].sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || new Date(a.startsAt) - new Date(b.startsAt));
          result.push({ category, group: g, type: "heat", teams });
        }
      } else {
        const tables = rankGroupTables(catEvents, category === "Football" ? winPoints : 3, category === "Football" ? drawPoints : 0);
        for (const g of Object.keys(tables).sort()) result.push({ category, group: g, type: "table", teams: tables[g] });
      }
    }
    res.json({ groups: result });
  })
);

router.get(
  "/schedule",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = {};
    if (req.query.category) where.category = req.query.category;
    const events = await SportsEvent.findAll({ where, order: [["startsAt", "ASC"]] });

    const days = new Map();
    for (const e of events) {
      const { date, time } = planner.splitEat(e.startsAt);
      if (req.query.date && req.query.date !== date) continue;
      if (!days.has(date)) {
        const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
        days.set(date, { date, label, events: [] });
      }
      days.get(date).events.push({
        id: e.id, name: e.name, category: e.category, gender: e.gender, venue: e.venue, time,
        startsAt: e.startsAt, round: e.round, group: e.group, bracketSlot: e.bracketSlot,
        teamHome: e.teamHome, teamAway: e.teamAway, status: e.status, scoreHome: e.scoreHome, scoreAway: e.scoreAway,
      });
    }
    res.json({ days: [...days.values()] });
  })
);

module.exports = router;
