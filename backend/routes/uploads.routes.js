// Y-Summit Season 4 2026 — signed upload requests for Cloudinary
const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { createUploadSignature } = require("../services/cloudinaryService");
const { requireAuth, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");

const router = Router();

// A signature is cheap, but there is no reason for one account to ask for
// hundreds of them.
const signatureLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload requests. Please wait a few minutes and try again." },
});

router.get(
  "/signature",
  requireAuth,
  signatureLimiter,
  asyncHandler(async (req, res) => {
    const { purpose } = z.object({
      purpose: z.enum(["avatar", "gallery", "video", "document"]).default("avatar"),
    }).parse(req.query);

    // "document" can be any file type (certificate templates, gallery
    // documents), so only staff may use it. Participants are limited to
    // photos and videos, whose formats Cloudinary enforces.
    if (purpose === "document" && !ADMIN_ROLES.includes(req.auth.role)) {
      throw new ApiError(403, "Only administrators can upload documents.");
    }

    try {
      res.json({ upload: createUploadSignature(purpose) });
    } catch (err) {
      throw new ApiError(err.statusCode || 500, err.message);
    }
  })
);

module.exports = router;
