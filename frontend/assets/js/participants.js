// GY Summit 2026 — admin participants management
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, formatDate, escapeHtml, debounce, setText, $ } from "./utils.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const ACCOUNT_FORMS = ["accessControlForm"];

const admin = await requireAdminSession();
let currentPage = 1;
let pendingDeleteId = null;

if (admin) {
  wireLogoutButton();
  await loadParishOptions();
  await loadParticipants();
  wireFilters();
  wireAdminManagement();
  await loadPageSettings(ACCOUNT_FORMS);
  wireSettingsForms(["createAdminForm"]); // createAdminForm has its own dedicated handler below
  wireSettingsFileUploads();
}

function wireAdminManagement() {
  loadAdmins();

  $("createAdminForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/admins", {
        method: "POST",
        body: {
          email: $("adminEmail").value.trim(),
          fullName: $("newAdminName").value.trim(),
          phone: $("adminPhone")?.value.trim() || undefined,
          role: $("newAdminRole").value,
          temporaryPassword: crypto.randomUUID().slice(0, 12),
        },
      });
      showSuccess("Admin account created. They'll set their password via 'Forgot password' on first login.");
      e.target.reset();
      await loadAdmins();
    } catch (err) {
      showError(err.message || "Could not create admin account.");
    }
  });
}

async function loadAdmins() {
  const tbody = $("adminTableBody");
  if (!tbody) return;
  try {
    const { admins } = await apiFetch("/admin/admins");
    tbody.innerHTML = admins
      .map((a) => `<tr><td>${escapeHtml(a.fullName)}</td><td>${escapeHtml(a.email)}</td><td>${escapeHtml(a.role)}</td><td>${a.isActive ? "Active" : "Disabled"}</td></tr>`)
      .join("");
  } catch (err) {
    console.error("Could not load admins:", err.message);
  }
}

async function loadParishOptions() {
  const select = $("filterParish");
  if (!select) return;
  try {
    const { items } = await apiFetch("/structure/parishes");
    select.innerHTML =
      '<option value="">All Parishes</option>' +
      items.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  } catch (err) {
    console.error("Could not load parishes:", err.message);
  }
}

async function loadParticipants(page = 1) {
  currentPage = page;
  const overlay = $("loadingOverlay");
  if (overlay) overlay.style.display = "flex";

  try {
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    const search = $("participantSearch")?.value.trim();
    const status = $("filterPayment")?.value;
    const gender = $("filterGender")?.value;
    const parishId = $("filterParish")?.value;
    const admission = $("filterAdmission")?.value;
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (gender) params.set("gender", gender);
    if (parishId) params.set("parishId", parishId);
    if (admission) params.set("admission", admission);

    const { items, total, totalPages } = await apiFetch(`/admin/participants?${params}`);
    renderTable(items);
    renderCounts(items, total);
    renderPagination(totalPages, page);
  } catch (err) {
    showError(err.message || "Could not load participants.");
  } finally {
    if (overlay) overlay.style.display = "none";
  }
}

function renderTable(items) {
  const table = $("participantsTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;

  tbody.innerHTML = items
    .map(
      (u) => `
      <tr data-id="${u.id}">
        <td><img src="${escapeHtml(u.avatarUrl || "../assets/images/default-user.png")}" alt="" class="participant-thumb" /></td>
        <td>${escapeHtml(u.admissionCard?.cardNumber || "—")}</td>
        <td>${escapeHtml(u.fullName)}</td>
        <td>${escapeHtml(u.Parish?.name || u.Church?.name || "—")}</td>
        <td>${escapeHtml(u.gender || "—")}</td>
        <td>${u.dateOfBirth ? ageFromDob(u.dateOfBirth) : "—"}</td>
        <td>${escapeHtml(u.phone || "—")}</td>
        <td>${escapeHtml(u.medicalCondition || "None")}</td>
        <td>${escapeHtml(u.registration?.status || "—")}</td>
        <td>${u.admissionCard ? "Issued" : "—"}</td>
        <td><button class="btn btn-sm btn-outline" data-action="view" data-id="${u.id}">View</button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll('[data-action="view"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDrawer(btn.dataset.id);
    });
  });
  tbody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => openDrawer(row.dataset.id));
  });
}

function renderCounts(items, total) {
  setText("totalParticipants", total);
  setText("maleParticipants", items.filter((i) => i.gender === "MALE").length);
  setText("femaleParticipants", items.filter((i) => i.gender === "FEMALE").length);
  setText("pendingParticipants", items.filter((i) => i.registration?.status === "PENDING_PAYMENT").length);
  setText("admittedParticipants", items.filter((i) => i.admissionCard).length);
}

function renderPagination(totalPages, page) {
  // Pages are re-fetched on demand; hook up simple prev/next if present.
  const nextBtn = $("nextPage");
  const prevBtn = $("previousPage");
  if (nextBtn) nextBtn.onclick = () => page < totalPages && loadParticipants(page + 1);
  if (prevBtn) prevBtn.onclick = () => page > 1 && loadParticipants(page - 1);
  const indicator = $("pageIndicator");
  if (indicator) indicator.textContent = `Page ${page} of ${totalPages || 1}`;
}

async function openDrawer(id) {
  try {
    const { user } = await apiFetch(`/admin/participants/${id}`);
    setText("drawerName", user.fullName);
    setText("drawerEmail", user.email);
    setText("drawerPhone", user.phone);
    setText("drawerParish", user.Parish?.name || user.Church?.name || "—");
    setText("drawerGender", user.gender || "—");
    setText("drawerAge", user.dateOfBirth ? ageFromDob(user.dateOfBirth) : "—");
    setText("drawerId", user.idNumber || "—");
    setText("drawerKin", user.emergencyContactName || "—");
    setText("drawerRelationship", "Emergency contact");
    setText("drawerEmergencyPhone", user.emergencyContactPhone || "—");
    setText("drawerMedical", user.hasMedicalCondition ? (user.medicalCondition || "Yes") : "None reported");
    setText("drawerPayment", user.registration?.status || "—");
    setText("drawerAdmission", user.admissionCard?.cardNumber || "Not issued");
    setText("drawerAdmissionStatus", user.admissionCard ? (user.admissionCard.isRevoked ? "Revoked" : "Active") : "—");
    setText("drawerDate", formatDate(user.registration?.createdAt));
    const photo = $("drawerPhoto");
    if (photo && user.avatarUrl) photo.src = user.avatarUrl;

    const drawer = $("participantDrawer");
    if (drawer) drawer.classList.add("open");

    $("confirmDelete")?.setAttribute("data-id", id);
    pendingDeleteId = id;
  } catch (err) {
    showError(err.message || "Could not load participant.");
  }
}

function ageFromDob(dob) {
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
}

$("closeDrawer")?.addEventListener("click", () => $("participantDrawer")?.classList.remove("open"));

$("printProfileBtn")?.addEventListener("click", () => window.print());

$("deleteParticipantBtn")?.addEventListener("click", () => {
  const modal = $("deleteModal");
  if (modal) modal.style.display = "flex";
});

$("cancelDelete")?.addEventListener("click", () => ($("deleteModal").style.display = "none"));

$("confirmDelete")?.addEventListener("click", async () => {
  if (!pendingDeleteId) return;
  try {
    await apiFetch(`/admin/participants/${pendingDeleteId}`, { method: "PATCH", body: { isActive: false } });
    showSuccess("Participant deactivated.");
    const modal = $("deleteModal");
    if (modal) modal.style.display = "none";
    await loadParticipants(currentPage);
  } catch (err) {
    showError(err.message || "Could not update participant.");
  }
});

function wireFilters() {
  const debouncedReload = debounce(() => loadParticipants(1), 350);
  $("participantSearch")?.addEventListener("input", debouncedReload);
  $("filterPayment")?.addEventListener("change", () => loadParticipants(1));
  $("filterGender")?.addEventListener("change", () => loadParticipants(1));
  $("filterParish")?.addEventListener("change", () => loadParticipants(1));
  $("filterAdmission")?.addEventListener("change", () => loadParticipants(1));
}
