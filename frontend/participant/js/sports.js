// Y-Summit Season 4 2026 — participant sports fixtures & results (read-only view)
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, showError, formatDateTime, displayTime, escapeHtml, setText, $ } from "../../assets/js/utils.js";

const user = await requireSession();
let allEvents = [];
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
      activeSport = btn.dataset.sport.charAt(0).toUpperCase() + btn.dataset.sport.slice(1);
      applyFilters();
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
      const start = new Date(e.startsAt);
      const dateStr = isNaN(start.getTime()) ? "-" : start.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
      const timeStr = isNaN(start.getTime()) ? "-" : start.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
      const statusClass = e.status === "COMPLETED" ? "badge-success" : e.status === "ONGOING" ? "badge-danger" : e.status === "CANCELLED" ? "badge-outline" : "badge-warning";
      return `
      <tr>
        <td>${dateStr}</td>
        <td>${timeStr}</td>
        <td>${escapeHtml(e.teamHome || "TBD")}</td>
        <td>VS</td>
        <td>${escapeHtml(e.teamAway || "TBD")}</td>
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
  const today = new Date().toDateString();
  const todays = events.filter((e) => new Date(e.startsAt).toDateString() === today);
  container.innerHTML = todays.length
    ? todays.map((e) => `<div>${escapeHtml(e.teamHome || "TBD")} vs ${escapeHtml(e.teamAway || "TBD")} — ${formatDateTime(e.startsAt)}</div>`).join("")
    : "<p>No matches scheduled today.</p>";
}

function renderStandings(events) {
  const tbody = $("standingsTable");
  if (!tbody) return;
  const groupFilter = $("groupFilter")?.value;

  const groupEvents = events.filter((e) => e.round === "GROUP" && e.status === "COMPLETED" && e.teamHome && e.teamAway);
  const relevant = groupFilter && groupFilter !== "all" ? groupEvents.filter((e) => e.group === groupFilter) : groupEvents;

  const table = new Map();
  const ensure = (name) => {
    if (!table.has(name)) table.set(name, { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    return table.get(name);
  };

  for (const e of relevant) {
    const home = ensure(e.teamHome);
    const away = ensure(e.teamAway);
    home.p++; away.p++;
    home.gf += e.scoreHome ?? 0; home.ga += e.scoreAway ?? 0;
    away.gf += e.scoreAway ?? 0; away.ga += e.scoreHome ?? 0;
    if ((e.scoreHome ?? 0) > (e.scoreAway ?? 0)) { home.w++; away.l++; }
    else if ((e.scoreHome ?? 0) < (e.scoreAway ?? 0)) { away.w++; home.l++; }
    else { home.d++; away.d++; }
  }

  const rows = [...table.values()]
    .map((t) => ({ ...t, gd: t.gf - t.ga, pts: t.w * 3 + t.d }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">No completed group-stage matches yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (t, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(t.team)}</td>
        <td>${t.p}</td>
        <td>${t.w}</td>
        <td>${t.d}</td>
        <td>${t.l}</td>
        <td>${t.gf}</td>
        <td>${t.ga}</td>
        <td>${t.gd}</td>
        <td><strong>${t.pts}</strong></td>
      </tr>`
    )
    .join("");
}

function renderBracket(events) {
  const bySlot = {};
  for (const e of events) {
    if (e.bracketSlot) bySlot[e.bracketSlot] = e;
  }
  const map = {
    sf1: "SF1", sf2: "SF2", final: "F", // the planner and /generate-bracket both name the final slot "F"
  };
  for (const [prefix, slot] of Object.entries(map)) {
    const e = bySlot[slot];
    setText(`${prefix}Home`, e?.teamHome ? `${e.teamHome}${e.scoreHome != null ? ` (${e.scoreHome})` : ""}` : "TBD");
    setText(`${prefix}Away`, e?.teamAway ? `${e.teamAway}${e.scoreAway != null ? ` (${e.scoreAway})` : ""}` : "TBD");
  }
  const final = bySlot.FINAL;
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
  const danceEvents = events.filter((e) => e.category === "Dance");
  if (!danceEvents.length) {
    tbody.innerHTML = `<tr><td colspan="5">No dance schedule published yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = danceEvents
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${formatDateTime(e.startsAt)}</td>
        <td>${escapeHtml(e.venue)}</td>
        <td>${escapeHtml(e.teamHome || "TBD")}</td>
        <td>${escapeHtml(e.status)}</td>
      </tr>`
    )
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
