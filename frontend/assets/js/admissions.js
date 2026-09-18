// GY Summit 2026 — admin live admissions / gate check-in
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, setText, $ } from "./utils.js";
import { startAdmissionScanner, stopAdmissionScanner } from "./qrScanner.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const ADMISSION_FORMS = ["admissionSettingsForm", "checkinRulesForm", "badgeSettingsForm", "gateSettingsForm"];

const admin = await requireAdminSession();
let lastScanResult = null;

if (admin) {
  wireLogoutButton();
  tickClock();
  await refreshCounts();
  wireScannerButtons();
  wireManualVerify();
  wireDecisionButtons();
  await loadPageSettings(ADMISSION_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
}

async function refreshCounts() {
  try {
    const { total } = await apiFetch("/admin/participants?pageSize=1");
    setText("totalExpected", total);
  } catch (err) {
    console.error(err);
  }
  try {
    const feed = await apiFetch("/attendance?type=CHECK_IN&pageSize=25");
    setText("checkedInCount", feed.total);
    setText("totalCheckedIn", feed.total);
    setText("todayAdmissions", feed.total);
    renderFeed(feed.items);
  } catch (err) {
    showError(err.message || "Could not load admissions feed.");
  }
}

function renderFeed(items) {
  const feed = $("admissionFeed") || $("attendanceTableBody");
  if (!feed) return;
  feed.innerHTML = items
    .map(
      (a) => `<div class="feed-item"><strong>${escapeAttr(a.user?.fullName)}</strong> — ${escapeAttr(a.user?.Parish?.name || "")} <span>${new Date(a.scannedAt).toLocaleTimeString("en-KE")}</span></div>`
    )
    .join("");
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function wireScannerButtons() {
  $("startScanner")?.addEventListener("click", async () => {
    try {
      await startAdmissionScanner("verificationPanel", { type: "CHECK_IN" }, (result) => {
        lastScanResult = result;
        showParticipant(result.participant);
        refreshCounts();
      });
      setText("readyState", "Scanning...");
    } catch {
      showError("Could not start camera. Check permissions.");
    }
  });

  $("stopScanner")?.addEventListener("click", async () => {
    await stopAdmissionScanner();
    setText("readyState", "Idle");
  });
}

function wireManualVerify() {
  $("verifyCode")?.addEventListener("click", async () => {
    const code = $("participantCode")?.value.trim() || $("phoneSearch")?.value.trim();
    if (!code) return showError("Enter an admission code or phone number.");
    try {
      // Manual fallback: search participants by the entered code/phone via admin search.
      const { items } = await apiFetch(`/admin/participants?search=${encodeURIComponent(code)}&pageSize=1`);
      const match = items[0];
      if (!match) return showError("No participant found.");
      showParticipant({ fullName: match.fullName, cardNumber: match.admissionCard?.cardNumber, parish: match.Parish?.name });
      lastScanResult = { participant: match, manualUserId: match.id };
    } catch (err) {
      showError(err.message || "Lookup failed.");
    }
  });
}

function showParticipant(p) {
  setText("participantName", p.fullName);
  setText("participantChurch", p.parish || "—");
  setText("participantParish", p.parish || "—");
  setText("participantCode", p.cardNumber || "—");
  setText("decisionStatus", "Awaiting decision");
  setText("decisionTime", new Date().toLocaleTimeString("en-KE"));
}

function wireDecisionButtons() {
  $("btnAdmit")?.addEventListener("click", () => recordDecision("CHECK_IN"));
  $("btnReEntry")?.addEventListener("click", () => recordDecision("CHECK_IN", "Re-entry"));
  // Hold/Reject don't change server state today — they're local-only triage
  // decisions (no "HOLD"/"REJECTED" attendance type exists in the schema).
  $("btnHold")?.addEventListener("click", () => setText("decisionStatus", "On hold"));
  $("btnReject")?.addEventListener("click", () => setText("decisionStatus", "Rejected"));
}

async function recordDecision(type, label) {
  if (!lastScanResult) return showError("Scan or look up a participant first.");
  try {
    // A camera scan already recorded the attendance the instant it was
    // scanned (POST /admission/scan happens inside qrScanner.js) — this
    // decision step just confirms that on screen, so don't record it
    // again here or it duplicates the attendance entry.
    if (!lastScanResult.attendance) {
      const cardId = lastScanResult.participant?.admissionCard?.id;
      if (!cardId) {
        return showError("This participant doesn't have an admission card yet — payment must be confirmed first.");
      }
      lastScanResult = await apiFetch(`/admission/${cardId}/admit`, {
        method: "POST",
        body: { label: label ? `${label} (manual lookup)` : undefined },
      });
    }
    setText("decisionStatus", "Admitted");
    showSuccess("Participant admitted.");
    await refreshCounts();
  } catch (err) {
    showError(err.message || "Could not record decision.");
  }
}

function tickClock() {
  const el = $("liveClock");
  if (!el) return;
  setInterval(() => (el.textContent = new Date().toLocaleTimeString("en-KE")), 1000);
}
