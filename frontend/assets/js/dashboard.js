// GY Summit 2026 — admin dashboard
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, formatKes, formatDate, escapeHtml, setText, $, startCountdown } from "./utils.js";
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
  await loadPageSettings(DASHBOARD_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
  setInterval(loadStats, 60_000);
}

async function loadStats() {
  try {
    const stats = await apiFetch("/admin/dashboard/stats");
    setText("totalParticipants", stats.totalUsers);
    setText("checkedInParticipants", stats.totalCheckIns);
    setText("pendingPayments", stats.pendingRegistrations);
    setText("totalRevenue", formatKes(stats.totalRevenue));
    setText("parishCount", stats.topPresbyteries.length);

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

async function loadFinanceSummary() {
  try {
    const summary = await apiFetch("/finance/summary");
    setText("financeRevenue", formatKes(summary.succeeded.total));
    setText("financePaid", summary.succeeded.count);
    setText("financePending", summary.pending.count);
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
