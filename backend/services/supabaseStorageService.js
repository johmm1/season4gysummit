// GY Summit 2026 — Supabase Storage signed direct-upload helper
//
// Same "signed upload, direct from the browser" pattern the Cloudinary
// integration used, just against Supabase's Storage REST API instead:
//   1. Our server asks Supabase for a short-lived signed upload URL
//      (using the service role key — never sent to the browser).
//   2. The browser POSTs the file straight to that URL — the file's
//      bytes never pass through our own server.
//   3. The bucket must be public (or fronted by a public-read RLS policy)
//      for the resulting URL to be viewable without another signed
//      request — see README for the one-time Supabase dashboard setup.
//
// Reference: Supabase Storage's "create signed upload URL" endpoint
// returns { url: "/object/upload/sign/<bucket>/<path>?token=..." },
// which the client then POSTs the raw file to directly.

const axios = require("axios");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL; // e.g. https://xxxxx.supabase.co (project URL, NOT the DB connection string)
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "gy-summit-2026";

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * @param {string} folder one of "avatars" | "gallery" | "documents" | "settings"
 * @param {string} originalFilename used only to preserve the file extension
 * @returns {Promise<{ uploadUrl: string, publicUrl: string, path: string }>}
 */
async function createSignedUploadUrl(folder, originalFilename = "") {
  if (!isConfigured()) {
    throw new Error("Supabase Storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)");
  }

  const ext = (originalFilename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;

  const { data } = await axios.post(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`,
    {},
    { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" } }
  );

  return {
    uploadUrl: `${SUPABASE_URL}/storage/v1${data.url}`,
    publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
    path,
  };
}

module.exports = { createSignedUploadUrl, isConfigured, BUCKET };
