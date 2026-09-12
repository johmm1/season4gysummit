// GY Summit 2026 — generic Supabase Storage signed uploads
const { Router } = require("express");
const { z } = require("zod");
const { createSignedUploadUrl } = require("../services/supabaseStorageService");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = Router();

const ALLOWED_FOLDERS = {
  avatar: "avatars",
  gallery: "gallery",
  document: "documents",
};

router.get(
  "/signature",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { purpose, filename } = z.object({
      purpose: z.enum(["avatar", "gallery", "document"]).default("avatar"),
      filename: z.string().max(255).optional(),
    }).parse(req.query);
    const upload = await createSignedUploadUrl(ALLOWED_FOLDERS[purpose], filename);
    res.json({ upload });
  })
);

module.exports = router;
