// Y-Summit Season 4 2026 — Judges platform (admin panel).
//
// Two views on one page, chosen by who signs in:
//   JUDGE                       -> mark Dance / Folk Song performances
//   SUPER_ADMIN/ADMIN/SPORTS_ADMIN -> create judges, see results and every judge's marks
import { requireSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, escapeHtml, displayTime, $ } from "./utils.js";

const ADMINS = new Set(["SUPER_ADMIN", "ADMIN", "SPORTS_ADMIN"]);
const ROUND = { GROUP: "Heat", FINAL: "Grand Final" };

let user = null;
let performances = [];
let criteriaByCategory = {};
let maxMark = 10;

const user0 = await requireSession();
if (user0) {
  user = user0;
  wireLogoutButton();
  $("adminName").textContent = user.fullName || "Judge";
  $("adminRole").textContent = user.role === "JUDGE" ? "Judge" : "Organiser";
  if (user.role === "JUDGE") await startJudgeView();
  else if (ADMINS.has(user.role)) await startAdminView();
  else window.location.href = "../participant/dashboard.html";
}

function status(text, kind = "") {
  const el = $("judgesStatus");
  if (!el) return;
  el.textContent = text;
  el.style.color = kind === "error" ? "var(--danger)" : kind === "ok" ? "var(--success)" : "";
}

function dayLabel(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/* ------------------------------ judge view ------------------------------ */

async function startJudgeView() {
  $("judgeView").hidden = false;
  $("judgesTitle").textContent = "Judging";
  $("judgesSubtitle").textContent = "Mark each performance on every criterion, from 0 to 10.";
  ["jfCategory", "jfDay", "jfStatus"].forEach((id) => $(id).addEventListener("change", renderJudgeList));
  await loadPerformances();
}

async function loadPerformances() {
  try {
    const data = await apiFetch("/judging/performances");
    performances = data.performances;
    criteriaByCategory = data.criteria;
    maxMark = data.max || 10;
    const days = [...new Set(performances.map((p) => p.date))];
    $("jfDay").innerHTML = '<option value="">All days</option>' + days.map((d) => `<option value="${d}">${escapeHtml(dayLabel(d))}</option>`).join("");
    // Open on today's date if it is an event day, otherwise show everything.
    const today = new Date().toISOString().slice(0, 10);
    if (days.includes(today)) $("jfDay").value = today;
    renderJudgeList();
  } catch (err) {
    showError(err.message || "Could not load performances.");
  }
}

function renderJudgeList() {
  const cat = $("jfCategory").value;
  const day = $("jfDay").value;
  const st = $("jfStatus").value;
  const list = performances.filter(
    (p) => (!cat || p.category === cat) && (!day || p.date === day) && (!st || (st === "done" ? p.myScore : !p.myScore))
  );
  const box = $("judgeList");
  if (!list.length) {
    box.innerHTML = '<p class="judge-empty">No performances match. Performances appear here once the organisers have generated the Dance and Folk Song timetable.</p>';
    return;
  }
  box.innerHTML = list.map(cardHtml).join("");
  box.querySelectorAll(".judge-card").forEach((card) => wireCard(card));
}

function cardHtml(p) {
  const criteria = criteriaByCategory[p.category] || [];
  const mine = p.myScore?.scores || {};
  const tag = `${p.category} · ${ROUND[p.round] || ""}${p.group ? " " + p.group : ""}`;
  const disabled = p.locked || !p.ready;
  const note = p.locked ? "Closed" : !p.ready ? "Finalist not decided yet" : p.myScore ? `Marked: ${p.myScore.total.toFixed(1)} / 100` : "Not marked";
  const inputs = criteria
    .map(
      (c) => `<label class="judge-field">
        <span>${escapeHtml(c.label)} <small>(${c.weight}%)</small></span>
        <input type="number" inputmode="decimal" min="0" max="${c.max}" step="0.5" data-key="${escapeHtml(c.key)}" value="${mine[c.key] ?? ""}" ${disabled ? "disabled" : ""}>
      </label>`
    )
    .join("");
  return `<article class="judge-card ${p.myScore ? "done" : ""}" data-id="${escapeHtml(p.id)}" data-category="${escapeHtml(p.category)}">
    <div class="judge-head">
      <div><strong>${escapeHtml(p.team || "To be decided")}</strong><br><small>${escapeHtml(tag)} · ${escapeHtml(dayLabel(p.date))} ${escapeHtml(displayTime(p.time))} · ${escapeHtml(p.venue || "")}</small></div>
      <span class="judge-note">${escapeHtml(note)}</span>
    </div>
    <div class="judge-fields">${inputs}</div>
    <textarea maxlength="500" placeholder="Comments (optional)" ${disabled ? "disabled" : ""}>${escapeHtml(p.myScore?.comments || "")}</textarea>
    <div class="judge-foot">
      <span class="judge-live">Total: <b>—</b> / 100</span>
      <button type="button" class="btn btn-primary btn-sm judge-save" ${disabled ? "disabled" : ""}><i class="fa-solid fa-floppy-disk"></i> ${p.myScore ? "Update marks" : "Submit marks"}</button>
    </div>
  </article>`;
}

function wireCard(card) {
  const category = card.dataset.category;
  const criteria = criteriaByCategory[category] || [];
  const live = card.querySelector(".judge-live b");
  const inputs = [...card.querySelectorAll("input[data-key]")];

  const recalc = () => {
    const filled = inputs.every((i) => i.value !== "" && Number.isFinite(Number(i.value)));
    if (!filled) { live.textContent = "—"; return; }
    const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 100;
    const raw = criteria.reduce((s, c) => s + (Number(card.querySelector(`[data-key="${c.key}"]`).value) / maxMark) * c.weight, 0);
    live.textContent = ((raw / totalWeight) * 100).toFixed(1);
  };
  inputs.forEach((i) => i.addEventListener("input", recalc));
  recalc();

  card.querySelector(".judge-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const scores = {};
    for (const c of criteria) {
      const el = card.querySelector(`[data-key="${c.key}"]`);
      if (el.value === "") { showError(`Please enter a mark for "${c.label}".`); el.focus(); return; }
      const n = Number(el.value);
      if (n < 0 || n > maxMark) { showError(`"${c.label}" must be between 0 and ${maxMark}.`); el.focus(); return; }
      if (Math.round(n * 2) !== n * 2) { showError(`"${c.label}" can only use whole or half marks.`); el.focus(); return; }
      scores[c.key] = n;
    }
    btn.disabled = true;
    try {
      const comments = card.querySelector("textarea").value.trim();
      const res = await apiFetch(`/judging/events/${card.dataset.id}/score`, { method: "PUT", body: { scores, comments: comments || undefined } });
      const p = performances.find((x) => x.id === card.dataset.id);
      p.myScore = { scores: res.scores, total: res.total, comments };
      showSuccess(`Saved — ${p.team}: ${res.total.toFixed(1)} / 100`);
      renderJudgeList();
    } catch (err) {
      showError(err.message || "Could not save marks.");
      btn.disabled = false;
    }
  });
}

/* ------------------------------ admin view ------------------------------ */

async function startAdminView() {
  $("adminView").hidden = false;
  $("judgesTitle").textContent = "Judges";
  $("judgesSubtitle").textContent = "Create judge accounts and follow the results for Dance and Folk Song.";
  $("judgeForm").addEventListener("submit", createJudge);
  $("lbRefresh").addEventListener("click", loadLeaderboard);
  $("lbCategory").addEventListener("change", loadLeaderboard);
  await Promise.all([loadJudges(), loadLeaderboard()]);
}

async function loadJudges() {
  try {
    const { judges } = await apiFetch("/judging/judges");
    $("judgesTable").innerHTML = judges.length
      ? `<table class="judge-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Marked</th><th>Status</th><th></th></tr></thead><tbody>${judges
          .map(
            (j) => `<tr data-id="${escapeHtml(j.id)}">
              <td>${escapeHtml(j.fullName)}</td><td>${escapeHtml(j.email)}</td><td>${escapeHtml(j.phone)}</td><td>${j.marked}</td>
              <td>${j.isActive ? "Active" : "Disabled"}</td>
              <td class="judge-actions">
                <button class="btn btn-outline btn-sm" data-act="password" type="button">Reset password</button>
                <button class="btn btn-outline btn-sm" data-act="toggle" type="button">${j.isActive ? "Disable" : "Enable"}</button>
              </td></tr>`
          )
          .join("")}</tbody></table>`
      : '<p class="judge-empty">No judges yet. Add one above.</p>';
    $("judgesTable").querySelectorAll("button[data-act]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.id;
        const judge = judges.find((j) => j.id === id);
        try {
          if (btn.dataset.act === "password") {
            const password = window.prompt(`New temporary password for ${judge.fullName} (min 8 characters):`);
            if (!password) return;
            await apiFetch(`/judging/judges/${id}`, { method: "PATCH", body: { password } });
            showSuccess("Password updated.");
          } else {
            await apiFetch(`/judging/judges/${id}`, { method: "PATCH", body: { isActive: !judge.isActive } });
            showSuccess(judge.isActive ? "Judge disabled." : "Judge enabled.");
            await loadJudges();
          }
        } catch (err) {
          showError(err.message || "Could not update the judge.");
        }
      })
    );
  } catch (err) {
    showError(err.message || "Could not load judges.");
  }
}

async function createJudge(e) {
  e.preventDefault();
  const body = {
    fullName: $("jName").value.trim(),
    email: $("jEmail").value.trim(),
    phone: $("jPhone").value.trim(),
    password: $("jPassword").value,
  };
  try {
    await apiFetch("/judging/judges", { method: "POST", body });
    showSuccess(`Judge account created for ${body.fullName}.`);
    $("judgeForm").reset();
    await loadJudges();
  } catch (err) {
    showError(err.message || "Could not create the judge.");
  }
}

async function loadLeaderboard() {
  const category = $("lbCategory").value;
  $("resultDetail").innerHTML = "";
  try {
    const { ranked, unmarked } = await apiFetch(`/judging/leaderboard?category=${encodeURIComponent(category)}`);
    if (!ranked.length && !unmarked.length) {
      $("leaderboard").innerHTML = `<p class="judge-empty">No ${escapeHtml(category)} performances yet. Generate the timetable in Sports &rarr; Fixtures first.</p>`;
      return;
    }
    const rows = ranked
      .map(
        (r) => `<tr data-id="${escapeHtml(r.id)}"><td>${r.rank}</td><td>${escapeHtml(r.team)}</td><td>${escapeHtml((ROUND[r.round] || "") + (r.group ? " " + r.group : ""))}</td><td>${r.judges}</td><td><b>${r.average.toFixed(2)}</b></td><td><button class="btn btn-outline btn-sm" type="button" data-act="detail">Marks</button></td></tr>`
      )
      .join("");
    const waiting = unmarked.length
      ? `<p class="judge-help">Waiting for marks: ${unmarked.map((u) => escapeHtml(u.team)).join(", ")}</p>`
      : "";
    $("leaderboard").innerHTML = `<table class="judge-table"><thead><tr><th>#</th><th>Team</th><th>Round</th><th>Judges</th><th>Average /100</th><th></th></tr></thead><tbody>${rows}</tbody></table>${waiting}`;
    $("leaderboard").querySelectorAll('button[data-act="detail"]').forEach((btn) =>
      btn.addEventListener("click", () => showDetail(btn.closest("tr").dataset.id))
    );
  } catch (err) {
    showError(err.message || "Could not load results.");
  }
}

async function showDetail(id) {
  try {
    const d = await apiFetch(`/judging/events/${id}/results`);
    const head = d.criteria.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
    const rows = d.marks
      .map(
        (m) => `<tr><td>${escapeHtml(m.judge)}</td>${d.criteria.map((c) => `<td>${m.scores[c.key] ?? "—"}</td>`).join("")}<td><b>${m.total.toFixed(1)}</b></td><td>${escapeHtml(m.comments || "")}</td></tr>`
      )
      .join("");
    $("resultDetail").innerHTML = `<h4 style="margin:16px 0 8px">${escapeHtml(d.team)} — judges' marks</h4>
      <div style="overflow-x:auto"><table class="judge-table"><thead><tr><th>Judge</th>${head}<th>Total</th><th>Comments</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No marks yet.</td></tr>'}</tbody></table></div>`;
    $("resultDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError(err.message || "Could not load the marks.");
  }
}
