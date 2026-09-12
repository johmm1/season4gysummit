// GY Summit 2026 — settings service
//
// The admin UI saves every settings form (General, Admissions, Finance,
// Gallery, ...) into the generic SystemSetting key/value table via
// PUT /api/admin/settings. Until now nothing outside the admin panel ever
// read that table back — routes and services used hardcoded defaults or
// env vars instead, so changing a setting in the admin UI had no effect
// anywhere else in the system. This module is the single place that reads
// those settings, with a short in-memory cache so hot paths (registration,
// admission-card issuance, etc.) don't hit the DB on every request.
//
// Usage:
//   const { getSetting, getForm } = require("./settingsService");
//   const fee = await getSetting("generalSettingsForm", "registrationFee", 1900);
//   const general = await getForm("generalSettingsForm"); // whole form object

const { SystemSetting } = require("../models");

const CACHE_TTL_MS = 15_000;
let cache = null; // { data: { [formId]: {...} }, expiresAt: number }

async function loadAll() {
  const rows = await SystemSetting.findAll();
  const data = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/** Returns every saved settings form as { [formId]: {field: value} }. Cached. */
async function getAllSettings() {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  return loadAll();
}

/** Returns one whole settings form's saved values (or {} if never saved). */
async function getForm(formId) {
  const all = await getAllSettings();
  return all[formId] || {};
}

/** Returns one field from one form, falling back to `fallback` if unset/blank. */
async function getSetting(formId, field, fallback = undefined) {
  const form = await getForm(formId);
  const value = form[field];
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

/** Call after any write to SystemSetting so readers see the new value immediately. */
function invalidateSettingsCache() {
  cache = null;
}

module.exports = { getAllSettings, getForm, getSetting, invalidateSettingsCache };
