// Y-Summit Season 4 2026 — participant sports fixtures & results (read-only view)
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, formatDateTime, displayTime, escapeHtml, setText, $ } from "../../assets/js/utils.js";

const user = await requireSession();
let allEvents = [];
let groupTables = []; // GET /sports/groups: group tables (Football/Volleyball) and heats (Folk Song/Dance)
const JUDGED = new Set(["Dance", "Folk Song"]);
const SPORT_NAMES = { football: "Football", volleyball: "Volleyball", dance: "Dance", folksong: "Folk Song" };

/** Event date/time in East Africa Time, whatever the viewer's device time zone is. */
function eat(startsAt) {
  const iso = new Date(new Date(startsAt).getTime() + 3 * 3600000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const shortDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const stripSport = (team) => String(team || "").replace(/\s+(Football|Volleyball|Dance|Folk Song)\s*$/i, "");
let activeSport = "Football";
let timetableDays = [];
let activeTimetableDay = null;

if (user) {
  wireLogoutButton();
  setText("participantName", user.fullName);
  setText("participantParish", user.Parish?.name || user.Church?.name || "—");
  const photo = $("participantPhoto");
  if (photo && user.avatarUrl) photo.src = user.avatarUrl;
  hideUnsupportedSections();
  await loadFixtures();
  await loadTimetable();
  wireControls();
  wireSportTabs();
}

function wireSportTabs() {
  document.querySelectorAll(".sport-tab[data-sport]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sport-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeSport = SPORT_NAMES[btn.dataset.sport] || btn.dataset.sport;
      applyFilters();
      renderStandings(allEvents);
      renderBracket(allEvents);
      renderDanceSchedule(allEvents);
    });
  });
}

function hideUnsupportedSections() {
  // Top scorers / MVP need per-player stat tracking, which doesn't exist yet —
  // hide rather than show a permanently-empty list.
  for (const id of ["topScorersList", "mvpList"]) {
    const section = $(id)?.closest("section, .card");
    if (section) section.style.display = "none";
  }
}

async function loadFixtures(category) {
  try {
    const { events } = await apiFetch(category ? `/sports?category=${encodeURIComponent(category)}` : "/sports");
    allEvents = events;
    try {
      groupTables = (await apiFetch("/sports/groups")).groups || [];
    } catch {
      groupTables = [];
    }
    applyFilters();
    renderResults(events.filter((e) => e.status === "COMPLETED"));
    renderToday(events);
    renderStandings(events);
    renderBracket(events);
    renderDanceSchedule(events);
  } catch (err) {
    showError(err.message || "Could not load sports fixtures.");
  }
}

function wireControls() {
  $("fixtureSearch")?.addEventListener("input", applyFilters);
  $("fixtureRound")?.addEventListener("change", applyFilters);
  $("groupFilter")?.addEventListener("change", () => renderStandings(allEvents));
}

function applyFilters() {
  const search = ($("fixtureSearch")?.value || "").toLowerCase();
  const round = $("fixtureRound")?.value;
  const filtered = allEvents.filter((e) => {
    if (activeSport && e.category !== activeSport) return false;
    if (round && round !== "all") {
      const wanted = round === "group" ? "GROUP" : round === "semi" ? "SEMI" : round === "final" ? "FINAL" : null;
      if (wanted && e.round !== wanted) return false;
    }
    if (search) {
      const haystack = `${e.teamHome || ""} ${e.teamAway || ""} ${e.venue}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
  renderFixtures(filtered);
}

function renderFixtures(events) {
  const table = $("fixturesTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="7">No fixtures scheduled yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = events
    .map((e) => {
      const { date, time } = eat(e.startsAt);
      const statusClass = e.status === "COMPLETED" ? "badge-success" : e.status === "ONGOING" ? "badge-danger" : e.status === "CANCELLED" ? "badge-outline" : "badge-warning";
      const judged = JUDGED.has(e.category);
      // Judged performances have one team: show the heat / final instead of "vs TBD".
      const roundTag = e.round === "FINAL" ? "Grand Final" : e.group ? `Heat ${e.group}` : "";
      const home = escapeHtml(stripSport(e.teamHome) || "TBD");
      const middle = judged ? "·" : "VS";
      const away = judged ? escapeHtml(roundTag) : escapeHtml(stripSport(e.teamAway) || "TBD");
      const score = !judged && e.status === "COMPLETED" && e.scoreHome != null ? ` <strong>${e.scoreHome} : ${e.scoreAway}</strong>` : "";
      return `
      <tr class="${mine(`${e.teamHome} ${e.teamAway}`) ? "mine" : ""}">
        <td>${escapeHtml(shortDate(date))}</td>
        <td>${escapeHtml(displayTime(time))}</td>
        <td>${home}</td>
        <td>${middle}</td>
        <td>${away}${score}</td>
        <td>${escapeHtml(e.venue)}</td>
        <td><span class="badge ${statusClass}">${escapeHtml(e.status)}</span></td>
      </tr>`;
    })
    .join("");
}

function renderResults(completed) {
  const container = $("resultsContainer");
  if (!container) return;
  if (!completed.length) {
    container.innerHTML = "<p>No results yet.</p>";
    return;
  }
  completed = completed.filter((e) => !JUDGED.has(e.category));
  if (!completed.length) {
    container.innerHTML = "<p>No results yet.</p>";
    return;
  }
  container.innerHTML = completed
    .map(
      (e) => `
      <div class="result-card">
        <strong>${escapeHtml(e.teamHome || "TBD")} ${e.scoreHome ?? "-"} : ${e.scoreAway ?? "-"} ${escapeHtml(e.teamAway || "TBD")}</strong>
        <div>${escapeHtml(e.category)} — ${escapeHtml(e.venue)}</div>
      </div>`
    )
    .join("");
}

function renderToday(events) {
  const container = $("todayMatches");
  if (!container) return;
  const today = eat(new Date()).date;
  const todays = events.filter((e) => eat(e.startsAt).date === today);
  container.innerHTML = todays.length
    ? todays.map((e) => `<div class="${mine(`${e.teamHome} ${e.teamAway}`) ? "mine" : ""}">${escapeHtml(e.category)}: ${escapeHtml(stripSport(e.teamHome) || "TBD")}${e.teamAway ? ` vs ${escapeHtml(stripSport(e.teamAway))}` : ""} — ${formatDateTime(e.startsAt)}</div>`).join("")
    : "<p>No matches scheduled today.</p>";
}

function renderStandings(events) {
  const tbody = $("standingsTable");
  if (!tbody) return;
  const card = tbody.closest("section, .card");
  const judged = JUDGED.has(activeSport);
  // Dance / Folk Song have no points table: their heat rankings are in "Groups" above.
  if (card) card.style.display = judged ? "none" : "";
  if (judged) return;

  const groupFilter = $("groupFilter")?.value;
  // Server-side tables use the win/draw points set in Sports settings.
  const tables = groupTables.filter((g) => g.type === "table" && g.category === activeSport && (!groupFilter || groupFilter === "all" || g.group === groupFilter));
  const rows = tables.flatMap((g) => g.teams.map((t) => ({ ...t, group: g.group })));
  if (groupFilter === "all" || !groupFilter) rows.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));

  const played = rows.some((t) => t.played > 0);
  if (!rows.length || !played) {
    tbody.innerHTML = `<tr><td colspan="10">No completed ${escapeHtml(activeSport)} group matches yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (t, i) => `
      <tr class="${mine(t.team) ? "mine" : ""}">
        <td>${i + 1}</td>
        <td>${escapeHtml(stripSport(t.team))} <small>(Group ${escapeHtml(t.group)})</small></td>
        <td>${t.played}</td>
        <td>${t.won}</td>
        <td>${t.drawn}</td>
        <td>${t.lost}</td>
        <td>${t.gf}</td>
        <td>${t.ga}</td>
        <td>${t.gd}</td>
        <td><strong>${t.points}</strong></td>
      </tr>`
    )
    .join("");
}

function renderBracket(events) {
  const bySlot = {};
  for (const e of events) {
    if (e.bracketSlot && e.category === activeSport) bySlot[e.bracketSlot] = e;
  }
  const map = {
    sf1: "SF1", sf2: "SF2", final: "F", // the planner and /generate-bracket both name the final slot "F"
  };
  for (const [prefix, slot] of Object.entries(map)) {
    const e = bySlot[slot];
    setText(`${prefix}Home`, e?.teamHome ? `${e.teamHome}${e.scoreHome != null ? ` (${e.scoreHome})` : ""}` : "TBD");
    setText(`${prefix}Away`, e?.teamAway ? `${e.teamAway}${e.scoreAway != null ? ` (${e.scoreAway})` : ""}` : "TBD");
  }
  const final = bySlot.F;
  if (final?.status === "COMPLETED" && final.scoreHome != null && final.scoreAway != null) {
    const winner = final.scoreHome > final.scoreAway ? final.teamHome : final.scoreAway > final.scoreHome ? final.teamAway : null;
    setText("championName", winner || "Draw");
  } else {
    setText("championName", "To be decided");
  }
}

function renderDanceSchedule(events) {
  const tbody = $("danceScheduleTable");
  if (!tbody) return;
  const section = $("danceScheduleSection");
  const judged = JUDGED.has(activeSport);
  if (section) section.style.display = judged ? "" : "none"; // only on the Dance / Folk Song tabs
  if (!judged) return;
  const list = events.filter((e) => e.category === activeSport);
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">No ${escapeHtml(activeSport)} schedule published yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((e, i) => {
      const { date, time } = eat(e.startsAt);
      const round = e.round === "FINAL" ? "Grand Final" : e.group ? `Heat ${e.group}` : "";
      return `
      <tr class="${mine(e.teamHome) ? "mine" : ""}">
        <td>${i + 1}</td>
        <td>${escapeHtml(stripSport(e.teamHome) || "To be decided")}</td>
        <td>${escapeHtml(round)}</td>
        <td>${escapeHtml(e.venue)}</td>
        <td>${escapeHtml(shortDate(date))} · ${escapeHtml(displayTime(time))}</td>
        <td>${escapeHtml(e.status)}</td>
      </tr>`;
    })
    .join("");
}


/* ==========================================================
   EVENT TIMETABLE + GROUPS
   Fed by GET /sports/schedule (every fixture grouped by event day)
   and GET /sports/groups (group tables / dance heats). Rows for the
   participant's own parish are highlighted.
   ========================================================== */

async function loadTimetable() {
  if (!$("timetableSection")) return;
  try {
    const [{ days }, { groups }] = await Promise.all([apiFetch("/sports/schedule"), apiFetch("/sports/groups")]);
    timetableDays = days;
    if (!days.length) {
      renderGroups([]);
      return;
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    activeTimetableDay = (days.find((d) => d.date === todayKey) || days[0]).date;
    renderTimetableDays();
    renderTimetableList();
    renderGroups(groups);
  } catch (err) {
    showError(err.message || "Could not load the event timetable.");
  }
}

function renderTimetableDays() {
  const wrap = $("timetableDays");
  wrap.innerHTML = timetableDays
    .map((d) => `<button type="button" class="timetable-tab ${d.date === activeTimetableDay ? "active" : ""}" data-date="${escapeHtml(d.date)}">${escapeHtml(d.label)}</button>`)
    .join("");
  wrap.querySelectorAll(".timetable-tab").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeTimetableDay = btn.dataset.date;
      renderTimetableDays();
      renderTimetableList();
    })
  );
}

function mine(text) {
  const parish = (user?.Parish?.name || "").toLowerCase();
  return parish && (text || "").toLowerCase().includes(parish);
}

function renderTimetableList() {
  const day = timetableDays.find((d) => d.date === activeTimetableDay);
  const list = $("timetableList");
  if (!day) { list.innerHTML = "<p>No fixtures on this day.</p>"; return; }
  const roundTag = { GROUP: "Group", SEMI: "Semi-final", FINAL: "Final" };
  list.innerHTML = day.events
    .map((e) => {
      const who = e.teamAway ? `${e.teamHome || "TBD"} vs ${e.teamAway}` : e.teamHome || e.name;
      const score = e.status === "COMPLETED" && e.scoreHome !== null ? ` <strong>${e.scoreHome} - ${e.scoreAway}</strong>` : "";
      const tag = `${e.category}${e.round ? " · " + roundTag[e.round] : ""}${e.group ? " " + e.group : ""}`;
      return `<div class="timetable-row ${mine(`${e.teamHome} ${e.teamAway}`) ? "mine" : ""}">
        <span class="tt-time">${escapeHtml(displayTime(e.time))}</span>
        <span class="tt-main"><small>${escapeHtml(tag)}</small><br>${escapeHtml(who)}${score}</span>
        <span class="tt-venue">${escapeHtml(e.venue)}</span>
      </div>`;
    })
    .join("");
}

function renderGroups(groups) {
  const grid = $("groupsGrid");
  if (!groups.length) { grid.innerHTML = "<p>Groups will be announced soon.</p>"; return; }
  grid.innerHTML = groups
    .map((g) => {
      const rows =
        g.type === "heat"
          ? g.teams.map((t) => `<li class="${mine(t.team) ? "mine" : ""}">${escapeHtml(t.team)}${t.average !== null ? ` <small>${Number(t.average).toFixed(1)}</small>` : ""}</li>`).join("")
          : g.teams.map((t) => `<li class="${mine(t.team) ? "mine" : ""}">${escapeHtml(t.team)} <small>${t.played} P · ${t.points} pts</small></li>`).join("");
      return `<div class="group-card"><h5>${escapeHtml(g.category)} · ${g.type === "heat" ? "Heat" : "Group"} ${escapeHtml(g.group)}</h5><ol>${rows}</ol></div>`;
    })
    .join("");
}
