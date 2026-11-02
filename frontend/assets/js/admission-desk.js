// Y-Summit Season 4 2026 — admissions desk
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, debounce, formatKes } from "./utils.js";

const admin = await requireAdminSession();
if (!admin) throw new Error("Not signed in");

wireLogoutButton();

const $ = (id) => document.getElementById(id);
let selectedId = null;
let dormitories = [];
let searchToken = 0;

// ---------- clock ----------
setInterval(() => { $("liveClock").textContent = new Date().toLocaleTimeString("en-KE", { hour12: false }); }, 1000);
$("liveClock").textContent = new Date().toLocaleTimeString("en-KE", { hour12: false });

// ---------- tabs ----------
document.querySelectorAll(".desk-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".desk-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".desk-pane").forEach((p) => { p.hidden = p.id !== `pane-${tab.dataset.tab}`; });
    if (tab.dataset.tab === "slots") loadSlots();
    if (tab.dataset.tab === "dorms") loadDorms();
    if (tab.dataset.tab === "recent") loadRecent();
    if (tab.dataset.tab === "desk") $("nameSearch").focus();
  });
});

// ---------- totals ----------
async function loadStats() {
  try {
    const s = await apiFetch("/admission/summary");
    $("statRegistered").textContent = s.registered;
    $("statPaid").textContent = s.paid;
    $("statAdmitted").textContent = s.admitted;
    $("statCollected").textContent = formatKes(s.collected);
  } catch (err) { /* totals are a convenience; never block the desk */ }
}

// ---------- search ----------
const runSearch = debounce(async () => {
  const q = $("nameSearch").value.trim();
  const box = $("results");
  if (q.length < 2) {
    box.innerHTML = "";
    $("searchHint").textContent = "Start typing to see suggestions. You can also type the last digits of a phone number.";
    return;
  }
  const mine = ++searchToken;
  try {
    const { items } = await apiFetch(`/admission/search?q=${encodeURIComponent(q)}`);
    if (mine !== searchToken) return; // a newer search is already running
    if (!items.length) {
      box.innerHTML = `<div class="desk-empty">No one found for “${escapeHtml(q)}”.<br>Try fewer letters or just the first name.</div>`;
      $("searchHint").textContent = "";
      return;
    }
    $("searchHint").textContent = items.length === 1 ? "1 suggestion" : `${items.length} suggestions — tap the right person`;
    box.innerHTML = items.map((p) => `
      <button type="button" class="desk-result ${p.id === selectedId ? "is-selected" : ""}" data-id="${p.id}">
        <b>${escapeHtml(p.fullName)}</b>
        <small>${escapeHtml([p.parish, p.church].filter(Boolean).join(" · ") || "No parish recorded")}${p.phone ? " · " + escapeHtml(p.phone) : ""}</small>
        <span class="desk-badges">
          ${p.admitted ? '<span class="desk-badge ok">Admitted</span>' : ""}
          ${p.paid ? '<span class="desk-badge ok">Paid</span>' : '<span class="desk-badge warn">Not paid</span>'}
          ${!p.exact ? '<span class="desk-badge">Similar spelling</span>' : ""}
        </span>
      </button>`).join("");
  } catch (err) {
    showError(err.message || "Search failed.");
  }
}, 220);

$("nameSearch").addEventListener("input", runSearch);
$("results").addEventListener("click", (e) => {
  const btn = e.target.closest(".desk-result");
  if (!btn) return;
  selectedId = btn.dataset.id;
  document.querySelectorAll(".desk-result").forEach((el) => el.classList.toggle("is-selected", el === btn));
  openPerson(selectedId);
  if (window.innerWidth <= 900) $("person").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- participant panel ----------
async function openPerson(id) {
  const panel = $("person");
  panel.hidden = false;
  panel.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const [{ participant }, dorms] = await Promise.all([
      apiFetch(`/admission/participant/${id}`),
      dormitories.length ? { items: dormitories } : apiFetch("/admission/dormitories"),
    ]);
    dormitories = dorms.items;
    renderPerson(participant);
  } catch (err) {
    panel.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function slotMeter(slots, parishName) {
  if (!slots.configured) {
    return `<div class="slot-meter is-full"><div class="line"><span><b>${escapeHtml(parishName || "No parish recorded")}</b></span>
      <span>No bank reference code with slots for this parish</span></div></div>`;
  }
  const pct = slots.total ? Math.min(100, Math.round((slots.used / slots.total) * 100)) : 100;
  const codeLines = slots.codes.map((c) =>
    `<span class="code-chip ${c.remaining === 0 ? "is-empty" : ""}">${escapeHtml(c.code)} · ${c.remaining} left</span>`).join("");
  return `<div class="slot-meter ${slots.remaining === 0 ? "is-full" : ""}">
    <div class="line"><span><b>${escapeHtml(parishName)}</b></span>
    <span><b>${slots.remaining}</b> slot${slots.remaining === 1 ? "" : "s"} left · ${slots.used} of ${slots.total} used</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="code-chips">${codeLines}</div></div>`;
}

function renderPerson(p) {
  const initials = p.fullName.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const m = p.medical || {};
  const alerts = [
    m.hasCondition && m.condition ? `Condition: ${m.condition}${m.medication ? " (medication: " + m.medication + ")" : ""}` : null,
    m.allergies ? `Allergies: ${m.allergies}` : null,
    m.disability ? `Disability: ${m.disability}` : null,
    m.diet ? `Diet: ${m.diet}` : null,
  ].filter(Boolean);

  const openCodes = p.slots.codes.filter((c) => c.remaining > 0);
  const blocked = !p.paid && openCodes.length === 0;
  const canOverride = ["SUPER_ADMIN", "ADMIN"].includes(admin.role);
  const preferred = openCodes.find((c) => p.registeredWithCode && c.code.toLowerCase() === p.registeredWithCode.toLowerCase()) || openCodes[0];
  const codeSelect = openCodes.length > 1
    ? `<select id="codeSelect" aria-label="Bank reference code">${openCodes.map((c) =>
        `<option value="${c.id}" ${c.id === preferred.id ? "selected" : ""}>${escapeHtml(c.code)} (${c.remaining} left)</option>`).join("")}</select>`
    : "";
  const dormOptions = dormitories.map((d) => {
    const wrongGender = d.gender !== "MIXED" && p.gender && d.gender !== p.gender;
    const full = d.available === 0 && p.dormitory?.id !== d.id;
    const label = `${d.name}${d.capacity ? ` (${d.available} of ${d.capacity} free)` : ""}${d.gender !== "MIXED" ? ` · ${d.gender === "MALE" ? "males" : "females"}` : ""}`;
    return `<option value="${d.id}" ${p.dormitory?.id === d.id ? "selected" : ""} ${wrongGender || full ? "disabled" : ""}>${escapeHtml(label)}</option>`;
  }).join("");

  $("person").innerHTML = `
    <div class="person-top">
      <div class="person-avatar">${p.avatarUrl ? `<img src="${escapeHtml(p.avatarUrl)}" alt="">` : escapeHtml(initials)}</div>
      <div>
        <h2>${escapeHtml(p.fullName)}</h2>
        <p>${escapeHtml([p.church, p.gender ? p.gender.toLowerCase() : null, p.phone].filter(Boolean).join(" · "))}</p>
      </div>
    </div>

    ${slotMeter(p.slots, p.parish?.name)}
    ${alerts.length ? `<div class="alert-box"><b><i class="fa-solid fa-triangle-exclamation"></i> Health &amp; care notes</b>${alerts.map(escapeHtml).join("<br>")}</div>` : ""}

    <div class="step ${p.paid ? "done" : ""}">
      <div class="step-num">${p.paid ? "✓" : "1"}</div>
      <div>
        <h3>Payment</h3>
        ${p.paid
          ? `<p>Paid ${formatKes(p.amountPaid ?? p.amountDue)}${p.paidAt ? " on " + new Date(p.paidAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : ""}${p.paidWithCode ? " · code " + escapeHtml(p.paidWithCode) : ""}.</p>
             ${p.admitted ? "" : '<div class="step-actions"><button class="desk-btn ghost small" id="undoPaid" type="button">Undo payment</button></div>'}`
          : blocked
            ? `<p>${p.slots.configured ? "All of this parish’s bank reference slots are used." : "This parish has no bank reference code with slots."} Add or increase slots in the <b>Parish slots</b> tab.</p>
               ${canOverride ? '<div class="step-actions"><button class="desk-btn ghost small" id="markPaidOverride" type="button">Take payment without a slot (admin)</button></div>' : ""}`
            : `<p>Confirm the participant has paid ${formatKes(p.amountDue || 2200)} at the desk. One slot is used from the parish’s bank reference code.</p>
               <div class="step-actions">${codeSelect}<button class="desk-btn success" id="markPaid" type="button"><i class="fa-solid fa-circle-check"></i> Mark as paid</button></div>`}
      </div>
    </div>

    <div class="step ${p.dormitory ? "done" : ""}">
      <div class="step-num">${p.dormitory ? "✓" : "2"}</div>
      <div>
        <h3>Dormitory</h3>
        ${dormitories.length
          ? `<p>${p.dormitory ? "Assigned to " + escapeHtml(p.dormitory.name) + "." : "Choose where this participant will sleep."}</p>
             <div class="step-actions">
               <select id="dormSelect" aria-label="Dormitory"><option value="">— Select dormitory —</option>${dormOptions}</select>
               <button class="desk-btn primary small" id="assignDorm" type="button">Assign</button>
             </div>`
          : `<p>No dormitories added yet. Add them in the <b>Dormitories</b> tab.</p>`}
      </div>
    </div>

    <div class="step ${p.admitted ? "done" : ""}">
      <div class="step-num">${p.admitted ? "✓" : "3"}</div>
      <div>
        <h3>Admission</h3>
        ${p.admitted
          ? `<p>Admitted${p.admittedAt ? " at " + new Date(p.admittedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : ""}.</p>`
          : `<p>${p.paid ? "Everything is ready — admit the participant." : "Mark the participant as paid first."}</p>
             <div class="step-actions"><button class="desk-btn primary" id="admitBtn" type="button" ${p.paid ? "" : "disabled"}><i class="fa-solid fa-door-open"></i> Admit</button></div>`}
      </div>
    </div>`;

  $("markPaid")?.addEventListener("click", () => {
    const codeId = $("codeSelect")?.value;
    act(`/admission/${p.id}/mark-paid`, codeId ? { codeId } : {}, "Marked as paid.");
  });
  $("markPaidOverride")?.addEventListener("click", () => {
    if (confirm(`Take payment for ${p.fullName} without using a bank reference slot? This is recorded.`)) {
      act(`/admission/${p.id}/mark-paid`, { allowWithoutCode: true }, "Marked as paid (no slot used).");
    }
  });
  $("undoPaid")?.addEventListener("click", () => {
    if (confirm(`Undo payment for ${p.fullName}? Their parish slot will be returned.`)) act(`/admission/${p.id}/undo-paid`, {}, "Payment undone.");
  });
  $("assignDorm")?.addEventListener("click", () => {
    const v = $("dormSelect").value;
    act(`/admission/${p.id}/dormitory`, { dormitoryId: v ? Number(v) : null }, v ? "Dormitory assigned." : "Dormitory cleared.");
  });
  $("admitBtn")?.addEventListener("click", async () => {
    if (!p.dormitory && dormitories.length && !confirm("No dormitory assigned yet. Admit anyway?")) return;
    await act(`/admission/${p.id}/admit`, {}, `${p.fullName} admitted.`);
    dormitories = []; // refresh bed counts next time
  });
}

async function act(path, body, message) {
  const buttons = document.querySelectorAll("#person button");
  buttons.forEach((b) => { b.disabled = true; });
  try {
    const { participant } = await apiFetch(path, { method: "POST", body });
    showSuccess(message);
    dormitories = (await apiFetch("/admission/dormitories")).items;
    renderPerson(participant);
    loadStats();
    runSearch(); // keep the suggestion badges current
  } catch (err) {
    showError(err.message);
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// ---------- parish slots (bank reference codes) ----------
async function loadSlots() {
  const sumBody = $("slotsSummary");
  const codeBody = $("codesBody");
  try {
    const { items, parishes } = await apiFetch("/admission/codes");
    sumBody.innerHTML = parishes.map((r) => `
      <tr><td>${escapeHtml(r.parish)}</td><td class="num">${r.codes}</td><td class="num">${r.total}</td>
      <td class="num">${r.used}</td><td class="num ${r.codes && r.remaining === 0 ? "zero" : ""}">${r.codes ? r.remaining : "—"}</td></tr>`).join("")
      || '<tr><td colspan="5" class="muted">No parishes found. Add them under Structure.</td></tr>';
    codeBody.innerHTML = items.map((c) => `
      <tr class="${c.isActive ? "" : "is-inactive"}">
        <td><b>${escapeHtml(c.code)}</b></td>
        <td>${escapeHtml(c.parish)}</td>
        <td class="num"><input type="number" min="${c.used}" value="${c.total}" data-code="${c.id}" aria-label="Slots for ${escapeHtml(c.code)}"></td>
        <td class="num">${c.used}</td>
        <td class="num ${c.remaining === 0 ? "zero" : ""}">${c.remaining}</td>
        <td class="num" style="white-space:nowrap">
          <button class="desk-btn small" data-save="${c.id}" type="button">Save</button>
          <button class="desk-btn small ghost" data-toggle="${c.id}" data-active="${c.isActive}" type="button">${c.isActive ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("") || '<tr><td colspan="6" class="muted">No codes yet — add them on the left.</td></tr>';
  } catch (err) {
    codeBody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

$("addCodes").addEventListener("click", async () => {
  const lines = $("codeLines").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return showError("Type at least one line: CODE, Parish, Slots.");
  const items = [];
  for (const line of lines) {
    const parts = line.split(/[,\t;]+/).map((x) => x.trim());
    const slots = Number(parts[parts.length - 1]);
    if (parts.length < 3 || !Number.isInteger(slots) || slots < 0) return showError(`Check this line: “${line}”. Use CODE, Parish, Slots.`);
    items.push({ code: parts[0], parish: parts.slice(1, -1).join(", "), totalSlots: slots });
  }
  try {
    const r = await apiFetch("/admission/codes", { method: "POST", body: { items } });
    $("codeLines").value = "";
    showSuccess(`${r.created} added, ${r.updated} updated.`);
    loadSlots();
  } catch (err) { showError(err.message); }
});

$("codesBody").addEventListener("click", async (e) => {
  const save = e.target.closest("[data-save]");
  const toggle = e.target.closest("[data-toggle]");
  try {
    if (save) {
      const input = document.querySelector(`input[data-code="${save.dataset.save}"]`);
      await apiFetch(`/admission/codes/${save.dataset.save}`, { method: "PATCH", body: { totalSlots: Number(input.value) } });
      showSuccess("Slots saved.");
      loadSlots();
    } else if (toggle) {
      await apiFetch(`/admission/codes/${toggle.dataset.toggle}`, { method: "PATCH", body: { isActive: toggle.dataset.active !== "true" } });
      loadSlots();
    }
  } catch (err) { showError(err.message); }
});

// ---------- dormitories ----------
async function loadDorms() {
  const body = $("dormBody");
  try {
    dormitories = (await apiFetch("/admission/dormitories")).items;
    renderDorms();
  } catch (err) { body.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(err.message)}</td></tr>`; }
}
function renderDorms() {
  $("dormBody").innerHTML = dormitories.map((d) => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${d.gender === "MIXED" ? "Everyone" : d.gender === "MALE" ? "Males" : "Females"}</td>
      <td class="num">${d.capacity ?? "—"}</td>
      <td class="num">${d.occupied}</td>
      <td class="num"><button class="desk-btn ghost small" data-del="${d.id}" type="button" aria-label="Delete ${escapeHtml(d.name)}"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join("") || '<tr><td colspan="5" class="muted">No dormitories yet — add some on the left.</td></tr>';
}
$("addDorms").addEventListener("click", async () => {
  const names = $("dormNames").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return showError("Type at least one dormitory name.");
  const cap = $("dormCapacity").value.trim();
  try {
    const res = await apiFetch("/admission/dormitories", {
      method: "POST",
      body: { names, gender: $("dormGender").value, capacity: cap ? Number(cap) : null },
    });
    dormitories = res.items;
    $("dormNames").value = "";
    renderDorms();
    showSuccess(names.length === 1 ? "Dormitory added." : `${names.length} dormitories added.`);
  } catch (err) { showError(err.message); }
});
$("dormBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del]");
  if (!btn || !confirm("Delete this dormitory?")) return;
  try {
    dormitories = (await apiFetch(`/admission/dormitories/${btn.dataset.del}`, { method: "DELETE" })).items;
    renderDorms();
  } catch (err) { showError(err.message); }
});

// ---------- recently admitted ----------
async function loadRecent() {
  const list = $("recentList");
  try {
    const { items } = await apiFetch("/attendance?type=CHECK_IN&pageSize=30");
    list.innerHTML = items.length ? items.map((a) => `
      <div class="item"><div><b>${escapeHtml(a.user?.fullName || "—")}</b><br><small>${escapeHtml(a.user?.Parish?.name || "")}</small></div>
      <small>${new Date(a.scannedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</small></div>`).join("")
      : '<p class="muted">No one has been admitted yet.</p>';
  } catch (err) { list.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`; }
}

loadStats();
