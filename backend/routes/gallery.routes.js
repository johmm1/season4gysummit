// GY Summit 2026 — gallery
const { Router } = require("express");
const { z } = require("zod");
const { GalleryItem, User } = require("../models");
const { createSignedUploadUrl } = require("../services/supabaseStorageService");
const { requireAuth, requireRole, ADMIN_ROLES } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { logAction } = require("../services/auditService");
const { getForm } = require("../services/settingsService");

const router = Router();

router.get(
  "/upload-signature",
  requireAuth,
  asyncHandler(async (req, res) => {
    const upload = await createSignedUploadUrl("gallery", req.query.filename);
    res.json({ upload });
  })
);

// Public (unauthenticated) gallery feed — only exists while Gallery >
// Visibility > "Public Gallery" AND "Download Permissions" >
// "Require Login to View" (off) both allow it. Previously the gallery had
// no way to be shown to a visitor who isn't logged in at all, no matter
// what these settings said.
router.get(
  "/public",
  asyncHandler(async (_req, res) => {
    const visibility = await getForm("galleryVisibilityForm");
    const downloadPerms = await getForm("downloadPermissionsForm");
    if (visibility.publicGallery === false || downloadPerms.requireGalleryLogin === true) {
      throw new ApiError(403, "The gallery is only visible to logged-in participants right now.");
    }
    const items = await GalleryItem.findAll({
      where: { isApproved: true, visibility: "public" },
      order: [["createdAt", "DESC"]],
      limit: 60,
      include: [{ model: User, as: "uploadedBy", attributes: ["fullName"] }],
    });
    res.json({ items });
  })
);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isAdmin = ADMIN_ROLES.includes(req.auth.role);
    const where = {};
    if (req.query.album) where.albumName = req.query.album;
    if (req.query.mediaType) where.mediaType = req.query.mediaType;
    if (!isAdmin) {
      where.isApproved = true;
      where.visibility = ["public", "participants"];
    }

    const items = await GalleryItem.findAll({
      where,
      order: [["createdAt", "DESC"]],
      include: [{ model: User, as: "uploadedBy", attributes: ["fullName"] }],
    });

    // Download Permissions > "Allow Downloads" is a global master switch —
    // when off, no item is downloadable regardless of its own per-item
    // `downloadable` flag.
    const downloadPerms = await getForm("downloadPermissionsForm");
    const plain = items.map((i) => i.toJSON());
    if (downloadPerms.allowDownloads === false) {
      plain.forEach((i) => { i.downloadable = false; });
    }

    res.json({ items: plain });
  })
);

const registerSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(200).optional(),
  albumName: z.string().max(80).default("General"),
  mediaType: z.enum(["photo", "video", "document"]).default("photo"),
  visibility: z.enum(["public", "participants", "committee", "private"]).default("public"),
  downloadable: z.boolean().default(true),
  bytes: z.number().int().nonnegative().optional(),
});

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const isAdmin = ADMIN_ROLES.includes(req.auth.role);

    // Gallery Settings > Max Upload Size / Allowed Formats — previously
    // saved but never checked against an actual upload.
    const gallerySettings = await getForm("gallerySettingsForm");
    if (gallerySettings.maxUploadSize && body.bytes) {
      const maxBytes = Number(gallerySettings.maxUploadSize) * 1024 * 1024; // setting is in MB
      if (body.bytes > maxBytes) {
        throw new ApiError(400, `File is too large — the maximum allowed is ${gallerySettings.maxUploadSize}MB.`);
      }
    }
    if (gallerySettings.allowedFormats && body.mediaType === "photo") {
      const ext = (body.url.split(".").pop() || "").toLowerCase().split("?")[0];
      const allowed = String(gallerySettings.allowedFormats).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      if (allowed.length && !allowed.includes(ext)) {
        throw new ApiError(400, `File format ".${ext}" is not allowed. Accepted formats: ${allowed.join(", ")}.`);
      }
    }

    // Gallery Visibility > "Auto-Publish" / "Require Approval" — previously
    // only admin uploads were ever auto-approved; participant uploads
    // always sat in the moderation queue no matter what these said.
    const visibility = await getForm("galleryVisibilityForm");
    const autoApprove = isAdmin || visibility.autoPublishGallery === true || visibility.galleryApproval === false;

    const item = await GalleryItem.create({ ...body, uploadedById: req.auth.userId, isApproved: autoApprove });
    res.status(201).json({ item });
  })
);

const updateSchema = z.object({
  caption: z.string().max(200).optional(),
  albumName: z.string().max(80).optional(),
  visibility: z.enum(["public", "participants", "committee", "private"]).optional(),
  downloadable: z.boolean().optional(),
});

router.patch(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "GALLERY_ADMIN"),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const item = await GalleryItem.findByPk(req.params.id);
    if (!item) throw new ApiError(404, "Photo not found");
    if (body.caption !== undefined) item.caption = body.caption;
    if (body.albumName !== undefined) item.albumName = body.albumName;
    await item.save();
    res.json({ item });
  })
);

router.patch(
  "/:id/approve",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "GALLERY_ADMIN"),
  asyncHandler(async (req, res) => {
    const item = await GalleryItem.findByPk(req.params.id);
    if (!item) throw new ApiError(404, "Photo not found");
    item.isApproved = true;
    await item.save();
    res.json({ item });
    await logAction(req.auth.userId, "GALLERY_APPROVED", "gallery", item.id, { caption: item.caption });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "GALLERY_ADMIN"),
  asyncHandler(async (req, res) => {
    const item = await GalleryItem.findByPk(req.params.id);
    const deleted = await GalleryItem.destroy({ where: { id: req.params.id } });
    if (!deleted) throw new ApiError(404, "Photo not found");
    res.status(204).send();
    await logAction(req.auth.userId, "GALLERY_DELETED", "gallery", req.params.id, { caption: item?.caption });
  })
);

module.exports = router;
