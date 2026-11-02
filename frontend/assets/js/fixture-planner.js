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
  });

  // The older per-sport "Generate Fixtures" / "Schedule Performance"
  // buttons had no handler — send them to the planner with that sport picked.
  for (const [btnId, category] of [["generateFootballFixtures", "Football"], ["generateVolleyballFixtures", "Volleyball"], ["addPerformance", "Dance"]]) {
    $(btnId)?.addEventListener("click", () => openPlanner(category));
  }

  async function run({ preview }) {
    if (busy) return;
    const category = $("plannerCategory").value;
    const groupCount = Number($("plannerGroups").value) || undefined;
    busy = true;
    setStatus(preview ? "Building preview…" : "Generating and saving…");
    try {
      let data;
      try {
        data = await post({ category, groupCount, preview });
      } catch (err) {
        // Fixtures already exist: ask before rebuilding them.
        if (!preview && err.status === 409 && /replace: true/.test(err.message)) {
          if (!window.confirm(`${category} fixtures already exist. Replace them with a new plan? Scheduled fixtures only — nothing that has started is touched.`)) {
            setStatus("Cancelled — existing fixtures kept.");
            return;
          }
          data = await post({ category, groupCount, preview, replace: true });
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
      const extra = (data.warnings || []).join(" ");
      setStatus(`${data.filled} knockout slot(s) filled. ${extra}`.trim(), extra ? "error" : "ok");
      showSuccess(`${category}: qualifiers moved on.`);
      if (onSaved) await onSaved();
    } catch (err) {
      setStatus(err.message || "Could not advance qualifiers.", "error");
    } finally {
      busy = false;
    }
  }
}

function post({ category, groupCount, preview, replace = false }) {
  return apiFetch("/sports/plan-fixtures", { method: "POST", body: { category, groupCount, preview, replace } });
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
        <h4>${category === "Dance" || category === "Folk Song" ? "Heat" : "Group"} ${escapeHtml(g.group)}</h4>
        <ol>${g.teams.map((t) => `<li>${escapeHtml(String(t).replace(new RegExp(`\\s+${category}$`), ""))}</li>`).join("")}</ol>
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
          return `<tr><td>${escapeHtml(displayTime(f.time))}</td><td><span class="planner-tag">${escapeHtml(tag)}</span>${escapeHtml(who)}</td><td>${escapeHtml(f.venue)}</td></tr>`;
        })
        .join("");
      return `<div class="planner-day"><header><span>${escapeHtml(label)}</span><span>${list.length} fixture${list.length === 1 ? "" : "s"}</span></header><table><tbody>${rows}</tbody></table></div>`;
    })
    .join("");
}
