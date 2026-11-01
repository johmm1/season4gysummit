// Y-Summit Season 4 2026 — downloadable PDF exports (fixtures, players)
const { Router } = require("express");
const { SportsEvent, SportsTeam, SportsTeamMember, SportsEntry, User, Parish } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");
const { createDoc, sectionTitle, table, finish } = require("../services/pdfTables");

const router = Router();
const TZ = "Africa/Nairobi";

const dayLabel = (d) => new Date(d).toLocaleDateString("en-KE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const timeLabel = (d) => new Date(d).toLocaleTimeString("en-KE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const slug = (s) => String(s || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all";

const ROUND = { GROUP: "Group", QUARTER: "Quarter-final", SEMI: "Semi-final", FINAL: "Final" };

// Fixtures — any signed-in user (participants see fixtures on their own page too)
router.get("/fixtures.pdf", requireAuth, asyncHandler(async (req, res) => {
  const category = String(req.query.category || "").trim();
  const events = await SportsEvent.findAll({
    where: category ? { category } : {},
    order: [["startsAt", "ASC"], ["venue", "ASC"]],
  });

  const doc = createDoc({
    title: category ? `${category} Fixtures` : "Match & Performance Fixtures",
    subtitle: "Y-Summit Season 4 2026 · PCEA Githunguri Presbytery · Kambui Girls' Senior School",
    landscape: true,
  });

  if (!events.length) {
    doc.fillColor("#666").fontSize(11).text("No fixtures have been scheduled yet.");
  }

  const byDay = new Map();
  for (const e of events) {
    const k = dayKey(e.startsAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }

  for (const [, list] of byDay) {
    sectionTitle(doc, dayLabel(list[0].startsAt));
    table(doc,
      [
        { header: "Time", width: 55 },
        { header: "Category", width: 110 },
        { header: "Fixture", width: 270 },
        { header: "Venue", width: 140 },
        { header: "Stage", width: 85 },
        { header: "Result", width: 80, align: "center" },
      ],
      list.map((e) => [
        timeLabel(e.startsAt),
        e.category,
        e.teamHome && e.teamAway ? `${e.teamHome}  vs  ${e.teamAway}` : e.name,
        e.venue,
        [e.round ? ROUND[e.round] : "", e.group ? `Grp ${e.group}` : ""].filter(Boolean).join(" · ") || "—",
        e.status === "COMPLETED" && e.scoreHome !== null && e.scoreAway !== null
          ? `${e.scoreHome} - ${e.scoreAway}`
          : e.status === "CANCELLED" ? "Cancelled" : e.status === "ONGOING" ? "Live" : "—",
      ]));
  }

  finish(doc, res, `fixtures-${slug(category)}.pdf`);
}));

// Players / team rosters — staff only
router.get("/players.pdf", requireAuth, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const category = String(req.query.category || "").trim();

  const teams = await SportsTeam.findAll({
    where: category ? { category } : {},
    include: [
      { model: Parish, attributes: ["name"] },
      { model: SportsTeamMember, as: "members", include: [{ model: User, as: "user", attributes: ["fullName", "phone", "gender"] }] },
    ],
    order: [["category", "ASC"], ["name", "ASC"]],
  });

  const doc = createDoc({
    title: category ? `${category} — Players List` : "Players List",
    subtitle: "Y-Summit Season 4 2026 · PCEA Githunguri Presbytery",
  });

  if (!teams.length) {
    doc.fillColor("#666").fontSize(11).text("No team rosters have been registered yet.");
  }

  let currentCategory = null;
  for (const team of teams) {
    if (team.category !== currentCategory) {
      currentCategory = team.category;
      sectionTitle(doc, currentCategory, "#C95500");
    }
    const members = [...(team.members || [])].sort((a, b) =>
      (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999) || String(a.user?.fullName).localeCompare(String(b.user?.fullName)));
    const meta = [team.Parish?.name, team.coachName ? `Coach: ${team.coachName}` : null,
      team.chairpersonName ? `Chair: ${team.chairpersonName}` : null].filter(Boolean).join("  ·  ");
    sectionTitle(doc, `${team.name}${meta ? "   —   " + meta : ""}`);
    table(doc,
      [
        { header: "#", width: 30, align: "center" },
        { header: "Player", width: 220 },
        { header: "Position", width: 90 },
        { header: "Jersey", width: 50, align: "center" },
        { header: "Role", width: 133 },
      ],
      members.length
        ? members.map((m, i) => [
            i + 1, m.user?.fullName || "—", m.position || "—", m.jerseyNumber ?? "—",
            [m.isCaptain ? "Captain" : "", m.isEligible === false ? "Not eligible" : ""].filter(Boolean).join(", ") || "—",
          ])
        : [["", "No players added yet", "", "", ""]]);
  }

  // Individual / group entries (e.g. dance, folk song) that are not team rosters
  const eventInclude = { model: SportsEvent, attributes: ["category"] };
  if (category) eventInclude.where = { category };
  const entries = await SportsEntry.findAll({
    include: [eventInclude, { model: User, attributes: ["fullName"] }],
  });
  const rosterCategories = new Set(teams.map((t) => t.category));
  const grouped = {};
  for (const en of entries) {
    const cat = en.SportsEvent?.category;
    if (!cat || rosterCategories.has(cat)) continue;
    const team = en.teamName || "Individual entries";
    grouped[cat] = grouped[cat] || {};
    grouped[cat][team] = grouped[cat][team] || new Set();
    if (en.User?.fullName) grouped[cat][team].add(en.User.fullName);
  }
  for (const [cat, teamsMap] of Object.entries(grouped)) {
    sectionTitle(doc, cat, "#C95500");
    for (const [teamName, names] of Object.entries(teamsMap)) {
      sectionTitle(doc, teamName);
      table(doc,
        [{ header: "#", width: 30, align: "center" }, { header: "Participant", width: 493 }],
        [...names].sort().map((n, i) => [i + 1, n]));
    }
  }

  finish(doc, res, `players-${slug(category)}.pdf`);
}));

module.exports = router;
