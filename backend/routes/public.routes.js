// GY Summit 2026 — public, unauthenticated settings
//
// index.html, register.html, login.html, etc. are static pages served
// outside the admin panel, so they can't call the admin-only
// GET /api/admin/settings. This route exposes just the fields that are
// safe to show to the public — never finance/mpesa/security/backup
// settings — so the admin's General/Organisation/Leadership/Social Media
// forms actually reach the site visitors see, instead of only being
// visible inside the admin panel.

const { Router } = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const { getForm } = require("../services/settingsService");

const router = Router();

// Explicit per-form field whitelist — anything not listed here is never
// sent to this public, unauthenticated endpoint, even if it gets saved
// into the same form by mistake later.
const PUBLIC_FIELDS = {
  generalSettingsForm: [
    "summitName", "theme", "themeVerse", "venue", "hostParish",
    "registrationOpen", "registrationClose", "eventStart", "eventEnd",
    "maximumParticipants", "registrationFee", "summitLogo__url",
  ],
  organisationSettingsForm: [
    "presbytery", "hostChurch", "organisationHostParish", "county",
    "officialEmail", "officialPhone", "postalAddress", "website",
  ],
  leadershipForm: ["chairman", "patron", "moderator", "secretary", "treasurer", "ictAdmin"],
  socialMediaForm: ["facebook", "instagram", "youtube", "tiktok", "twitter", "whatsappChannel"],
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") out[k] = obj[k];
  }
  return out;
}

router.get(
  "/settings",
  asyncHandler(async (_req, res) => {
    const result = {};
    for (const [formId, fields] of Object.entries(PUBLIC_FIELDS)) {
      result[formId] = pick(await getForm(formId), fields);
    }
    res.json({ settings: result });
  })
);

module.exports = router;
