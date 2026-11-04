// Authenticated page-view activity tracking for the GY Summit portal.
const { Router } = require("express");
const { z } = require("zod");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");

const router = Router();

router.post(
  "/page-view",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({
      path: z.string().min(1).max(300),
      title: z.string().max(180).optional(),
    }).parse(req.body || {});

    // Store only the pathname, never query strings which may contain private tokens or form data.
    const path = body.path.split("?")[0].split("#")[0].replace(/\\/g, "/");
    await logAction(req.auth.userId, "PAGE_VIEW", "page", path, {
      path,
      title: body.title || "",
      ip: req.ip,
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
    });
    res.status(204).end();
  })
);

module.exports = router;
