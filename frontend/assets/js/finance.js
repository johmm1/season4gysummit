// Y-Summit Season 4 2026 — registration and admission management
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, debounce, setText, $ } from "./utils.js";

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

    const participants = parish ? await fetchAllParticipants({ parishId: parish.id }) : [];

    const admitted = participants.filter((p) => p.attendances?.some((a) => a.type === "CHECK_IN")).length;
    const registered = participants.length;
    const totalSlots = 50;

    setText("paidSlots", Math.max(0, registered - admitted));
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


async function fetchAllParticipants(filters = {}) {
  const items = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ ...filters, page: String(page), pageSize: "100" });
    const result = await apiFetch(`/admin/participants?${params}`);
    items.push(...result.items);
    if (page >= result.totalPages || !result.items.length) break;
    page += 1;
  }
  return items;
}

async function loadOverview() {
  try {
    const [summary, items] = await Promise.all([
      apiFetch("/finance/summary"),
      fetchAllParticipants(),
    ]);

    setText("overallRegistered", summary.registeredCount);
    setText("overallPaid", summary.congregationCount);
    setText("overallPending", summary.awaitingAdmission);
    setText("overallAdmitted", summary.admittedCount);


    for (const prefix of PARISH_ID_PREFIXES) {
      const matches = items.filter((i) => (i.Parish?.name || "").toLowerCase().includes(prefix));
      setText(`${prefix}Registered`, matches.length);
      setText(`${prefix}Paid`, matches.length - matches.filter((i) => i.attendances?.some((a) => a.type === "CHECK_IN")).length);
      setText(`${prefix}Admitted`, matches.filter((i) => i.attendances?.some((a) => a.type === "CHECK_IN")).length);
    }
  } catch (err) {
    showError(err.message || "Could not load registration and admission overview.");
  }
}

async function loadParticipants(search) {
  try {
    const params = new URLSearchParams({ pageSize: "50" });
    if (search) params.set("search", search);
    const { items } = await apiFetch("/admin/participants?" + params);
    renderTable(items);
  } catch (err) {
    showError(err.message || "Could not load participants.");
  }
}

function renderTable(items) {
  const table = $("participantsTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;
  tbody.innerHTML = items.map((person) => {
    const admitted = person.attendances?.some((item) => item.type === "CHECK_IN");
    return `<tr>
      <td>${person.avatarUrl ? '<img src="' + escapeHtml(person.avatarUrl) + '" alt="" width="36" height="36" style="border-radius:50%;object-fit:cover">' : "—"}</td>
      <td>${escapeHtml(person.fullName)}</td>
      <td>${escapeHtml(person.gender || "—")}</td>
      <td>${escapeHtml(person.phone || "—")}</td>
      <td>${escapeHtml(person.registration?.status || "—")}</td>
      <td>${admitted ? "ADMITTED" : "NOT ADMITTED"}</td>
      <td><button type="button" class="secondary-btn" data-user-id="${escapeHtml(person.id)}">Select</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const person = items.find((item) => item.id === button.dataset.userId);
      if (person) selectParticipant(person);
    });
  });
}

function wireSearch() {
  const debounced = debounce((event) => loadParticipants(event.target.value.trim()), 350);
  $("participantSearch")?.addEventListener("input", debounced);
  $("globalSearch")?.addEventListener("input", debounced);
}

let currentParticipant = null;

function wireAdmissionLookup() {
  $("closeSuccessModal")?.addEventListener("click", () => {
    const modal = $("successModal");
    if (modal) modal.style.display = "none";
  });
  $("searchAdmission")?.addEventListener("click", lookupByName);
  $("admissionName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") lookupByName();
  });
  $("admitParticipant")?.addEventListener("click", admitCurrentParticipant);
  $("rejectParticipant")?.addEventListener("click", resetVerificationPanel);
  $("printSlip")?.addEventListener("click", () => {
    if (!currentParticipant) return showError("Select a participant first.");
    window.print();
  });
}

async function lookupByName() {
  const name = $("admissionName")?.value.trim() || "";
  if (name.length < 2) return showError("Enter at least two letters of the participant's name.");
  const results = $("admissionSearchResults");
  if (results) results.textContent = "Searching…";
  try {
    const response = await apiFetch("/admission/search?name=" + encodeURIComponent(name));
    const items = response.items || [];
    if (!results) return;
    if (!items.length) {
      results.textContent = "No participant found. Check the name and try again.";
      return;
    }
    results.innerHTML = items.map((person) => {
      const admitted = person.attendances?.length > 0;
      return `<button type="button" class="participant-result" data-user-id="${escapeHtml(person.id)}">
        <strong>${escapeHtml(person.fullName)}</strong>
        <span>${escapeHtml(person.Parish?.name || "Parish not set")} · ${escapeHtml(person.phone || "No phone")}</span>
        <small>${admitted ? "Already admitted" : "Not yet admitted"}</small>
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
  currentParticipant = person;
  renderVerificationPanel(person);
  $("admissionName") && ($("admissionName").value = person.fullName);
  $("participantVerification")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderVerificationPanel(participant) {
  setText("participantName", participant.fullName);
  setText("participantParish", participant.Parish?.name || "—");
  setText("participantPhone", participant.phone || "—");
  setText("participantGender", participant.gender || "—");
  setText("participantAge", participant.dateOfBirth ? calculateAge(participant.dateOfBirth) + " yrs" : "—");
  setText("registrationDate", participant.createdAt ? new Date(participant.createdAt).toLocaleDateString() : "—");
  const photo = $("participantPhoto");
  if (photo) photo.src = participant.avatarUrl || "../assets/images/default-user.png";
  const registered = participant.registration?.status === "CONFIRMED";
  const registrationBadge = $("registrationStatus");
  if (registrationBadge) {
    registrationBadge.textContent = registered ? "REGISTERED" : "NOT REGISTERED";
    registrationBadge.className = "badge " + (registered ? "success" : "warning");
  }
  const admitted = Boolean(participant.attendances?.length);
  const admissionBadge = $("admissionStatus");
  if (admissionBadge) {
    admissionBadge.textContent = admitted ? "ALREADY ADMITTED" : "NOT ADMITTED";
    admissionBadge.className = "badge " + (admitted ? "success" : "warning");
  }
  const notes = [participant.medicalCondition, participant.allergies, participant.disability].filter(Boolean);
  setText("medicalConditions", notes.length ? notes.join(" · ") : "No medical information provided.");
  if ($("admitParticipant")) $("admitParticipant").disabled = admitted;
}

function calculateAge(dob) {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
}

async function admitCurrentParticipant() {
  if (!currentParticipant) return showError("Search for and select a participant first.");
  try {
    const result = await apiFetch("/admission/" + encodeURIComponent(currentParticipant.id) + "/admit", {
      method: "POST",
      body: { label: "Finance desk name-based check-in" },
    });
    showAdmissionSuccessModal(result.participant);
    currentParticipant.attendances = [{ scannedAt: result.attendance.scannedAt }];
    const badge = $("admissionStatus");
    if (badge) { badge.textContent = "ALREADY ADMITTED"; badge.className = "badge success"; }
    if ($("admitParticipant")) $("admitParticipant").disabled = true;
    await loadOverview();
    await loadParticipants($("participantSearch")?.value.trim() || "");
  } catch (err) {
    showError(err.message || "Could not admit this participant.");
  }
}

function resetVerificationPanel() {
  currentParticipant = null;
  setText("participantName", "No Participant Selected");
  setText("participantParish", "—");
  setText("participantPhone", "—");
  setText("participantGender", "—");
  setText("participantAge", "—");
  setText("registrationDate", "—");
  setText("medicalConditions", "No medical information provided.");
  const registered = $("registrationStatus");
  if (registered) { registered.textContent = "—"; registered.className = "badge success"; }
  const admitted = $("admissionStatus");
  if (admitted) { admitted.textContent = "NOT ADMITTED"; admitted.className = "badge warning"; }
  if ($("admitParticipant")) $("admitParticipant").disabled = false;
  const photo = $("participantPhoto");
  if (photo) photo.src = "../assets/images/default-user.png";
}

function showAdmissionSuccessModal(participant) {
  const modal = $("successModal");
  if (!modal) return;
  setText("successMessage", `${participant.fullName} (${participant.parish || "—"}) has been checked in successfully.`);
  modal.style.display = "flex";
}
