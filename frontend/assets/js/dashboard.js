// Y-Summit Season 4 2026 — admin dashboard
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, formatDate, escapeHtml, setText, $, startCountdown } from "./utils.js";
import { CONFIG } from "./config.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const DASHBOARD_FORMS = ["generalSettingsForm", "organisationSettingsForm", "leadershipForm", "socialMediaForm"];

const admin = await requireAdminSession();
if (admin) {
  wireLogoutButton();
  setText("eventVenue", CONFIG.EVENT.venue);
  setText("eventDate", formatDate(CONFIG.EVENT.startDate));
  startCountdown(CONFIG.EVENT.startDate, {}); // eventCountdown uses its own render below if present
  tickClock();
  await loadStats();
  await loadFinanceSummary();
  await loadAnnouncements();
  await loadMedicalAlerts();
  await loadPageSettings(DASHBOARD_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
  setInterval(loadStats, 60_000);
  setInterval(loadMedicalAlerts, 30_000);
}

async function loadStats() {
  try {
    const stats = await apiFetch("/admin/dashboard/stats");
    setText("totalParticipants", stats.totalUsers);
    setText("checkedInParticipants", stats.totalCheckIns);
    setText("pendingPayments", Math.max(0, stats.totalUsers - stats.totalCheckIns));
    setText("parishCount", stats.totalCongregations ?? 0);
    setText("totalCongregations", stats.totalCongregations ?? 0);

    const highest = stats.topPresbyteries[0];
    const lowest = stats.topPresbyteries[stats.topPresbyteries.length - 1];
    if (highest) setText("highestParish", `${highest.presbytery} (${highest.count})`);
    if (lowest) setText("lowestParish", `${lowest.presbytery} (${lowest.count})`);

    const grid = $("parishGrid");
    if (grid) {
      grid.innerHTML = stats.topPresbyteries
        .map((p) => `<div class="parish-card"><strong>${escapeHtml(p.presbytery)}</strong><span>${p.count}</span></div>`)
        .join("");
    }
  } catch (err) {
    showError(err.message || "Could not load dashboard stats.");
  }
}


async function loadMedicalAlerts() {
  const board = $("medicalAlerts");
  if (!board) return;

  try {
    const { alerts = [] } = await apiFetch("/admin/medical-alerts");
    if (!alerts.length) {
      board.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-heart-pulse"></i>
          <h3>No medical alerts</h3>
          <p>Participants with declared medical conditions will appear here.</p>
        </div>`;
      return;
    }

    board.innerHTML = alerts.map((person) => {
      const details = [
        person.medicalCondition ? `<div><strong>Condition:</strong> ${escapeHtml(person.medicalCondition)}</div>` : "",
        person.allergies ? `<div><strong>Allergies:</strong> ${escapeHtml(person.allergies)}</div>` : "",
        person.medication ? `<div><strong>Medication:</strong> ${escapeHtml(person.medication)}</div>` : "",
        person.medicalNotes ? `<div><strong>Medical notes:</strong> ${escapeHtml(person.medicalNotes)}</div>` : "",
        person.disability ? `<div><strong>Additional needs:</strong> ${escapeHtml(person.disability)}</div>` : "",
      ].filter(Boolean).join("");

      return `
        <article class="medical-alert" style="padding:14px;margin:10px 0;border:1px solid #f0c6c6;border-left:4px solid #c0392b;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <strong>${escapeHtml(person.fullName || "Participant")}</strong>
            <span>${escapeHtml(person.phone || "No phone recorded")}</span>
          </div>
          <div style="display:grid;gap:5px;margin-top:9px;">${details || "<span>Medical attention requested; details not supplied.</span>"}</div>
          ${person.emergencyContactName || person.emergencyContactPhone ? `<div style="margin-top:9px;"><strong>Emergency contact:</strong> ${escapeHtml(person.emergencyContactName || "Not named")} ${person.emergencyContactPhone ? `· ${escapeHtml(person.emergencyContactPhone)}` : ""}</div>` : ""}
        </article>`;
    }).join("");
  } catch (err) {
    console.error("Could not load medical alerts:", err);
    board.innerHTML = `
      <div class="empty-state" role="alert">
        <h3>Medical alerts unavailable</h3>
        <p>${escapeHtml(err.message || "Could not retrieve medical alerts. Please try again.")}</p>
      </div>`;
  }
}

async function loadFinanceSummary() {
  try {
    const summary = await apiFetch("/finance/summary");
    setText("financeRevenue", summary.congregationCount);
    setText("financePaid", summary.registeredCount);
    setText("financePending", summary.awaitingAdmission);
    setText("pendingPayments", summary.awaitingAdmission);
  } catch (err) {
    console.error("Finance summary unavailable to this role:", err.message);
  }
}

async function loadAnnouncements() {
  try {
    const { announcements } = await apiFetch("/announcements/admin");
    setText("activeAnnouncements", announcements.filter((a) => a.isPublished).length);
    const board = $("noticeBoard") || $("announcementList");
    if (board) {
      board.innerHTML = announcements
        .slice(0, 5)
        .map((a) => `<div class="notice-item"><strong>${escapeHtml(a.title)}</strong><span>${formatDate(a.createdAt)}</span></div>`)
        .join("");
    }
  } catch (err) {
    console.error("Could not load announcements:", err.message);
  }
}

function tickClock() {
  const dateEl = $("liveDate");
  const timeEl = $("liveTime");
  if (!dateEl && !timeEl) return;
  setInterval(() => {
    const now = new Date();
    if (dateEl) dateEl.textContent = now.toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    if (timeEl) timeEl.textContent = now.toLocaleTimeString("en-KE");
  }, 1000);
}

$("dashboardSearch")?.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  if (q.length > 2) window.location.href = `participants.html?search=${encodeURIComponent(q)}`;
});
