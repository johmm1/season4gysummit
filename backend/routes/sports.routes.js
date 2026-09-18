// GY Summit 2026 — sports fixtures, results, entries
const { Router } = require("express");
const { z } = require("zod");
const { SportsEvent, SportsEntry, SportsTeam, SportsTeamMember, DanceScore, User, Parish } = require("../models");
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

// Standard single-elimination bracket. The round ENUM (GROUP/QUARTER/
// SEMI/FINAL) caps this at 8 teams — 16+ would need a ROUND_OF_16 value
// added to the schema, so larger fields are rejected with a clear message
// rather than silently mis-seeded.
const BRACKET_SIZES = {
  2: { round: "FINAL", slots: ["F"] },
  4: { round: "SEMI", slots: ["SF1", "SF2"] },
  8: { round: "QUARTER", slots: ["QF1", "QF2", "QF3", "QF4"] },
};
const NEXT_ROUND = { QUARTER: "SEMI", SEMI: "FINAL" };
// Which next-round slot (and home/away position within it) each
// current-round slot feeds into.
const ADVANCE_MAP = {
  QF1: { slot: "SF1", side: "teamHome" }, QF2: { slot: "SF1", side: "teamAway" },
  QF3: { slot: "SF2", side: "teamHome" }, QF4: { slot: "SF2", side: "teamAway" },
  SF1: { slot: "F", side: "teamHome" }, SF2: { slot: "F", side: "teamAway" },
};

const bracketSchema = z.object({
  category: z.string().min(2).max(60),
  gender: z.enum(["MALE", "FEMALE", "MIXED"]).default("MIXED"),
  venue: z.string().min(2).max(120),
  teams: z.array(z.string().min(1).max(80)).refine((t) => [2, 4, 8].includes(t.length), {
    message: "Bracket size must be exactly 2, 4, or 8 teams (the current round schema doesn't support Round of 16+).",
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

module.exports = router;
