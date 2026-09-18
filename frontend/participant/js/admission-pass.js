// GY Summit 2026 — participant admission pass (QR code)
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, apiDownload, showError, setText, $ } from "../../assets/js/utils.js";
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
  setText("paymentStatus", reg?.status === "CONFIRMED" ? "Paid" : "Pending");
  const paymentBadge = $("paymentBadge");
  if (paymentBadge) paymentBadge.className = reg?.status === "CONFIRMED" ? "badge badge-success" : "badge badge-warning";
}

async function loadCard() {
  try {
    const { card, qrImage } = await apiFetch("/admission/me");
    setText("admissionNumber", card.cardNumber);
    setText("registrationNumber", card.cardNumber);
    const qrEl = $("qrCode");
    if (qrEl) {
      if (qrEl.tagName === "IMG") qrEl.src = qrImage;
      else qrEl.innerHTML = `<img src="${qrImage}" alt="Admission QR code" style="width:100%;max-width:280px;" />`;
    }
    setText("admissionStatus", card.isRevoked ? "Revoked" : "Active");
    const badge = $("admissionBadge");
    if (badge) badge.className = card.isRevoked ? "badge badge-danger" : "badge badge-success";

    await loadCheckinStatus();
  } catch (err) {
    setText("admissionStatus", "Not issued yet");
    setText("qrCode", "");
    showError(err.message || "Your admission pass isn't ready yet — it's issued automatically once payment is confirmed.");
  }
}

async function loadCheckinStatus() {
  try {
    const { attendances } = await apiFetch("/attendance/me");
    const checkedIn = attendances.some((a) => a.type === "CHECK_IN");
    setText("checkinStatus", checkedIn ? "Checked in" : "Not checked in yet");
  } catch {
    // non-critical
  }
}

$("downloadPassBtn")?.addEventListener("click", async () => {
  try {
    await apiDownload("/admission/me/pdf", "gy-summit-2026-admission-pass.pdf");
  } catch (err) {
    showError(err.message || "Could not download your pass.");
  }
});

$("downloadQrBtn")?.addEventListener("click", async () => {
  const qrEl = $("qrCode");
  const img = qrEl?.tagName === "IMG" ? qrEl : qrEl?.querySelector("img");
  if (!img?.src) return;
  const a = document.createElement("a");
  a.href = img.src;
  a.download = "gy-summit-2026-qr.png";
  a.click();
});

$("printPassBtn")?.addEventListener("click", () => window.print());
