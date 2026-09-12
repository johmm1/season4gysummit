// GY Summit 2026 — announcements
const { Router } = require("express");
const { z } = require("zod");
const { Op } = require("sequelize");
const { Announcement, User, ROLES, SportsTeamMember } = require("../models");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { notify, sendBulkSms } = require("../services/notificationService");
const { getForm } = require("../services/settingsService");

const router = Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const all = await Announcement.findAll({
      where: {
        isPublished: true,
        [Op.or]: [{ publishAt: null }, { publishAt: { [Op.lte]: new Date() } }],
      },
      order: [["isPinned", "DESC"], ["createdAt", "DESC"]],
      include: [{ model: User, as: "author", attributes: ["fullName"] }],
    });

    // Matches the same audience an announcement was actually sent to —
    // role first, then the parish/sports narrowing if either was set,
    // so a parish- or sports-team-only announcement doesn't show up for
    // every participant just because they share the PARTICIPANT role.
    // req.auth only carries userId/role/email (that's all the JWT holds),
    // so parishId and sports-team membership are looked up here, once,
    // only if an announcement in the list actually needs them.
    let viewerParishId;
    let sportsTeamUserIds = null;
    const announcements = [];
    for (const a of all) {
      if (!(a.audience || []).includes(req.auth.role)) continue;
      if (a.parishId) {
        if (viewerParishId === undefined) {
          const viewer = await User.findByPk(req.auth.userId, { attributes: ["parishId"] });
          viewerParishId = viewer?.parishId ?? null;
        }
        if (a.parishId !== viewerParishId) continue;
      }
      if (a.sportsOnly) {
        if (sportsTeamUserIds === null) {
          const memberships = await SportsTeamMember.findAll({ where: { userId: req.auth.userId }, attributes: ["userId"] });
          sportsTeamUserIds = new Set(memberships.map((m) => m.userId));
        }
        if (!sportsTeamUserIds.has(req.auth.userId)) continue;
      }
      announcements.push(a);
    }
    res.json({ announcements });
  })
);

router.get(
  "/admin",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (_req, res) => {
    const announcements = await Announcement.findAll({
      order: [["createdAt", "DESC"]],
      include: [{ model: User, as: "author", attributes: ["fullName"] }],
    });
    res.json({ announcements });
  })
);

// Live recipient count for the composer — reflects the same audience/
// parish/sports filter that would actually be used at send time, instead
// of a static "total participants" number that doesn't change no matter
// what's selected.
router.get(
  "/recipient-count",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const { parishId, sportsOnly } = z.object({
      parishId: z.coerce.number().int().positive().optional(),
      sportsOnly: z.coerce.boolean().optional(),
    }).parse(req.query);

    const where = { role: "PARTICIPANT" };
    if (parishId) where.parishId = parishId;
    const queryOptions = { where };
    if (sportsOnly) {
      queryOptions.include = [{ model: SportsTeamMember, attributes: [], required: true }];
      queryOptions.distinct = true; // a user can belong to more than one team — don't double-count them
      queryOptions.col = "id";
    }

    const count = await User.count(queryOptions);
    res.json({ count });
  })
);

const createSchema = z.object({
  title: z.string().min(3).max(150),
  body: z.string().min(3).max(5000),
  audience: z.array(z.enum(ROLES)).min(1),
  // Narrows delivery further within the role(s) above — "parish" and
  // "sports" audience options in the admin UI set these; both optional,
  // both apply on top of the role filter, not instead of it.
  parishId: z.number().int().positive().optional(),
  sportsOnly: z.boolean().default(false),
  isPinned: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  publishAt: z.string().datetime().nullish(),
});

router.post(
  "/",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const announcement = await Announcement.create({ ...body, authorId: req.auth.userId });
    res.status(201).json({ announcement });

    // Notify matching-audience users in the background — never make the
    // admin wait on a batch of emails/SMS, and one bad address must not
    // affect the rest.
    if (announcement.isPublished) {
      (async () => {
        try {
          const where = { role: body.audience };
          if (body.parishId) where.parishId = body.parishId;
          const queryOptions = { where, attributes: ["id", "fullName", "email", "phone"] };
          if (body.sportsOnly) {
            queryOptions.include = [{ model: SportsTeamMember, attributes: [], required: true }];
          }
          const users = await User.findAll(queryOptions);
          const subject = `GY Summit 2026 — ${body.title}`;
          const plainBody = body.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

          // Email is still per-recipient (personalized "Hi {{name}}" via
          // templates); SMS goes out with bounded concurrency across the
          // whole audience via Brevo (see sendBulkSms) instead of one
          // request per person sequentially.
          users.forEach((u) => {
            if (u.email) notify("notifyAnnouncements", null, { email: u.email }, subject, { name: u.fullName, body: plainBody });
          });

          const [channels, autoMessages] = await Promise.all([getForm("notificationChannelsForm"), getForm("autoMessagesForm")]);
          if (channels.enableSms === true && autoMessages.notifyAnnouncements !== false) {
            const smsText = `${body.title}: ${plainBody}`.slice(0, 459); // stay under 3 SMS segments
            await sendBulkSms(users.map((u) => u.phone), smsText);
          }
        } catch (err) {
          console.error("[announcements:notify] failed to notify recipients:", err.message);
        }
      })();
    }
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const body = createSchema.partial().parse(req.body);
    const announcement = await Announcement.findByPk(req.params.id);
    if (!announcement) throw new ApiError(404, "Announcement not found");
    await announcement.update(body);
    res.json({ announcement });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRole(...ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const deleted = await Announcement.destroy({ where: { id: req.params.id } });
    if (!deleted) throw new ApiError(404, "Announcement not found");
    res.status(204).send();
  })
);

module.exports = router;
