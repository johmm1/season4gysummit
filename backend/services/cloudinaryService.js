// Y-Summit Season 4 2026 — Cloudinary media storage (signed direct uploads)
//
// Profile photos, gallery photos, videos and the certificate template assets
// (logo, signatures, background) all live in Cloudinary, in one folder per type:
//   gysummit/avatars   gysummit/gallery   gysummit/videos   gysummit/settings
//
// How an upload works (the file never passes through this server, which keeps
// Render's request limits and sleeping free tier out of the way):
//   1. The browser asks us for a SIGNATURE for one kind of upload.
//   2. We sign a fixed set of rules (folder, allowed formats, resize) with the
//      API secret, which never leaves the server.
//   3. The browser POSTs the file + signature straight to Cloudinary.
//   4. The browser sends us the resulting URL (and public id) to save.
//
// No SDK needed — Cloudinary's REST API plus Node's crypto is enough.
const crypto = require("crypto");
const axios = require("axios");

const MB = 1024 * 1024;

const cfg = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
  root: (process.env.CLOUDINARY_FOLDER || "gysummit").replace(/^\/+|\/+$/g, ""),
  maxImageMb: Number(process.env.CLOUDINARY_MAX_IMAGE_MB || 10), // free plan: 10 MB
  maxVideoMb: Number(process.env.CLOUDINARY_MAX_VIDEO_MB || 100), // free plan: 100 MB
});

function isConfigured() {
  const c = cfg();
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

// What each kind of upload is allowed to be. These rules are part of the
// signature, so a browser cannot loosen them.
function rulesFor(purpose, c) {
  switch (purpose) {
    case "avatar":
      return {
        resourceType: "image", folder: "avatars", maxBytes: c.maxImageMb * MB,
        allowed_formats: "jpg,jpeg,png,webp,heic,heif",
        transformation: "c_limit,w_1000,h_1000,q_auto", // stored size stays small
      };
    case "gallery":
      return {
        resourceType: "image", folder: "gallery", maxBytes: c.maxImageMb * MB,
        allowed_formats: "jpg,jpeg,png,webp,heic,heif,gif",
        transformation: "c_limit,w_2400,h_2400,q_auto",
      };
    case "video":
      return {
        resourceType: "video", folder: "videos", maxBytes: c.maxVideoMb * MB,
        allowed_formats: "mp4,mov,m4v,webm,3gp",
      };
    case "document": // admin-only: certificate template assets, gallery documents
      return { resourceType: "auto", folder: "settings", maxBytes: c.maxImageMb * MB };
    default:
      return null;
  }
}

function sign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/**
 * @param {"avatar"|"gallery"|"video"|"document"} purpose
 * @returns {{ uploadUrl: string, fields: object, resourceType: string, maxBytes: number }}
 */
function createUploadSignature(purpose) {
  if (!isConfigured()) {
    const err = new Error("Photo and video uploads aren't set up yet — the Cloudinary keys are missing on the server.");
    err.statusCode = 503;
    throw err;
  }
  const c = cfg();
  const rules = rulesFor(purpose, c);
  if (!rules) throw new Error(`Unknown upload purpose: ${purpose}`);

  const params = {
    folder: `${c.root}/${rules.folder}`,
    timestamp: Math.floor(Date.now() / 1000),
  };
  if (rules.allowed_formats) params.allowed_formats = rules.allowed_formats;
  if (rules.transformation) params.transformation = rules.transformation;

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloudName}/${rules.resourceType}/upload`,
    fields: { ...params, api_key: c.apiKey, signature: sign(params, c.apiSecret) },
    resourceType: rules.resourceType,
    maxBytes: rules.maxBytes,
  };
}

/** Delete a file from Cloudinary (used when a gallery item is deleted). Never throws. */
async function destroyAsset(publicId, resourceType = "image") {
  if (!publicId || !isConfigured()) return false;
  const c = cfg();
  const type = ["image", "video", "raw"].includes(resourceType) ? resourceType : "image";
  try {
    const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: "true" };
    const body = new URLSearchParams({ ...params, api_key: c.apiKey, signature: sign(params, c.apiSecret) });
    await axios.post(`https://api.cloudinary.com/v1_1/${c.cloudName}/${type}/destroy`, body, { timeout: 15000 });
    return true;
  } catch (err) {
    console.error("[cloudinary] could not delete", publicId, err.response?.data?.error?.message || err.message);
    return false;
  }
}

module.exports = { createUploadSignature, destroyAsset, isConfigured, _sign: sign };
