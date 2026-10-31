// Y-Summit Season 4 2026 — participant name-based admission details
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, setText, $ } from "../../assets/js/utils.js";
import { CONFIG } from "../../assets/js/config.js";

const user = await requireSession();
if (user) {
  wireLogoutButton();
  renderParticipant(user);
  await loadCard();
  renderEventDetails();
}

function renderEventDetails() {
  setText("summitVenue", CONFIG.EVENT.venue);
  setText("eventVenue", CONFIG.EVENT.venue);
  const start = new Date(CONFIG.EVENT.startDate);
  setText("reportingDate", start.toLocaleDateString("en-KE", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  const reportingTime = start.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  setText("reportingTime", reportingTime);
  setText("eventTime", reportingTime);
}

function renderParticipant(user) {
  for (const id of ["participantName", "passName"]) setText(id, user.fullName);
  for (const id of ["participantParish", "passParish"]) setText(id, user.Parish?.name || user.Church?.name || "—");
  setText("passChurch", user.Church?.name || "—");
  setText("emergencyName", user.emergencyContactName || "—");
  setText("emergencyPhone", user.emergencyContactPhone || "—");
  setText("emergencyContact", user.emergencyContactName ? `${user.emergencyContactName} (${user.emergencyContactPhone || "no phone"})` : "—");
  setText("emergencyRelationship", "Not specified");
  setText("medicalNotes", user.hasMedicalCondition ? (user.medicalNotes || "See medical form") : "None reported");
  setText("participantCategory", user.registration?.ticketType?.replace("_", " ") || "Youth Delegate");

  const photo = $("participantPhoto");
  if (photo && user.avatarUrl) photo.src = user.avatarUrl;
  const passPhoto = $("passPhoto");
  if (passPhoto && user.avatarUrl) passPhoto.src = user.avatarUrl;

  const reg = user.registration;
  setText("registrationStatus", reg?.status === "CONFIRMED" ? "Registered" : "Pending");
  const registrationBadge = $("registrationBadge");
  if (registrationBadge) registrationBadge.className = reg?.status === "CONFIRMED" ? "badge badge-success" : "badge badge-warning";
}

async function loadCard() {
  try {
    const { participant, admitted } = await apiFetch("/admission/me");
    setText("admissionStatusText", admitted ? "Checked in" : "Registered");
    setText("admissionStatus", admitted ? "Checked in" : "Registered");
    setText("admissionBadge", admitted ? "Checked in" : "Registration confirmed");
    const badge = $("admissionBadge");
    if (badge) badge.className = admitted ? "badge badge-success" : "badge badge-info";
    setText("checkinStatus", admitted ? "Checked in" : "Not checked in yet");
    setText("checkinInstructions", "At the entrance, staff will find your registration using your full name.");
  } catch (err) {
    setText("admissionStatus", "Status unavailable");
    showError(err.message || "Could not load your admission status.");
  }
}

$("printPassBtn")?.addEventListener("click", () => window.print());
