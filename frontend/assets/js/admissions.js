// Y-Summit Season 4 2026 — name-based admissions desk
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, setText, $ } from "./utils.js";

const admin = await requireAdminSession();
let selectedParticipant = null;

if (admin) {
  wireLogoutButton();
  tickClock();
  await refreshCounts();
  $("searchParticipant")?.addEventListener("click", searchParticipants);
  $("participantNameSearch")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchParticipants();
  });
  $("btnAdmit")?.addEventListener("click", () => recordDecision(false));
  $("btnReEntry")?.addEventListener("click", () => recordDecision(true));
  $("btnHold")?.addEventListener("click", () => setText("decisionStatus", "On hold"));
  $("btnReject")?.addEventListener("click", () => setText("decisionStatus", "Rejected"));
}

async function refreshCounts() {
  try {
    const [participants, feed] = await Promise.all([
      apiFetch("/admin/participants?pageSize=1"),
      apiFetch("/attendance?type=CHECK_IN&pageSize=25"),
    ]);
    setText("expectedCount", participants.total);
    setText("totalExpected", participants.total);
    setText("checkedInCount", feed.total);
    setText("totalCheckedIn", feed.total);
    setText("todayAdmissions", feed.total);
    setText("remainingCount", Math.max(0, participants.total - feed.total));
    renderFeed(feed.items || []);
  } catch (err) {
    showError(err.message || "Could not refresh admission counts.");
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function renderFeed(items) {
  const feed = $("admissionFeed") || $("attendanceTableBody");
  if (!feed) return;
  feed.innerHTML = items.map((item) =>
    `<div class="feed-item"><strong>${escapeHtml(item.user?.fullName)}</strong> — ${escapeHtml(item.user?.Parish?.name || "")}<span>${new Date(item.scannedAt).toLocaleTimeString("en-KE")}</span></div>`
  ).join("");
}

async function searchParticipants() {
  const name = $("participantNameSearch")?.value.trim() || "";
  if (name.length < 2) return showError("Enter at least two letters of the participant's name.");
  const results = $("participantSearchResults");
  if (results) results.textContent = "Searching…";
  try {
    const { items } = await apiFetch("/admission/search?name=" + encodeURIComponent(name));
    if (!results) return;
    if (!items.length) {
      results.textContent = "No participants found. Check the spelling and try again.";
      return;
    }
    results.innerHTML = items.map((person) => {
      const parish = person.Parish?.name || "Parish not set";
      const phone = person.phone || "No phone";
      const checked = person.attendances?.length > 0;
      return `<button type="button" class="participant-result" data-user-id="${escapeHtml(person.id)}">
        <strong>${escapeHtml(person.fullName)}</strong>
        <span>${escapeHtml(parish)} · ${escapeHtml(phone)}</span>
        <small>${checked ? "Already checked in" : "Not yet checked in"}</small>
      </button>`;
    }).join("");
    results.querySelectorAll("[data-user-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const person = items.find((item) => item.id === button.dataset.userId);
        if (person) selectParticipant(person);
      });
    });
  } catch (err) {
    if (results) results.textContent = "";
    showError(err.message || "Participant search failed.");
  }
}

function selectParticipant(person) {
  selectedParticipant = person;
  const panel = $("verificationPanel");
  if (panel) panel.classList.remove("hidden");
  $("admissionActions")?.classList.remove("hidden");
  setText("participantName", person.fullName);
  setText("participantParish", person.Parish?.name || "—");
  setText("participantChurch", person.Church?.name || "—");
  setText("participantPhone", person.phone || "—");
  setText("participantEmail", person.email || "—");
  setText("participantGender", person.gender || "—");
  setText("participantAge", person.dateOfBirth ? calculateAge(person.dateOfBirth) + " yrs" : "—");
  setText("arrivalTime", person.attendances?.[0]?.scannedAt ? new Date(person.attendances[0].scannedAt).toLocaleString("en-KE") : "—");
  setText("registrationStatus", person.registration?.status === "CONFIRMED" ? "REGISTERED" : "NOT REGISTERED");
  const admitted = Boolean(person.attendances?.length);
  const status = $("admissionStatus");
  if (status) {
    status.textContent = admitted ? "ALREADY ADMITTED" : "NOT ADMITTED";
    status.className = "badge " + (admitted ? "success" : "warning");
  }
  const medical = [person.medicalCondition, person.allergies, person.disability].filter(Boolean);
  setText("medicalCondition", medical.length ? medical.join(" · ") : "No medical information provided.");
  $("medicalAlert")?.classList.toggle("hidden", medical.length === 0);
  const photo = $("participantPhoto");
  if (photo && person.avatarUrl) photo.src = person.avatarUrl;
  setText("decisionStatus", admitted ? "Already admitted" : "Awaiting decision");
  setText("decisionTime", "—");
  $("btnAdmit") && ($("btnAdmit").disabled = admitted);
  $("btnReEntry") && ($("btnReEntry").disabled = !admitted);
  panel?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function calculateAge(dateOfBirth) {
  return Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 86400000));
}

async function recordDecision(isReEntry) {
  if (!selectedParticipant) return showError("Search for and select a participant first.");
  try {
    const result = await apiFetch("/admission/" + encodeURIComponent(selectedParticipant.id) + "/admit", {
      method: "POST",
      body: { label: isReEntry ? "Re-entry" : "Name-based check-in" },
    });
    showSuccess(result.participant.fullName + (isReEntry ? " re-entry recorded." : " admitted successfully."));
    setText("decisionStatus", isReEntry ? "Re-entry recorded" : "Admitted");
    setText("decisionTime", new Date().toLocaleTimeString("en-KE"));
    const status = $("admissionStatus");
    if (status) { status.textContent = "ALREADY ADMITTED"; status.className = "badge success"; }
    $("btnAdmit") && ($("btnAdmit").disabled = true);
    $("btnReEntry") && ($("btnReEntry").disabled = false);
    await refreshCounts();
    await searchParticipants();
  } catch (err) {
    showError(err.message || "Could not record admission.");
  }
}

function tickClock() {
  const element = $("liveClock");
  if (!element) return;
  setInterval(() => { element.textContent = new Date().toLocaleTimeString("en-KE"); }, 1000);
}
