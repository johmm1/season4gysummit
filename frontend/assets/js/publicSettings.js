// GY Summit 2026 — applies admin-saved settings to public-facing pages.
//
// Previously the admin's General/Organisation/Leadership/Social Media
// settings only ever affected the admin panel itself — index.html and
// register.html had the summit name, theme, venue, dates and social
// links hardcoded into the HTML. This fetches the public, unauthenticated
// GET /public/settings endpoint and pours the values into any element
// carrying a data-setting attribute, so a change saved in the admin UI
// shows up on the public site on next page load.
//
// Usage in a page's <script type="module">:
//   import { applyPublicSettings } from "./publicSettings.js";
//   applyPublicSettings();
//
// Mark elements in the HTML like:
//   <p data-setting="generalSettingsForm.theme">Holiness and the Fear of God</p>
//   <a data-setting="socialMediaForm.facebook" data-setting-attr="href" href="#">...</a>
//
// If a setting hasn't been saved yet, the element's existing hardcoded
// text/attribute is left alone — so the page never breaks or shows blank
// values before the admin has filled anything in.

import { apiUrl } from "./config.js";

function get(obj, path) {
  return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

export async function fetchPublicSettings() {
  try {
    const res = await fetch(apiUrl("/public/settings"));
    if (!res.ok) return null;
    const { settings } = await res.json();
    return settings;
  } catch (err) {
    console.warn("Could not load public settings, keeping page defaults:", err.message);
    return null;
  }
}

/**
 * Finds every element with data-setting="formId.field" on the page and
 * fills it in from the saved admin settings. By default sets textContent;
 * add data-setting-attr="href" (or "src", etc.) to set an attribute instead.
 * Returns the raw settings object in case the caller needs more (e.g. to
 * drive the countdown target date or a registration-closed banner).
 */
export async function applyPublicSettings() {
  const settings = await fetchPublicSettings();
  if (!settings) return null;

  document.querySelectorAll("[data-setting]").forEach((el) => {
    const path = el.getAttribute("data-setting");
    const value = get(settings, path);
    if (value === undefined || value === "") return; // keep existing hardcoded fallback
    const attr = el.getAttribute("data-setting-attr");
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  });

  return settings;
}
