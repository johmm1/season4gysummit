// GY Summit 2026 — certificates
// Certificates are generated on demand as PDFs (see services/certificateService.js).
// This route only tracks *eligibility* (who has been issued one) — no files are
// pre-rendered or stored, exactly like the admission pass pattern.
const { Router } = require("express");
const { z } = require("zod");
const {
  Certificate, User, Registration, SportsEvent, SportsTeam, SportsTeamMember,
} = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { generateCertificatePdf, generateCertificatePdfBatch } = require("../services/certificateService");
const { notify } = require("../services/notificationService");
const { logAction } = require("../services/auditService");

const router = Router();

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const certificates = await Certificate.findAll({ where: { userId: req.auth.userId } });
    res.json({ certificates });
  })
);

router.get(
  "/me/:id/pdf",
  requireAuth,
  asyncHandler(async (req, res) => {
    const cert = await Certificate.findOne({ where: { id: req.params.id, userId: req.auth.userId } });
    if (!cert) throw new ApiError(404, "Certificate not found");
    const user = await User.findByPk(req.auth.userId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gy-summit-2026-${cert.type.toLowerCase()}.pdf"`);
    await generateCertificatePdf({ userFullName: user.fullName, type: cert.type, category: cert.category, serial: cert.serial }, res);
  })
);

router.use(requireAuth, requireRole(...ADMIN_ROLES));

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const certificates = await Certificate.findAll({ include: [{ model: User, attributes: ["id", "fullName"] }] });
    const byType = certificates.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {});
    res.json({ total: certificates.length, byType, certificates });
  })
);

// Every issued certificate matching the filter, combined into ONE
// multi-page PDF (one certificate per page) — meant to be sent straight
// to a printer, instead of an admin downloading and printing hundreds of
// individual participant PDFs one at a time.
const downloadAllSchema = z.object({
  type: z.enum(["PARTICIPATION", "SPORTS_WINNER"]).optional(),
  category: z.string().max(60).optional(),
});

router.get(
  "/download-all",
  asyncHandler(async (req, res) => {
    const { type, category } = downloadAllSchema.parse(req.query);
    const where = {};
    if (type) where.type = type;
    if (category) where.category = category;

    const certificates = await Certificate.findAll({
      where,
      include: [{ model: User, attributes: ["fullName"] }],
      order: [["type", "ASC"], ["category", "ASC"], ["serial", "ASC"]],
    });

    if (!certificates.length) throw new ApiError(404, "No certificates match that filter — generate some first.");

    const items = certificates.map((c) => ({
      userFullName: c.User.fullName,
      type: c.type,
      category: c.category,
      serial: c.serial,
    }));

    const label = [type, category].filter(Boolean).join("-").toLowerCase() || "all";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gy-summit-2026-certificates-${label}.pdf"`);
    await generateCertificatePdfBatch(items, res);

    await logAction(req.auth.userId, "CERTIFICATES_BULK_DOWNLOADED", "certificates", null, { type: type || "ALL", category: category || null, count: items.length });
  })
);

const generateSchema = z.object({
  type: z.enum(["PARTICIPATION", "SPORTS_WINNER"]),
});

router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const { type } = generateSchema.parse(req.body);

    if (type === "PARTICIPATION") {
      const eligible = await User.findAll({
        where: { role: "PARTICIPANT" },
        include: [{ model: Registration, as: "registration", where: { status: "CONFIRMED" } }],
      });
      let created = 0;
      for (const user of eligible) {
        const [, wasCreated] = await Certificate.findOrCreate({
          where: { userId: user.id, type: "PARTICIPATION", category: null },
        });
        if (wasCreated) {
          created++;
          notify("notifyCertificates", "certificateTemplate", { email: user.email, phone: user.phone },
            "GY Summit 2026 — Your certificate is ready",
            { name: user.fullName, type: "Participation" });
        }
      }
      return res.json({ issued: created, eligible: eligible.length });
    }

    const categories = ["Football", "Volleyball", "Dance"];
    let created = 0;
    let teamsAwarded = 0;

    for (const category of categories) {
      const events = await SportsEvent.findAll({ where: { category } });
      let winningTeamName = null;

      const final = events.find((e) => e.bracketSlot === "FINAL" && e.status === "COMPLETED");
      if (final && final.scoreHome != null && final.scoreAway != null && final.scoreHome !== final.scoreAway) {
        winningTeamName = final.scoreHome > final.scoreAway ? final.teamHome : final.teamAway;
      } else {
        const groupResults = events.filter((e) => e.round === "GROUP" && e.status === "COMPLETED" && e.teamHome && e.teamAway);
        const table = new Map();
        const ensure = (name) => {
          if (!table.has(name)) table.set(name, { pts: 0 });
          return table.get(name);
        };
        for (const e of groupResults) {
          const home = ensure(e.teamHome);
          const away = ensure(e.teamAway);
          if (e.scoreHome > e.scoreAway) home.pts += 3;
          else if (e.scoreAway > e.scoreHome) away.pts += 3;
          else { home.pts += 1; away.pts += 1; }
        }
        const ranked = [...table.entries()].sort((a, b) => b[1].pts - a[1].pts);
        if (ranked.length) winningTeamName = ranked[0][0];
      }

      if (!winningTeamName) continue;

      const team = await SportsTeam.findOne({ where: { category, name: winningTeamName } });
      if (!team) continue;

      const members = await SportsTeamMember.findAll({ where: { sportsTeamId: team.id } });
      teamsAwarded++;
      for (const member of members) {
        const [, wasCreated] = await Certificate.findOrCreate({
          where: { userId: member.userId, type: "SPORTS_WINNER", category },
        });
        if (wasCreated) created++;
      }
    }

    res.json({ issued: created, teamsAwarded });
  })
);

module.exports = router;
