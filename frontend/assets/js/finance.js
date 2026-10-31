// Y-Summit Season 4 2026 — admin finance & parish payment/admission tracking
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, formatKes, escapeHtml, debounce, setText, $ } from "./utils.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const FINANCE_FORMS = ["financeSettingsForm"];

// Maps parish name -> the id prefix used in finance.html's per-parish counters,
// e.g. "Githunguri" -> githunguriRegistered/githunguriPaid/githunguriAdmitted.
const PARISH_ID_PREFIXES = [
  "githunguri", "gathaithi", "gathangari", "gathanji", "githiga",
  "kagaa", "kahunira", "kamburu", "karuthi", "matuguta", "riara",
];

let parishesCache = null;

window.loadParish = async function loadParish(parishName) {
  setText("selectedParishName", `${parishName} Parish`);
  try {
    if (!parishesCache) {
      const { items } = await apiFetch("/structure/parishes");
      parishesCache = items;
    }
    const parish = parishesCache.find((p) => p.name.toLowerCase() === parishName.toLowerCase());

    const { items: participants } = parish
      ? await apiFetch(`/admin/participants?parishId=${parish.id}&pageSize=500`)
      : { items: [] };

    const paid = participants.filter((p) => p.registration?.status === "CONFIRMED").length;
    const admitted = participants.filter((p) => p.admissionCard).length;
    const registered = participants.length;
    const totalSlots = 50;

    setText("paidSlots", paid);
    setText("registeredSlots", registered);
    setText("availableSlots", Math.max(0, totalSlots - registered));
    setText("admittedCount", admitted);
    setText("pendingCount", registered - admitted);
    setText("capacityLabel", `${registered} / ${totalSlots}`);

    const progress = $("capacityProgress");
    if (progress) progress.style.width = `${Math.min(100, Math.round((registered / totalSlots) * 100))}%`;

    renderTable(participants);
    document.getElementById("selectedParishSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError(err.message || `Could not load details for ${parishName}.`);
  }
};

const admin = await requireAdminSession();
if (admin) {
  wireLogoutButton();
  await loadOverview();
  await loadParticipants();
  wireSearch();
  wireAdmissionLookup();
  await loadCertificateTemplates();
  wireCertificateGeneration();
  await loadPageSettings(FINANCE_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
}

async function loadCertificateTemplates() {
  const container = $("certificateTemplatePreviews");
  if (!container) return;
  try {
    const { settings } = await apiFetch("/admin/settings");
    const templates = settings.certificateTemplatesForm || {};
    const entries = [
      { label: "Participation", url: templates["participationTemplate__url"] },
      { label: "Sports Winner", url: templates["winnerTemplate__url"] },
    ];
    container.innerHTML = entries.map((t) => `
      <div class="certificate-template-card">
        ${t.url
          ? `<img src="${escapeHtml(t.url)}" alt="${escapeHtml(t.label)} template">`
          : `<div class="no-template"><i class="fa-solid fa-image-slash"></i></div>`}
        <div class="template-label">${escapeHtml(t.label)}${t.url ? "" : " — not uploaded yet"}</div>
      </div>`).join("");
  } catch (err) {
    container.innerHTML = "<p>Could not load certificate templates.</p>";
  }
}

function wireCertificateGeneration() {
  $("generateParticipationCertsFinance")?.addEventListener("click", async () => {
    const btn = $("generateParticipationCertsFinance");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
    try {
      const result = await apiFetch("/certificates/generate", { method: "POST", body: { type: "PARTICIPATION" } });
      showSuccess(`${result.issued} new participation certificate(s) issued (${result.eligible} confirmed participants total).`);
    } catch (err) {
      showError(err.message || "Could not generate certificates.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });
}

async function loadOverview() {
  try {
    const [summary, { items }] = await Promise.all([
      apiFetch("/finance/summary"),
      apiFetch("/admin/participants?pageSize=100"),
    ]);

    setText("overallRegistered", summary.registeredCount);
    setText("overallPaid", summary.admittedCount);
    setText("overallPending", summary.awaitingAdmission);
    setText("overallAdmitted", summary.admittedCount);

    setText("calcRegisteredCount", summary.calculator.registeredCount);
    setText("calcTicketPrice", "—");
    setText("calcExpectedTotal", "—");
    setText("calcCollectedTotal", "—");
    setText("calcOutstandingTotal", "—");

    for (const prefix of PARISH_ID_PREFIXES) {
      const matches = items.filter((i) => (i.Parish?.name || "").toLowerCase().includes(prefix));
      setText(`${prefix}Registered`, matches.length);
      setText(`${prefix}Paid`, matches.filter((i) => i.registration?.status === "CONFIRMED").length);
      setText(`${prefix}Admitted`, matches.filter((i) => i.admissionCard).length);
    }
  } catch (err) {
    showError(err.message || "Could not load finance overview.");
  }
}

async function loadParticipants(search) {
  try {
    const params = new URLSearchParams({ pageSize: "50" });
    if (search) params.set("search", search);
    const { items } = await apiFetch(`/admin/participants?${params}`);
    renderTable(items);
  } catch (err) {
    showError(err.message || "Could not load participants.");
  }
}

function renderTable(items) {
  const table = $("participantsTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;
  tbody.innerHTML = items
    .map(
      (u) => `
      <tr>
        <td>${u.avatarUrl ? "<img src=\"" + escapeHtml(u.avatarUrl) + "\" alt=\"\" width=\"36\" height=\"36\" style=\"border-radius:50%;object-fit:cover\">" : "—"}</td>
        <td>${escapeHtml(u.admissionCard?.cardNumber || "—")}</td>
        <td>${escapeHtml(u.fullName)}</td>
        <td>${escapeHtml(u.gender || "—")}</td>
        <td>${escapeHtml(u.phone || "—")}</td>
        <td>${escapeHtml(u.registration?.status || "—")}</td>
        <td>${u.admissionCard ? "ISSUED" : "NOT ISSUED"}</td>
        <td><button type="button" class="secondary-btn" data-admission-code="${escapeHtml(u.admissionCard?.cardNumber || "")}">View</button></td>
      </tr>`
    )
    .join("");
  tbody.querySelectorAll("[data-admission-code]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.dataset.admissionCode;
      if (code) { $("admissionCode").value = code; lookupByAdmissionCode(); }
    });
  });
}

function wireSearch() {
  const debounced = debounce((e) => loadParticipants(e.target.value.trim()), 350);
  $("participantSearch")?.addEventListener("input", debounced);
  $("globalSearch")?.addEventListener("input", debounced);
}

let currentCard = null;

function wireAdmissionLookup() {
  $("closeSuccessModal")?.addEventListener("click", () => {
    const modal = $("successModal");
    if (modal) modal.style.display = "none";
  });

  $("searchAdmission")?.addEventListener("click", lookupByAdmissionCode);
  $("admissionCode")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookupByAdmissionCode();
  });

  $("admitParticipant")?.addEventListener("click", admitCurrentParticipant);
  $("rejectParticipant")?.addEventListener("click", resetVerificationPanel);
  $("printSlip")?.addEventListener("click", () => {
    if (!currentCard) { showError("No participant selected."); return; }
    window.print();
  });
}

async function lookupByAdmissionCode() {
  const code = $("admissionCode")?.value.trim();
  if (!code) { showError("Enter an admission code first."); return; }
  try {
    const { card, participant, registrationStatus, alreadyAdmitted } = await apiFetch(`/admission/lookup/${encodeURIComponent(code)}`);
    currentCard = card;
    renderVerificationPanel(participant, card, registrationStatus, alreadyAdmitted);
  } catch (err) {
    showError(err.message || "No participant found with that admission code.");
  }
}

function renderVerificationPanel(participant, card, registrationStatus, alreadyAdmitted) {
  setText("participantName", participant.fullName);
  setText("participantCode", card.cardNumber);
  setText("participantParish", participant.Parish?.name || "—");
  setText("participantPhone", participant.phone || "—");
  setText("participantGender", participant.gender || "—");
  setText("participantAge", participant.dateOfBirth ? `${calculateAge(participant.dateOfBirth)} yrs` : "—");
  setText("registrationDate", participant.createdAt ? new Date(participant.createdAt).toLocaleDateString() : "—");

  const photo = $("participantPhoto");
  if (photo && participant.avatarUrl) photo.src = participant.avatarUrl;

  const paymentBadge = $("paymentStatus");
  if (paymentBadge) {
    paymentBadge.textContent = registrationStatus === "CONFIRMED" ? "REGISTERED" : "NOT REGISTERED";
    paymentBadge.className = `badge ${registrationStatus === "CONFIRMED" ? "success" : "warning"}`;
  }

  const admissionBadge = $("admissionStatus");
  if (admissionBadge) {
    admissionBadge.textContent = alreadyAdmitted ? "ALREADY ADMITTED" : "NOT ADMITTED";
    admissionBadge.className = `badge ${alreadyAdmitted ? "success" : "warning"}`;
  }

  const medicalNotes = [
    participant.medicalCondition && `Condition: ${participant.medicalCondition}`,
    participant.allergies && `Allergies: ${participant.allergies}`,
    participant.disability && `Disability: ${participant.disability}`,
  ].filter(Boolean);
  setText("medicalConditions", medicalNotes.length ? medicalNotes.join(" · ") : "No medical information provided.");

  const admitBtn = $("admitParticipant");
  if (admitBtn) admitBtn.disabled = alreadyAdmitted;
}

function calculateAge(dob) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

async function admitCurrentParticipant() {
  if (!currentCard) { showError("No participant selected."); return; }
  try {
    const { participant } = await apiFetch(`/admission/${currentCard.id}/admit`, { method: "POST" });
    showAdmissionSuccessModal(participant);
    const admissionBadge = $("admissionStatus");
    if (admissionBadge) { admissionBadge.textContent = "ALREADY ADMITTED"; admissionBadge.className = "badge success"; }
    const admitBtn = $("admitParticipant");
    if (admitBtn) admitBtn.disabled = true;
    await loadOverview();
  } catch (err) {
    showError(err.message || "Could not admit this participant.");
  }
}

function resetVerificationPanel() {
  currentCard = null;
  setText("participantName", "No Participant Selected");
  setText("participantCode", "---------");
  setText("participantParish", "---------");
  setText("participantPhone", "---------");
  setText("participantGender", "---------");
  setText("participantAge", "---------");
  setText("registrationDate", "---------");
  setText("medicalConditions", "No medical information provided.");
  const paymentBadge = $("paymentStatus");
  if (paymentBadge) { paymentBadge.textContent = "—"; paymentBadge.className = "badge success"; }
  const admissionBadge = $("admissionStatus");
  if (admissionBadge) { admissionBadge.textContent = "NOT ADMITTED"; admissionBadge.className = "badge warning"; }
  const admitBtn = $("admitParticipant");
  if (admitBtn) admitBtn.disabled = false;
  const photo = $("participantPhoto");
  if (photo) photo.src = "../assets/images/default-user.png";
  $("admissionCode") && ($("admissionCode").value = "");
}

function showAdmissionSuccessModal(participant) {
  const modal = $("successModal");
  if (!modal) return;
  setText("successMessage", `${participant.fullName} (${participant.parish || "—"}) has been checked in successfully.`);
  modal.style.display = "flex";
}
