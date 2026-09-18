// GY Summit 2026 — admin: presbytery structure (parishes + churches)
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, $ } from "./utils.js";

const admin = await requireAdminSession();

if (admin) {
  wireLogoutButton();
  await loadPresbyteryOptions();
  await loadParishes();
  await loadChurches();
  wireAddPresbytery();
  wireAddParish();
  wireAddChurch();
  wireSearch();
}

let allChurches = [];

async function loadPresbyteryOptions() {
  try {
    const { items } = await apiFetch("/structure/presbyteries");
    const options = items.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    $("newParishPresbytery").innerHTML = options;
  } catch (err) {
    showError(err.message);
  }
}

function wireAddPresbytery() {
  $("openAddPresbyteryBtn")?.addEventListener("click", () => {
    const panel = $("addPresbyteryPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  $("addPresbyteryForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await apiFetch("/structure/presbyteries", {
        method: "POST",
        body: JSON.stringify({ name: form.name.value.trim() }),
      });
      showSuccess("Presbytery added.");
      form.reset();
      $("addPresbyteryPanel").style.display = "none";
      // The new presbytery needs to show up in the "add parish" dropdown
      // right away, without a page reload.
      await loadPresbyteryOptions();
    } catch (err) {
      showError(err.message);
    }
  });
}

async function loadParishOptionsForChurchForm(parishes) {
  const options = parishes.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  $("newChurchParish").innerHTML = options;
}

async function loadParishes() {
  const tbody = $("parishTableBody");
  try {
    const { items } = await apiFetch("/structure/parishes/overview");
    await loadParishOptionsForChurchForm(items);

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11">No parishes yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((p) => `
      <tr data-id="${p.id}">
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.Presbytery?.name || "—")}</td>
        <td>${p.churchCount}</td>
        <td>${p.participantCount}</td>
        <td>${p.teamCount}</td>
        <td>${p.standing.played}</td>
        <td>${p.standing.won}</td>
        <td>${p.standing.drawn}</td>
        <td>${p.standing.lost}</td>
        <td><strong>${p.standing.points}</strong></td>
        <td><button class="btn btn-sm rename-parish-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}">Rename</button></td>
      </tr>
    `).join("");

    tbody.querySelectorAll(".rename-parish-btn").forEach((btn) => {
      btn.addEventListener("click", () => renameParish(btn.dataset.id, btn.dataset.name));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11">Failed to load.</td></tr>`;
    showError(err.message);
  }
}

async function renameParish(id, currentName) {
  const name = prompt("New parish name:", currentName);
  if (!name || name.trim() === "" || name === currentName) return;
  try {
    await apiFetch(`/structure/parishes/${id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
    showSuccess("Parish renamed. Team names and fixtures referencing it were updated too.");
    await loadParishes();
    await loadChurches();
  } catch (err) {
    showError(err.message);
  }
}

function wireAddParish() {
  $("openAddParishBtn")?.addEventListener("click", () => {
    const panel = $("addParishPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  $("addParishForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await apiFetch("/structure/parishes", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.value.trim(),
          presbyteryId: Number(form.presbyteryId.value),
        }),
      });
      showSuccess("Parish added.");
      form.reset();
      $("addParishPanel").style.display = "none";
      await loadParishes();
    } catch (err) {
      showError(err.message);
    }
  });
}

async function loadChurches() {
  const tbody = $("churchTableBody");
  try {
    const { items } = await apiFetch("/structure/churches/manage");
    allChurches = items;
    renderChurches(items);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Failed to load.</td></tr>`;
    showError(err.message);
  }
}

function renderChurches(items) {
  const tbody = $("churchTableBody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4">No churches found.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map((c) => `
    <tr data-id="${c.id}">
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.Parish?.name || "—")}</td>
      <td>${escapeHtml(c.Parish?.Presbytery?.name || "—")}</td>
      <td>
        <button class="btn btn-sm rename-church-btn" data-id="${c.id}" data-name="${escapeHtml(c.name)}">Rename</button>
        <button class="btn btn-sm danger delete-church-btn" data-id="${c.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".rename-church-btn").forEach((btn) => {
    btn.addEventListener("click", () => renameChurch(btn.dataset.id, btn.dataset.name));
  });
  tbody.querySelectorAll(".delete-church-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteChurch(btn.dataset.id));
  });
}

async function renameChurch(id, currentName) {
  const name = prompt("New church name:", currentName);
  if (!name || name.trim() === "" || name === currentName) return;
  try {
    await apiFetch(`/structure/churches/${id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
    showSuccess("Church renamed.");
    await loadChurches();
  } catch (err) {
    showError(err.message);
  }
}

async function deleteChurch(id) {
  if (!confirm("Delete this church? This can't be undone.")) return;
  try {
    await apiFetch(`/structure/churches/${id}`, { method: "DELETE" });
    showSuccess("Church deleted.");
    await loadChurches();
  } catch (err) {
    showError(err.message);
  }
}

function wireAddChurch() {
  $("openAddChurchBtn")?.addEventListener("click", () => {
    const panel = $("addChurchPanel");
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  $("addChurchForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await apiFetch("/structure/churches", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.value.trim(),
          parishId: Number(form.parishId.value),
        }),
      });
      showSuccess("Church added.");
      form.reset();
      $("addChurchPanel").style.display = "none";
      await loadChurches();
    } catch (err) {
      showError(err.message);
    }
  });
}

function wireSearch() {
  $("churchSearch")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return renderChurches(allChurches);
    renderChurches(allChurches.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.Parish?.name || "").toLowerCase().includes(q)
    ));
  });
}
