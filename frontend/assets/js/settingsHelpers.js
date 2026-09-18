// GY Summit 2026 — shared settings helpers.
// Every admin page that hosts settings forms (Dashboard, Finance, Admissions,
// Sports, Gallery, Announcements, Participants, System) uses this same
// generic mechanism: on submit, every input/select/textarea inside a form is
// serialized into a JSON object stored under a key matching the form's id.
// On load, saved values are poured back into matching field ids. This used
// to live only in settings.js when everything was one page — factored out
// here so each page can reuse it without duplicating ~150 lines.
import { apiFetch, showError, showSuccess, escapeHtml, $ } from "./utils.js";
import { uploadFile } from "./fileUpload.js";

export let savedSettings = {};

export async function loadPageSettings(relevantFormIds) {
  try {
    const { settings } = await apiFetch("/admin/settings");
    savedSettings = settings || {};
    for (const [formId, values] of Object.entries(savedSettings)) {
      if (!relevantFormIds || relevantFormIds.includes(formId)) {
        populateForm(formId, values);
      }
    }
  } catch (err) {
    console.error("Could not load settings:", err.message);
  }
}

export function populateForm(formId, values) {
  const form = $(formId);
  if (!form || typeof values !== "object") return;
  for (const [key, value] of Object.entries(values)) {
    const field = form.querySelector(`#${CSS.escape(key)}, [name="${key}"]`);
    if (!field || field.type === "file") continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (field.type === "select-multiple" && Array.isArray(value)) {
      Array.from(field.options).forEach((o) => { o.selected = value.includes(o.value); });
    } else field.value = value;
  }
}

export function serializeForm(form) {
  const data = {};
  form.querySelectorAll("input[id], select[id], textarea[id]").forEach((field) => {
    if (field.type === "file" || field.type === "password" || field.type === "submit" || field.type === "button") return;
    if (field.type === "checkbox") {
      data[field.id] = field.checked;
    } else if (field.type === "select-multiple") {
      // field.value on a <select multiple> only ever returns the FIRST
      // selected option — collect every selected one instead, or a
      // multi-select silently saves just one of however many were picked.
      data[field.id] = Array.from(field.selectedOptions).map((o) => o.value);
    } else {
      data[field.id] = field.value;
    }
  });
  return data;
}

/**
 * Wires every form[id$="Form"] on the current page to save independently on
 * submit. Pass `excludeIds` for any form on the page that has its own
 * dedicated handler (e.g. createAdminForm hits a different endpoint).
 */
export function wireSettingsForms(excludeIds = []) {
  document.querySelectorAll('form[id$="Form"]').forEach((form) => {
    if (excludeIds.includes(form.id)) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const values = serializeForm(form);
        await apiFetch("/admin/settings", { method: "PUT", body: { [form.id]: values } });
        savedSettings[form.id] = values;
        showSuccess("Settings saved.");
      } catch (err) {
        showError(err.message || "Could not save settings.");
      }
    });
  });
}

/**
 * Wires every file input inside a settings form to upload to Supabase
 * Storage on change and stash the resulting URL in a hidden sibling input
 * (picked up automatically by serializeForm/wireSettingsForms).
 */
export function wireSettingsFileUploads() {
  document.querySelectorAll('form[id$="Form"] input[type="file"][id]').forEach((fileInput) => {
    const urlFieldId = `${fileInput.id}__url`;
    let hidden = document.getElementById(urlFieldId);
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.id = urlFieldId;
      fileInput.insertAdjacentElement("afterend", hidden);
    }

    const status = document.createElement("small");
    status.style.display = "block";
    status.style.marginTop = "6px";
    status.style.color = "#888";
    fileInput.insertAdjacentElement("afterend", status);

    const savedUrl = savedSettings[fileInput.closest("form")?.id]?.[urlFieldId];
    if (savedUrl) {
      hidden.value = savedUrl;
      status.textContent = "✓ Uploaded previously";
      status.style.color = "var(--success, #2e7d32)";
    }

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      status.textContent = "Uploading…";
      status.style.color = "#888";
      try {
        const { url } = await uploadFile(file, "document");
        hidden.value = url;
        status.textContent = `✓ Uploaded: ${escapeHtml(file.name)}`;
        status.style.color = "var(--success, #2e7d32)";
      } catch (err) {
        status.textContent = err.message || "Upload failed";
        status.style.color = "var(--danger, #d32f2f)";
      }
    });
  });
}
