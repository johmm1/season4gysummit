// GY Summit 2026 — admin announcements
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, formatDate, escapeHtml, setText, $ } from "./utils.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const NOTIFICATION_FORMS = ["notificationChannelsForm", "emailConfigForm", "whatsappConfigForm", "autoMessagesForm", "notificationTemplatesForm"];

// "all" and "parish" are backed by real data (role + User.parishId).
// "sports" is backed by real data too (SportsTeamMember). "committee",
// "volunteers", and "individual" have no data model anywhere in this
// app — no committee-role tracking, no volunteer flag, no per-user
// picker — so those options are disabled in the dropdown (see
// wireAudienceToggle) rather than silently doing nothing when picked.
function resolveAudience() {
  const audienceType = $("audienceType")?.value || "all";
  if (audienceType === "parish") {
    const parishId = Number($("parishSelect")?.value);
    if (!parishId) throw new Error("Choose a parish first.");
    return { audience: ["PARTICIPANT"], parishId };
  }
  if (audienceType === "sports") {
    return { audience: ["PARTICIPANT"], sportsOnly: true };
  }
  return { audience: ["PARTICIPANT"] };
}

const admin = await requireAdminSession();
let allAnnouncements = [];
let quill = null;

if (admin) {
  wireLogoutButton();
  tickClock();
  initEditor();
  wireAudienceToggle();
  await load();
  await loadRecipientCount();
  await loadPageSettings(NOTIFICATION_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
}

function initEditor() {
  if (!window.Quill || !document.getElementById("announcementEditor")) return;
  quill = new Quill("#announcementEditor", {
    theme: "snow",
    modules: { toolbar: "#toolbar" },
    placeholder: "Write your announcement...",
  });
  quill.on("text-change", () => {
    const html = quill.root.innerHTML === "<p><br></p>" ? "" : quill.root.innerHTML;
    const text = quill.getText().trim();
    $("announcementMessage") && ($("announcementMessage").value = html);
    setText("characterCount", `${text.length} Characters`);
    setText("readingTime", `${Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200))} min read`);
  });
}

function wireAudienceToggle() {
  const audienceType = $("audienceType");
  const parishContainer = $("parishContainer");

  // These three have no backing data anywhere in the app (no committee
  // role, no volunteer flag, no individual-recipient picker) — disable
  // rather than let them be picked and silently do nothing.
  ["committee", "volunteers", "individual"].forEach((val) => {
    const opt = audienceType?.querySelector(`option[value="${val}"]`);
    if (opt) {
      opt.disabled = true;
      opt.textContent += " (not available yet)";
    }
  });

  audienceType?.addEventListener("change", () => {
    if (parishContainer) parishContainer.style.display = audienceType.value === "parish" ? "" : "none";
    loadRecipientCount();
  });

  $("parishSelect")?.addEventListener("change", loadRecipientCount);

  loadParishOptions();
}

async function loadParishOptions() {
  const select = $("parishSelect");
  if (!select) return;
  try {
    const { items } = await apiFetch("/structure/parishes");
    select.innerHTML = `<option value="">Choose Parish</option>` +
      items.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  } catch (err) {
    console.error("Failed to load parishes:", err.message);
  }
}

async function loadRecipientCount() {
  try {
    const audienceType = $("audienceType")?.value || "all";
    const params = new URLSearchParams();
    if (audienceType === "parish") {
      const parishId = $("parishSelect")?.value;
      if (!parishId) { setText("recipientCount", 0); return; }
      params.set("parishId", parishId);
    } else if (audienceType === "sports") {
      params.set("sportsOnly", "true");
    }
    const { count } = await apiFetch(`/announcements/recipient-count?${params}`);
    setText("recipientCount", count ?? 0);
  } catch {
    // Non-critical — leave the count at its default.
  }
}

/* ==========================================================
   LOAD + RENDER
   ========================================================== */

async function load() {
  try {
    const { announcements } = await apiFetch("/announcements/admin");
    allAnnouncements = announcements;
    render(announcements);
    setText("totalAnnouncements", announcements.length);
    setText(
      "publishedToday",
      announcements.filter((a) => new Date(a.createdAt).toDateString() === new Date().toDateString()).length
    );

    const now = Date.now();
    const scheduled = announcements.filter((a) => a.publishAt && new Date(a.publishAt).getTime() > now);
    setText("scheduledCount", scheduled.length);
    renderScheduled(scheduled);
  } catch (err) {
    showError(err.message || "Could not load announcements.");
  }
}

function render(items) {
  const table = $("announcementTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;
  tbody.innerHTML = items
    .map(
      (a) => `
      <tr data-id="${a.id}">
        <td>${escapeHtml(a.title)}</td>
        <td>${a.audience.map(escapeHtml).join(", ")}</td>
        <td>${a.isPublished ? "Published" : "Draft"}${a.isPinned ? " · Pinned" : ""}${a.publishAt && new Date(a.publishAt) > new Date() ? " · Scheduled" : ""}</td>
        <td>${formatDate(a.createdAt)}</td>
        <td>
          <button class="btn btn-sm btn-outline" data-action="view" data-id="${a.id}">View</button>
          <button class="btn btn-sm btn-outline" data-action="edit" data-id="${a.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${a.id}">Delete</button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll('[data-action="view"]').forEach((btn) =>
    btn.addEventListener("click", () => openForView(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) =>
    btn.addEventListener("click", () => openForEdit(btn.dataset.id))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach((btn) =>
    btn.addEventListener("click", () => remove(btn.dataset.id))
  );
}

function renderScheduled(scheduled) {
  const container = $("scheduledAnnouncements");
  if (!container) return;
  if (!scheduled.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-check"></i>
        <h3>Nothing scheduled</h3>
        <p>Set a Publish Date and Time in the future when composing to schedule an announcement.</p>
      </div>`;
    return;
  }
  container.innerHTML = scheduled
    .map(
      (a) => `
      <div class="scheduled-item" data-id="${a.id}">
        <div>
          <strong>${escapeHtml(a.title)}</strong>
          <p>Publishes ${new Date(a.publishAt).toLocaleString("en-KE")}</p>
        </div>
        <div>
          <button class="btn btn-sm btn-outline" data-action="edit" data-id="${a.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-action="cancel-schedule" data-id="${a.id}">Publish Now</button>
        </div>
      </div>`
    )
    .join("");

  container.querySelectorAll('[data-action="edit"]').forEach((btn) =>
    btn.addEventListener("click", () => openForEdit(btn.dataset.id))
  );
  container.querySelectorAll('[data-action="cancel-schedule"]').forEach((btn) =>
    btn.addEventListener("click", () => publishNow(btn.dataset.id))
  );
}

async function publishNow(id) {
  try {
    await apiFetch(`/announcements/${id}`, { method: "PATCH", body: { publishAt: null } });
    showSuccess("Published immediately.");
    await load();
  } catch (err) {
    showError(err.message || "Could not publish this announcement.");
  }
}

/* ==========================================================
   VIEW MODAL
   ========================================================== */

function openForView(id) {
  const a = allAnnouncements.find((x) => x.id === id);
  if (!a) return;
  const modal = $("announcementModal");
  const content = $("announcementContent");
  if (content) content.innerHTML = `<h3>${escapeHtml(a.title)}</h3><div>${a.body}</div>`;
  if (modal) modal.style.display = "flex";
}

/* ==========================================================
   EDIT / COMPOSE
   ========================================================== */

let editingId = null;

function openForEdit(id) {
  const a = allAnnouncements.find((x) => x.id === id);
  if (!a) return;
  editingId = id;
  $("announcementTitle") && ($("announcementTitle").value = a.title);
  if (quill) quill.root.innerHTML = a.body;
  $("announcementMessage") && ($("announcementMessage").value = a.body);
  $("emergencyBroadcast") && ($("emergencyBroadcast").checked = a.isPinned);
  if (a.publishAt) {
    const dt = new Date(a.publishAt);
    $("publishDate") && ($("publishDate").value = dt.toISOString().slice(0, 10));
    $("publishTime") && ($("publishTime").value = dt.toTimeString().slice(0, 5));
  }
  document.getElementById("announcementForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("closeAnnouncementModal")?.addEventListener("click", () => {
  const modal = $("announcementModal");
  if (modal) modal.style.display = "none";
});

// The Preview button had no handler at all before — it just sat there.
// Reuses the same view modal to show the draft's current title/body
// exactly as a recipient would see it, before it's actually sent.
$("previewAnnouncement")?.addEventListener("click", () => {
  const title = $("announcementTitle")?.value.trim();
  const body = quill ? quill.root.innerHTML : ($("announcementMessage")?.value || "");
  if (!title && !body) {
    showError("Write a title or message first to preview it.");
    return;
  }
  const modal = $("announcementModal");
  const content = $("announcementContent");
  if (content) content.innerHTML = `<h3>${escapeHtml(title || "(untitled)")}</h3><div>${body}</div>`;
  if (modal) modal.style.display = "flex";
});

function getPublishAt() {
  const date = $("publishDate")?.value;
  const time = $("publishTime")?.value;
  if (!date) return null;
  const dt = new Date(`${date}T${time || "00:00"}`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function resetComposer() {
  editingId = null;
  $("announcementForm")?.reset();
  if (quill) quill.setContents([]);
  $("announcementMessage") && ($("announcementMessage").value = "");
  setText("characterCount", "0 Characters");
  setText("readingTime", "0 min read");
}

async function remove(id) {
  if (!confirm("Delete this announcement?")) return;
  try {
    await apiFetch(`/announcements/${id}`, { method: "DELETE" });
    showSuccess("Announcement deleted.");
    await load();
  } catch (err) {
    showError(err.message || "Could not delete announcement.");
  }
}

$("announcementForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = $("announcementTitle")?.value.trim();
  const body = $("announcementMessage")?.value.trim();
  const isPinned = $("emergencyBroadcast")?.checked ?? false;
  const publishAt = getPublishAt();

  if (!title || !body) {
    showError("Title and message are required.");
    return;
  }

  try {
    if (editingId) {
      await apiFetch(`/announcements/${editingId}`, {
        method: "PATCH",
        body: { title, body, ...resolveAudience(), isPinned, publishAt },
      });
      showSuccess(publishAt && new Date(publishAt) > new Date() ? "Announcement scheduled." : "Announcement updated.");
    } else {
      await apiFetch("/announcements", {
        method: "POST",
        body: { title, body, ...resolveAudience(), isPinned, isPublished: true, publishAt },
      });
      showSuccess(publishAt && new Date(publishAt) > new Date() ? "Announcement scheduled." : "Announcement published.");
    }
    resetComposer();
    await load();
  } catch (err) {
    showError(err.message || "Could not save announcement.");
  }
});

$("saveDraft")?.addEventListener("click", async () => {
  const title = $("announcementTitle")?.value.trim();
  const body = $("announcementMessage")?.value.trim();
  if (!title || !body) return showError("Title and message are required.");
  try {
    await apiFetch("/announcements", {
      method: "POST",
      body: { title, body, ...resolveAudience(), isPublished: false },
    });
    showSuccess("Draft saved.");
    resetComposer();
    await load();
  } catch (err) {
    showError(err.message || "Could not save draft.");
  }
});

$("globalAnnouncementSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  render(allAnnouncements.filter((a) => a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)));
});

function tickClock() {
  const dateEl = $("liveDate");
  const clockEl = $("liveClock");
  if (!dateEl && !clockEl) return;
  setInterval(() => {
    const now = new Date();
    if (dateEl) dateEl.textContent = now.toLocaleDateString("en-KE");
    if (clockEl) clockEl.textContent = now.toLocaleTimeString("en-KE");
  }, 1000);
}
