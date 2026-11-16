// Y-Summit Season 4 2026 — admin "Groups & Day Planner" panel.
// Talks to POST /sports/plan-fixtures (preview or save) and
// POST /sports/advance-from-groups, and renders the groups and the
// day-by-day timetable so admins can check it before saving.
import { apiFetch, showError, showSuccess, escapeHtml, displayTime, $ } from "./utils.js";

let busy = false;

export function initFixturePlanner({ onSaved } = {}) {
  if (!$("plannerPanel")) return;

  $("plannerPreview")?.addEventListener("click", () => run({ preview: true }));
  $("plannerSave")?.addEventListener("click", () => run({ preview: false }));
  $("plannerAdvance")?.addEventListener("click", advance);
  $("plannerCategory")?.addEventListener("change", () => {
    $("plannerGroupsView").innerHTML = "";
    $("plannerDaysView").innerHTML = "";
    setStatus("");
    loadPoolAssignments();
  });
  loadPoolAssignments();

  // The older per-sport "Generate Fixtures" / "Schedule Performance"
  // buttons had no handler — send them to the planner with that sport picked.
  for (const [btnId, category] of [["generateFootballFixtures", "Football"], ["generateVolleyballFixtures", "Volleyball"], ["addPerformance", "Dance"]]) {
    $(btnId)?.addEventListener("click", () => openPlanner(category));
  }

  async function run({ preview }) {
    if (busy) return;
    const category = $("plannerCategory").value;
    const groupCount = Number($("plannerGroups").value) || undefined;
    const pools = category === "Football" ? selectedPools() : {};
    if (category === "Football" && pools.error) { setStatus(pools.error, "error"); return; }
    busy = true;
    setStatus(preview ? "Building preview…" : "Generating and saving…");
    try {
      let data;
      try {
        data = await post({ category, groupCount, preview, ...pools });
      } catch (err) {
        // Fixtures already exist: ask before rebuilding them.
        if (!preview && err.status === 409 && /replace: true/.test(err.message)) {
          if (!window.confirm(`${category} fixtures already exist. Replace them with a new plan? Scheduled fixtures only — nothing that has started is touched.`)) {
            setStatus("Cancelled — existing fixtures kept.");
            return;
          }
          data = await post({ category, groupCount, preview, replace: true, ...pools });
        } else {
          throw err;
        }
      }
      render(data);
      if (preview) {
        setStatus(`Preview: ${data.fixtures.length} fixtures over ${Object.keys(data.perDay).length} days. Nothing saved yet.`);
      } else {
        setStatus(`Saved ${data.fixtures.length} fixtures.`, "ok");
        showSuccess(`${category}: ${data.fixtures.length} fixtures saved across the event days.`);
        if (onSaved) await onSaved();
      }
    } catch (err) {
      setStatus(err.message || "Could not plan fixtures.", "error");
      showError(err.message || "Could not plan fixtures.");
    } finally {
      busy = false;
    }
  }

  async function advance() {
    if (busy) return;
    const category = $("plannerCategory").value;
    busy = true;
    setStatus("Checking results…");
    try {
      const data = await apiFetch("/sports/advance-from-groups", { method: "POST", body: { category } });
      const extra = data.message || (data.warnings || []).join(" ");
      const stage = data.stage ? `Stage: ${data.stage.replaceAll("_", " ")}. ` : "";
      setStatus(`${stage}${data.filled} progression slot(s) updated. ${extra}`.trim(), extra && !data.filled ? "error" : "ok");
      showSuccess(`${category}: tournament progression checked.`);
      if (onSaved) await onSaved();
    } catch (err) {
      setStatus(err.message || "Could not advance qualifiers.", "error");
    } finally {
      busy = false;
    }
  }
}

function post({ category, groupCount, preview, replace = false, poolA, poolB }) {
  return apiFetch("/sports/plan-fixtures", { method: "POST", body: { category, groupCount, preview, replace, poolA, poolB } });
}

let availableFootballTeams = [];
let poolSelections = { A: [], B: [] };

async function loadPoolAssignments() {
  const panel = $("plannerPoolAssignment");
  if (!panel) return;
  const isFootball = $("plannerCategory")?.value === "Football";
  panel.hidden = !isFootball;
  if (!isFootball) return;
  try {
    const data = await apiFetch("/sports/teams?category=Football");
    availableFootballTeams = (data.teams || []).map((t) => t.name).filter(Boolean).sort((a,b) => a.localeCompare(b));
    poolSelections = { A: [], B: [] };
    renderPoolChooser();
  } catch (err) {
    setStatus("Could not load football teams: " + (err.message || "try again"), "error");
  }
}

function renderPoolChooser() {
  const panel = $("plannerPoolAssignment");
  if (!panel) return;
  const label = (name) => name.replace(/\\s+Football$/i, "");
  panel.innerHTML = `
    <div class="planner-pool-chooser">
      <h3>1. Assign parishes to pools</h3>
      <p class="planner-help">Tap a parish, then choose Pool A or Pool B. Each parish can belong to one pool only.</p>
      <div class="planner-team-picker">${availableFootballTeams.map((name, i) => `
        <label class="planner-team-option"><input type="checkbox" data-team-index="${i}"><span>${escapeHtml(label(name))}</span></label>`).join("")}</div>
      <div class="planner-assign-actions">
        <button type="button" class="btn btn-outline" id="assignPoolA">Add selected to Pool A</button>
        <button type="button" class="btn btn-outline" id="assignPoolB">Add selected to Pool B</button>
      </div>
      <div class="planner-pool-columns">
        <section><h4>Pool A <small>(${poolSelections.A.length}/6)</small></h4><ol>${poolSelections.A.map(n => `<li>${escapeHtml(label(n))}</li>`).join("") || "<li>No parishes assigned</li>"}</ol></section>
        <section><h4>Pool B <small>(${poolSelections.B.length}/5)</small></h4><ol>${poolSelections.B.map(n => `<li>${escapeHtml(label(n))}</li>`).join("") || "<li>No parishes assigned</li>"}</ol></section>
      </div>
      <div id="plannerPairings"></div>
    </div>`;
  panel.querySelector("#assignPoolA").addEventListener("click", () => assignSelected("A"));
  panel.querySelector("#assignPoolB").addEventListener("click", () => assignSelected("B"));
  renderPairings();
}

function assignSelected(pool) {
  const selected = [...$("plannerPoolAssignment").querySelectorAll("input[data-team-index]:checked")]
    .map(el => availableFootballTeams[Number(el.dataset.teamIndex)]);
  for (const team of selected) {
    poolSelections.A = poolSelections.A.filter(x => x !== team);
    poolSelections.B = poolSelections.B.filter(x => x !== team);
    if (poolSelections[pool].length < (pool === "A" ? 6 : 5)) poolSelections[pool].push(team);
  }
  renderPoolChooser();
}

function renderPairings() {
  const host = $("plannerPairings");
  if (!host) return;
  const ready = poolSelections.A.length === 6 && poolSelections.B.length === 5;
  if (!ready) {
    host.innerHTML = '<p class="planner-help">Assign 6 parishes to Pool A and 5 to Pool B to unlock opening matchups.</p>';
    return;
  }
  const makeRows = (pool, count) => Array.from({length: count}, (_, i) => {
    const options = poolSelections[pool].map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n.replace(/\\s+Football$/i, ""))}</option>`).join("");
    return `<div class="planner-pair-row"><strong>Match ${i+1}</strong><select data-pair-pool="${pool}" data-pair-index="${i}" data-side="home"><option value="">Choose parish</option>${options}</select><span>vs</span><select data-pair-pool="${pool}" data-pair-index="${i}" data-side="away"><option value="">Choose opponent</option>${options}</select></div>`;
  }).join("");
  host.innerHTML = `
    <h3>2. Choose opening matchups</h3>
    <h4>Pool A — three matches</h4>${makeRows("A",3)}
    <h4>Pool B — two matches</h4>${makeRows("B",2)}
    <p class="planner-help">The remaining fifth Pool B parish receives the existing best-loser playoff slot. The system will arrange later cross-pool and knockout rounds automatically.</p>`;
}

function selectedPools() {
  const a = poolSelections.A, b = poolSelections.B;
  if (a.length !== 6 || b.length !== 5) return { error: "Assign exactly 6 parishes to Pool A and 5 to Pool B." };
  if (new Set([...a, ...b]).size !== 11) return { error: "A parish can appear in one pool only." };
  const getPairs = (pool, count) => Array.from({length: count}, (_, i) => {
    const home = document.querySelector(`[data-pair-pool="${pool}"][data-pair-index="${i}"][data-side="home"]`)?.value;
    const away = document.querySelector(`[data-pair-pool="${pool}"][data-pair-index="${i}"][data-side="away"]`)?.value;
    return home && away ? [home, away] : null;
  });
  const poolAMatches = getPairs("A",3), poolBMatches = getPairs("B",2);
  if ([...poolAMatches,...poolBMatches].some(p => !p || p[0] === p[1])) return { error: "Choose two different parishes for every opening match." };
  const allPaired = [...poolAMatches,...poolBMatches].flat();
  if (new Set(allPaired).size !== 10) return { error: "Each parish must appear in only one opening matchup. Check for duplicate selections." };
  if (poolAMatches.some(p => p.some(n => !a.includes(n))) || poolBMatches.some(p => p.some(n => !b.includes(n)))) return { error: "Each matchup must use parishes from its own pool." };
  return { poolA: a, poolB: b, poolAMatches, poolBMatches };
}

function openPlanner(category) {
  document.querySelector('.sports-tab[data-tab="fixtures"]')?.click();
  const select = $("plannerCategory");
  if (select) select.value = category;
  $("plannerPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setStatus(text, kind = "") {
  const el = $("plannerStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `planner-status ${kind}`.trim();
}

const ROUND_LABEL = { GROUP: "Group", SEMI: "SF", FINAL: "Final" };

function render({ groups, fixtures, category }) {
  $("plannerGroupsView").innerHTML = groups
    .map(
      (g) => `<div class="planner-group">
        <h4>${category === "Football" && groups.length === 2 ? `🏟️ Pool ${escapeHtml(g.group)} · ${g.teams.length} Churches` : `${category === "Dance" || category === "Folk Song" ? "Heat" : "Group"} ${escapeHtml(g.group)}`}</h4>
        <ol>${g.teams.map((t) => `), ""))}</li>`).join("")}</ol>
      </div>`
    )
    .join("");

  const byDay = new Map();
  for (const f of fixtures) {
    if (!byDay.has(f.date)) byDay.set(f.date, []);
    byDay.get(f.date).push(f);
  }
  $("plannerDaysView").innerHTML = [...byDay.entries()]
    .map(([date, list]) => {
      const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
      const rows = list
        .map((f) => {
          const who = f.teamAway ? `${f.teamHome || "TBD"} vs ${f.teamAway}` : f.teamHome || f.name;
          const tag = `${ROUND_LABEL[f.round] || ""}${f.group ? " " + f.group : ""}${f.bracketSlot ? " " + f.bracketSlot : ""}`.trim();
          const icon = f.bracketSlot === "PB3" ? "⭐" : f.bracketSlot === "THIRD" ? "🥉" : f.bracketSlot === "F" ? "🏆" : f.round === "SEMI" ? "🥇" : f.round === "QUARTER" ? "⚽" : "🏟️";
          return `<tr><td>${escapeHtml(displayTime(f.time))}</td><td><span class="planner-tag">${icon} ${escapeHtml(tag)}</span>${escapeHtml(who)}</td><td>${escapeHtml(f.venue)}</td></tr>`;
        })
        .join("");
      return `<div class="planner-day"><header><span>${escapeHtml(label)}</span><span>${list.length} fixture${list.length === 1 ? "" : "s"}</span></header><table><tbody>${rows}</tbody></table></div>`;
    })
    .join("");
}
