// GY Summit 2026 — presbytery/parish/church dropdown data
const { Router } = require("express");
const { z } = require("zod");
const { Presbytery, Parish, Church } = require("../models");
const { asyncHandler } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = Router();

router.get(
  "/presbyteries",
  asyncHandler(async (_req, res) => {
    const items = await Presbytery.findAll({ order: [["name", "ASC"]] });
    res.json({ items });
  })
);

router.get(
  "/parishes",
  asyncHandler(async (req, res) => {
    const presbyteryId = req.query.presbyteryId;
    const items = await Parish.findAll({
      where: presbyteryId ? { presbyteryId } : {},
      order: [["name", "ASC"]],
    });
    res.json({ items });
  })
);

router.get(
  "/churches",
  asyncHandler(async (req, res) => {
    const parishId = req.query.parishId;
    if (!parishId) return res.json({ items: [] }); // churches load only after a parish is picked
    const items = await Church.findAll({ where: { parishId }, order: [["name", "ASC"]] });
    res.json({ items });
  })
);

// ---- Admin management of the structure ----

router.post(
  "/parishes",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().min(2).max(120), presbyteryId: z.coerce.number().int() }).parse(req.body);
    const parish = await Parish.create(body);
    res.status(201).json({ parish });
  })
);

router.post(
  "/churches",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().min(2).max(120), parishId: z.coerce.number().int() }).parse(req.body);
    const church = await Church.create(body);
    res.status(201).json({ church });
  })
);

router.get(
  "/parishes/overview",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"),
  asyncHandler(async (_req, res) => {
    const { User, SportsTeam, SportsEvent } = require("../models");
    const parishes = await Parish.findAll({
      include: [{ model: Presbytery, attributes: ["id", "name"] }],
      order: [["name", "ASC"]],
    });

    // Compute real standings once from every completed fixture, then fold
    // per-parish (a parish can field a team in each of Football/Volleyball/
    // Dance, so its "standing" is the sum across all of them).
    const completedEvents = await SportsEvent.findAll({
      where: { status: "COMPLETED" },
      attributes: ["teamHome", "teamAway", "scoreHome", "scoreAway"],
    });
    const pointsByTeamName = new Map();
    for (const e of completedEvents) {
      if (!e.teamHome || !e.teamAway || e.scoreHome == null || e.scoreAway == null) continue;
      const ensure = (name) => {
        if (!pointsByTeamName.has(name)) pointsByTeamName.set(name, { played: 0, won: 0, drawn: 0, lost: 0, points: 0 });
        return pointsByTeamName.get(name);
      };
      const home = ensure(e.teamHome);
      const away = ensure(e.teamAway);
      home.played++; away.played++;
      if (e.scoreHome > e.scoreAway) { home.won++; home.points += 3; away.lost++; }
      else if (e.scoreAway > e.scoreHome) { away.won++; away.points += 3; home.lost++; }
      else { home.drawn++; away.drawn++; home.points += 1; away.points += 1; }
    }

    const overview = await Promise.all(
      parishes.map(async (parish) => {
        const [churchCount, participantCount, teams] = await Promise.all([
          Church.count({ where: { parishId: parish.id } }),
          User.count({ where: { parishId: parish.id, role: "PARTICIPANT" } }),
          SportsTeam.findAll({ where: { parishId: parish.id } }),
        ]);

        const standing = teams.reduce(
          (acc, team) => {
            const s = pointsByTeamName.get(team.name);
            if (!s) return acc;
            acc.played += s.played;
            acc.won += s.won;
            acc.drawn += s.drawn;
            acc.lost += s.lost;
            acc.points += s.points;
            return acc;
          },
          { played: 0, won: 0, drawn: 0, lost: 0, points: 0 }
        );

        return { ...parish.toJSON(), churchCount, participantCount, teamCount: teams.length, standing };
      })
    );

    overview.sort((a, b) => b.standing.points - a.standing.points);
    res.json({ items: overview });
  })
);

const renameSchema = z.object({ name: z.string().min(2).max(120) });

router.patch(
  "/parishes/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { name } = renameSchema.parse(req.body);
    const { SportsTeam, SportsEvent } = require("../models");
    const { Op } = require("sequelize");

    const parish = await Parish.findByPk(req.params.id);
    if (!parish) return res.status(404).json({ error: "Parish not found" });

    const oldName = parish.name;
    parish.name = name;
    await parish.save();

    if (oldName !== name) {
      // Keep every sports team's display name and any fixtures that
      // reference the old name (free-text teamHome/teamAway) in sync —
      // otherwise standings/bracket lookups (which match by name) would
      // silently break after a rename.
      const teams = await SportsTeam.findAll({ where: { parishId: parish.id } });
      for (const team of teams) {
        const newTeamName = team.name.replace(oldName, name);
        if (newTeamName === team.name) continue;
        await SportsEvent.update(
          { teamHome: newTeamName },
          { where: { teamHome: team.name } }
        );
        await SportsEvent.update(
          { teamAway: newTeamName },
          { where: { teamAway: team.name } }
        );
        team.name = newTeamName;
        await team.save();
      }
    }

    res.json({ parish });
  })
);

router.get(
  "/churches/manage",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const items = await Church.findAll({
      include: [{ model: Parish, attributes: ["id", "name"], include: [{ model: Presbytery, attributes: ["id", "name"] }] }],
      order: [["name", "ASC"]],
    });
    res.json({ items });
  })
);

router.patch(
  "/churches/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { name } = renameSchema.parse(req.body);
    const church = await Church.findByPk(req.params.id);
    if (!church) return res.status(404).json({ error: "Church not found" });
    church.name = name;
    await church.save();
    res.json({ church });
  })
);

router.delete(
  "/churches/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { User } = require("../models");
    const memberCount = await User.count({ where: { churchId: req.params.id } });
    if (memberCount > 0) {
      return res.status(409).json({ error: `Can't delete — ${memberCount} registered participant(s) belong to this church.` });
    }
    const deleted = await Church.destroy({ where: { id: req.params.id } });
    if (!deleted) return res.status(404).json({ error: "Church not found" });
    res.status(204).send();
  })
);

module.exports = router;
