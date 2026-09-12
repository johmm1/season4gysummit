// GY Summit 2026 — System Settings (slim page)
//
// Everything that belonged to a specific content page (Finance, Sports,
// Gallery, etc.) has moved there. What's left here is genuinely
// platform-wide: authentication policy, backups, system health, and audit
// logs — none of which belong to any one page.
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, setText, $ } from "./utils.js";
import { CONFIG } from "./config.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const SYSTEM_FORMS = [
  "authenticationForm", "passwordPolicyForm", "sessionManagementForm",
  "securityMonitoringForm", "automaticBackupsForm", "maintenanceForm", "auditRetentionForm",
];

const admin = await requireAdminSession();

if (admin) {
  wireLogoutButton();
  setText("adminName", admin.fullName || "Admin");
  setText("adminRole", admin.role?.replace(/_/g, " ") || "Admin");
  await loadPageSettings(SYSTEM_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
  wireTabs();
  await loadSystemHealth();
  wireBackups();
  await loadAuditLogs();
  wireAuditControls();

  $("saveSettings")?.addEventListener("click", () => {
    document.querySelectorAll('form[id$="Form"]').forEach((f) => f.requestSubmit());
  });
  $("resetSettings")?.addEventListener("click", async () => {
    if (!confirm("Reload this page and discard any unsaved changes?")) return;
    location.reload();
  });
}

function wireTabs() {
  document.querySelectorAll(".settings-tab[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".settings-section").forEach((s) => s.classList.remove("active-section"));
      const target = document.getElementById(`${btn.dataset.tab}Tab`);
      if (target) target.classList.add("active-section");
    });
  });
}

/* ==========================================================
   SYSTEM HEALTH
   ========================================================== */

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function setStatus(id, ok, onText = "Online", offText = "Offline") {
  const el = $(id);
  if (!el) return;
  el.textContent = ok ? onText : offText;
  el.className = `status ${ok ? "success" : "error"}`;
}

async function loadSystemHealth() {
  try {
    const health = await apiFetch("/admin/system-health");
    const now = new Date().toLocaleTimeString();

    setText("systemVersion", `GY Summit v${health.version}`);
    setText("environment", health.environment);

    setStatus("dbStatus", health.db.status === "online");
    setText("dbStatusTime", now);
    setStatus("authStatus", true); // this request only succeeds with a valid admin session
    setText("authStatusTime", now);
    setStatus("storageStatus", true);
    setText("storageStatusTime", now);
    setStatus("cloudinaryStatus", health.storageConfigured, "Configured", "Not configured");
    setText("cloudinaryStatusTime", now);
    setStatus("mpesaStatus", health.mpesaConfigured, "Configured", "Not configured");
    setText("mpesaStatusTime", now);

    setText("storageUsed", formatBytes(health.storage.galleryBytes));
    setText("databaseSize", health.db.sizeBytes != null ? formatBytes(health.db.sizeBytes) : "N/A");
    setText("activeUsers", health.participantCount);
    setText("apiRequests", health.requestCount24h);

    setProgress("cpuUsage", "cpuValue", health.cpuPercent);
    setProgress("memoryUsage", "memoryValue", health.memory.percent);
    setText("memoryValue", `${health.memory.percent}% (${health.memory.usedMb} MB)`);

    // No real disk-quota or bandwidth tracking exists — show honestly rather than fake it.
    setProgress("diskUsage", "diskValue", 0);
    setText("diskValue", "Not tracked");
    setProgress("networkUsage", "networkValue", 0);
    setText("networkValue", "Not tracked");
  } catch (err) {
    setStatus("dbStatus", false);
    setStatus("authStatus", false);
    setStatus("storageStatus", false);
    console.error("System health check failed:", err.message);
  }
}

function setProgress(barId, labelId, percent) {
  const bar = $(barId);
  if (bar) bar.value = percent;
  const label = $(labelId);
  if (label) label.textContent = `${percent}%`;
}

/* ==========================================================
   BACKUPS
   ========================================================== */

function wireBackups() {
  $("createBackupBtn")?.addEventListener("click", async () => {
    const btn = $("createBackupBtn");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Backing up…';
    try {
      await apiFetch("/admin/backups", { method: "POST" });
      showSuccess("Backup created.");
      await loadBackupHistory();
    } catch (err) {
      showError(err.message || "Backup failed.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
  loadBackupHistory();
}

async function loadBackupHistory() {
  const tbody = $("backupHistory");
  if (!tbody) return;
  try {
    const { backups } = await apiFetch("/admin/backups");
    if (!backups.length) {
      tbody.innerHTML = `<tr><td colspan="5">No backups yet — click "Create Database Backup" above.</td></tr>`;
      return;
    }
    tbody.innerHTML = backups.map((b) => `
      <tr>
        <td>${new Date(b.createdAt).toLocaleString()}</td>
        <td>Database</td>
        <td>${formatBytes(b.bytes)}</td>
        <td><span class="status success">Complete</span></td>
        <td><a class="btn btn-sm btn-outline" href="${CONFIG.API_BASE_URL}/admin/backups/${encodeURIComponent(b.filename)}/download" target="_blank">Download</a></td>
      </tr>`).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5">Could not load backup history.</td></tr>`;
  }
}

/* ==========================================================
   AUDIT LOGS
   ========================================================== */

let allAuditLogs = [];

async function loadAuditLogs() {
  const tbody = $("auditLogsTable");
  if (!tbody) return;
  try {
    const { logs, stats } = await apiFetch("/admin/audit-logs?pageSize=100");
    allAuditLogs = logs;
    renderAuditLogs(logs);
    renderSecurityEvents(logs);
    renderAuditStats(logs, stats);
    populateAdminFilter(logs);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">Could not load audit logs.</td></tr>`;
  }
}

function renderAuditLogs(logs) {
  const tbody = $("auditLogsTable");
  if (!tbody) return;
  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="7">No activity recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map((log) => `
    <tr>
      <td>${new Date(log.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(log.actor?.fullName || "System")}</td>
      <td>${escapeHtml(log.entityType)}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(summarizeLog(log))}</td>
      <td>--</td>
      <td><span class="status ${log.action.includes("FAILED") ? "error" : "success"}">${log.action.includes("FAILED") ? "Failed" : "Success"}</span></td>
    </tr>`).join("");
}

function summarizeLog(log) {
  if (!log.metadata) return "";
  try {
    const m = typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata;
    return Object.entries(m).map(([k, v]) => `${k}: ${v}`).join(", ");
  } catch {
    return "";
  }
}

function renderSecurityEvents(logs) {
  const container = $("securityEvents");
  if (!container) return;
  const securityLogs = logs.filter((l) => ["LOGIN", "LOGIN_FAILED", "ADMIN_CREATED"].includes(l.action)).slice(0, 20);
  if (!securityLogs.length) {
    container.innerHTML = "<p>No security events recorded yet.</p>";
    return;
  }
  container.innerHTML = securityLogs.map((log) => `
    <div class="timeline-item">
      <strong>${escapeHtml(log.action.replace(/_/g, " "))}</strong>
      <p>${escapeHtml(log.actor?.fullName || "Unknown")} — ${new Date(log.createdAt).toLocaleString()}</p>
    </div>`).join("");
}

function renderAuditStats(logs, stats) {
  const today = new Date().toDateString();
  setText("todayLogs", logs.filter((l) => new Date(l.createdAt).toDateString() === today).length);
  setText("failedLogins", logs.filter((l) => l.action === "LOGIN_FAILED").length);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentAdmins = new Set(logs.filter((l) => l.action === "LOGIN" && new Date(l.createdAt).getTime() > dayAgo).map((l) => l.actorId));
  setText("activeAdmins", recentAdmins.size);
  setText("securityAlerts", stats?.security ?? logs.filter((l) => l.action === "LOGIN_FAILED").length);
}

function populateAdminFilter(logs) {
  const select = $("auditAdminFilter");
  if (!select) return;
  const admins = new Map();
  logs.forEach((l) => { if (l.actor) admins.set(l.actor.id, l.actor.fullName); });
  select.innerHTML = '<option value="">All Administrators</option>' +
    [...admins.entries()].map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join("");
}

function wireAuditControls() {
  const applyFilters = () => {
    const adminId = $("auditAdminFilter")?.value;
    const module = $("auditModuleFilter")?.value;
    const action = $("auditActionFilter")?.value;
    const date = $("auditDateFilter")?.value;
    const filtered = allAuditLogs.filter((l) => {
      if (adminId && l.actorId !== adminId) return false;
      if (module && l.entityType !== module) return false;
      if (action && l.action !== action) return false;
      if (date && new Date(l.createdAt).toISOString().slice(0, 10) !== date) return false;
      return true;
    });
    renderAuditLogs(filtered);
  };
  $("auditAdminFilter")?.addEventListener("change", applyFilters);
  $("auditModuleFilter")?.addEventListener("change", applyFilters);
  $("auditActionFilter")?.addEventListener("change", applyFilters);
  $("auditDateFilter")?.addEventListener("change", applyFilters);

  $("exportAuditLogs")?.addEventListener("click", () => exportLogsAsCsv(allAuditLogs));
  $("downloadAuditReportBtn")?.addEventListener("click", async () => {
    try {
      const { logs } = await apiFetch("/admin/audit-logs?pageSize=100");
      exportLogsAsCsv(logs);
    } catch (err) {
      showError(err.message || "Could not generate report.");
    }
  });

  $("deleteOldLogsBtn")?.addEventListener("click", async () => {
    const days = parseInt($("logRetention")?.value || "365", 10);
    if (days < 0) { showError("Retention is set to \"Never Delete.\""); return; }
    if (!confirm(`Delete all audit logs older than ${days} days? This can't be undone.`)) return;
    try {
      const { deleted } = await apiFetch(`/admin/audit-logs?olderThanDays=${days}`, { method: "DELETE" });
      showSuccess(`${deleted} old log(s) deleted.`);
      await loadAuditLogs();
    } catch (err) {
      showError(err.message || "Could not delete old logs.");
    }
  });
}

function exportLogsAsCsv(logs) {
  if (!logs.length) { showError("No logs to export."); return; }
  const header = "Date,Administrator,Module,Action,Details\n";
  const rows = logs.map((l) =>
    [new Date(l.createdAt).toISOString(), l.actor?.fullName || "System", l.entityType, l.action, summarizeLog(l)]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  );
  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gy-summit-2026-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
