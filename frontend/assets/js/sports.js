// GY Summit 2026 — admin sports management
//
// SCOPE NOTE: sports.html's markup includes an extremely elaborate mockup
// (football/volleyball/dance tabs, knockout bracket generation, judge
// scoring forms, MVP/top-scorer leaderboards). The backend schema (and this
// file) covers the durable core that a tournament actually needs: creating
// fixtures, updating live scores/status, and listing results/standings.
// Bracket auto-generation and dance judging panels aren't backed by an API
// yet — those buttons are left as-is rather than faked with local state.
import { requireAdminSession, wireLogoutButton } from "./auth.js";
import { apiFetch, showError, showSuccess, formatDateTime, escapeHtml, $ } from "./utils.js";
import { loadPageSettings, wireSettingsForms, wireSettingsFileUploads } from "./settingsHelpers.js";

const SPORTS_FORMS = ["generalSportsForm", "footballRulesForm", "volleyballRulesForm", "danceCompetitionForm", "danceScoringForm"];

let parishes = [];
let currentTeam = null;
let currentMembers = [];

const admin = await requireAdminSession();
if (admin) {
  wireLogoutButton();
  await loadEvents();
  wireFixtureForm();
  await initTeamRosters();
  wireTabs();
  wireEditFixtureModal();
  await loadPageSettings(SPORTS_FORMS);
  wireSettingsForms();
  wireSettingsFileUploads();
}

function wireTabs() {
  document.querySelectorAll(".sports-tab[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sports-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".sports-section").forEach((s) => s.classList.remove("active-section"));
      const target = document.getElementById(`${btn.dataset.tab}Tab`);
      if (target) target.classList.add("active-section");
    });
  });
}

/* ==========================================================
   TEAM ROSTERS
   Teams are seeded one per parish per category (see
   backend/database/seed.js) and can only be fetched here —
   there is no "create team" endpoint, by design.
   ========================================================== */

async function initTeamRosters() {
  try {
    const { items } = await apiFetch("/structure/parishes");
    parishes = items;
    const parishSelect = $("parish");
    if (parishSelect) {
      parishSelect.innerHTML =
        '<option value="">Choose Parish</option>' +
        parishes.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    }
  } catch (err) {
    showError(err.message || "Could not load parishes.");
  }

  $("competitionType")?.addEventListener("change", loadSelectedTeam);
  $("parish")?.addEventListener("change", loadSelectedTeam);
  $("saveTeamMeta")?.addEventListener("click", saveTeamMeta);
  $("addPlayer")?.addEventListener("click", addPlayerToRoster);
  $("teamsOverviewFilter")?.addEventListener("change", (e) => loadTeamsOverview(e.target.value));
  $("awardCertificatesBtn")?.addEventListener("click", awardChampionCertificates);
  $("refreshParishes")?.addEventListener("click", loadParishesOverview);

  await loadTeamsOverview();
  await loadParishesOverview();
}

async function loadParishesOverview() {
  const tbody = $("parishesTable");
  if (!tbody) return;
  try {
    const { items } = await apiFetch("/structure/parishes/overview");
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="11">No parishes found.</td></tr>`;
      return;
    }
    tbody.innerHTML = items
      .map(
        (p) => `
        <tr data-id="${p.id}">
          <td>${escapeHtml(p.Presbytery?.name || "-")}</td>
          <td>
            <input type="text" class="parish-name-input" data-id="${p.id}" value="${escapeHtml(p.name)}" style="width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:8px;">
          </td>
          <td>${p.churchCount}</td>
          <td>${p.participantCount}</td>
          <td>${p.teamCount}</td>
          <td>${p.standing.played}</td>
          <td>${p.standing.won}</td>
          <td>${p.standing.drawn}</td>
          <td>${p.standing.lost}</td>
          <td><strong>${p.standing.points}</strong></td>
          <td><button class="btn btn-sm btn-primary" data-action="save-parish" data-id="${p.id}">Save</button></td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll('[data-action="save-parish"]').forEach((btn) =>
      btn.addEventListener("click", () => saveParishName(btn.dataset.id))
    );
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11">Could not load parishes.</td></tr>`;
    showError(err.message || "Could not load parishes.");
  }
}

async function saveParishName(id) {
  const input = document.querySelector(`.parish-name-input[data-id="${id}"]`);
  const name = input?.value.trim();
  if (!name) { showError("Parish name can't be empty."); return; }
  try {
    await apiFetch(`/structure/parishes/${id}`, { method: "PATCH", body: { name } });
    showSuccess("Parish updated — this now reflects in registration, profiles, and team names.");
    await loadParishesOverview();
    const parishSelect = $("parish");
    if (parishSelect) {
      const { items } = await apiFetch("/structure/parishes");
      const current = parishSelect.value;
      parishSelect.innerHTML =
        '<option value="">Choose Parish</option>' +
        items.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
      parishSelect.value = current;
    }
    await loadTeamsOverview($("teamsOverviewFilter")?.value);
  } catch (err) {
    showError(err.message || "Could not update this parish.");
  }
}

async function loadSelectedTeam() {
  const category = $("competitionType")?.value;
  const parishId = $("parish")?.value;
  const panel = $("teamRosterPanel");

  if (!category || !parishId) {
    if (panel) panel.style.display = "none";
    currentTeam = null;
    return;
  }

  try {
    const { teams } = await apiFetch(`/sports/teams?category=${encodeURIComponent(category)}&parishId=${parishId}`);
    const team = teams[0];
    if (!team) {
      showError("No team exists yet for this parish and competition — ask a super admin to seed it.");
      if (panel) panel.style.display = "none";
      currentTeam = null;
      return;
    }
    currentTeam = team;
    if (panel) panel.style.display = "";
    setText("rosterTeamName", team.name);
    setValue("coachName", team.coachName || "");
    setValue("chairpersonName", team.chairpersonName || "");
    setValue("chairpersonPhone", team.chairpersonPhone || "");
    await loadRoster();
    await loadPlayerPicker(parishId);
  } catch (err) {
    showError(err.message || "Could not load this team.");
  }
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function setValue(id, value) {
  const el = $(id);
  if (el) el.value = value;
}

async function loadRoster() {
  if (!currentTeam) return;
  try {
    const { members } = await apiFetch(`/sports/teams/${currentTeam.id}/members`);
    currentMembers = members;
    setText("rosterMemberCount", `${members.length} player${members.length === 1 ? "" : "s"}`);
    renderPlayersTable(members);
  } catch (err) {
    showError(err.message || "Could not load the roster.");
  }
}

function renderPlayersTable(members) {
  const tbody = $("playersTableBody");
  if (!tbody) return;

  if (!members.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No players added.</td></tr>`;
    return;
  }

  tbody.innerHTML = members
    .map(
      (m, i) => `
      <tr data-user="${m.user.id}">
        <td>${i + 1}</td>
        <td>${escapeHtml(m.user.fullName)}</td>
        <td>${escapeHtml(m.user.gender || "-")}</td>
        <td>${escapeHtml(m.position || "-")}</td>
        <td>${m.jerseyNumber ?? "-"}</td>
        <td><button class="btn btn-sm ${m.isCaptain ? "btn-primary" : "btn-outline"}" data-action="captain" data-user="${m.user.id}">${m.isCaptain ? "Captain" : "Make captain"}</button></td>
        <td><button class="btn btn-sm ${m.isEligible ? "btn-outline" : "btn-warning"}" data-action="eligible" data-user="${m.user.id}">${m.isEligible ? "Eligible" : "Ineligible"}</button></td>
        <td><button class="btn btn-sm btn-danger" data-action="remove" data-user="${m.user.id}"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll('[data-action="captain"]').forEach((btn) =>
    btn.addEventListener("click", () => toggleCaptain(btn.dataset.user))
  );
  tbody.querySelectorAll('[data-action="eligible"]').forEach((btn) =>
    btn.addEventListener("click", () => toggleEligible(btn.dataset.user))
  );
  tbody.querySelectorAll('[data-action="remove"]').forEach((btn) =>
    btn.addEventListener("click", () => removePlayer(btn.dataset.user))
  );
}

async function loadPlayerPicker(parishId) {
  const picker = $("playerPicker");
  if (!picker) return;
  try {
    const { items } = await apiFetch(`/admin/participants?parishId=${parishId}&pageSize=100`);
    const onTeam = new Set(currentMembers.map((m) => m.user.id));
    const available = items.filter((u) => !onTeam.has(u.id));
    picker.innerHTML =
      '<option value="">Select a participant…</option>' +
      available.map((u) => `<option value="${u.id}">${escapeHtml(u.fullName)}</option>`).join("");
  } catch (err) {
    showError(err.message || "Could not load participants for this parish.");
  }
}

async function saveTeamMeta() {
  if (!currentTeam) return;
  try {
    await apiFetch(`/sports/teams/${currentTeam.id}`, {
      method: "PATCH",
      body: {
        coachName: $("coachName")?.value || undefined,
        chairpersonName: $("chairpersonName")?.value || undefined,
        chairpersonPhone: $("chairpersonPhone")?.value || undefined,
      },
    });
    showSuccess("Team details saved.");
  } catch (err) {
    showError(err.message || "Could not save team details.");
  }
}

async function addPlayerToRoster() {
  if (!currentTeam) return;
  const userId = $("playerPicker")?.value;
  if (!userId) {
    showError("Choose a participant to add.");
    return;
  }
  const jersey = $("playerJersey")?.value;
  try {
    await apiFetch(`/sports/teams/${currentTeam.id}/members`, {
      method: "POST",
      body: {
        userId,
        position: $("playerPosition")?.value || undefined,
        jerseyNumber: jersey ? parseInt(jersey, 10) : undefined,
      },
    });
    showSuccess("Player added to the roster.");
    setValue("playerPosition", "");
    setValue("playerJersey", "");
    await loadRoster();
    await loadPlayerPicker($("parish")?.value);
    await loadTeamsOverview($("teamsOverviewFilter")?.value);
  } catch (err) {
    showError(err.message || "Could not add this player.");
  }
}

async function toggleCaptain(userId) {
  if (!currentTeam) return;
  const member = currentMembers.find((m) => m.user.id === userId);
  if (!member) return;
  try {
    const previousCaptain = currentMembers.find((m) => m.isCaptain && m.user.id !== userId);
    if (previousCaptain) {
      await apiFetch(`/sports/teams/${currentTeam.id}/members/${previousCaptain.user.id}`, {
        method: "PATCH",
        body: { isCaptain: false },
      });
    }
    await apiFetch(`/sports/teams/${currentTeam.id}/members/${userId}`, {
      method: "PATCH",
      body: { isCaptain: !member.isCaptain },
    });
    await loadRoster();
  } catch (err) {
    showError(err.message || "Could not update captain.");
  }
}

async function toggleEligible(userId) {
  if (!currentTeam) return;
  const member = currentMembers.find((m) => m.user.id === userId);
  if (!member) return;
  try {
    await apiFetch(`/sports/teams/${currentTeam.id}/members/${userId}`, {
      method: "PATCH",
      body: { isEligible: !member.isEligible },
    });
    await loadRoster();
  } catch (err) {
    showError(err.message || "Could not update eligibility.");
  }
}

async function removePlayer(userId) {
  if (!currentTeam) return;
  if (!confirm("Remove this player from the team?")) return;
  try {
    await apiFetch(`/sports/teams/${currentTeam.id}/members/${userId}`, { method: "DELETE" });
    showSuccess("Player removed.");
    await loadRoster();
    await loadPlayerPicker($("parish")?.value);
    await loadTeamsOverview($("teamsOverviewFilter")?.value);
  } catch (err) {
    showError(err.message || "Could not remove this player.");
  }
}

async function loadTeamsOverview(category) {
  const tbody = $("registeredTeamsTable");
  if (!tbody) return;
  try {
    const { teams } = await apiFetch(category ? `/sports/teams?category=${encodeURIComponent(category)}` : "/sports/teams");
    if (!teams.length) {
      tbody.innerHTML = `<tr><td colspan="6">No teams found.</td></tr>`;
      return;
    }

    const champions = await computeChampions();

    tbody.innerHTML = teams
      .map((t) => {
        const isChampion = champions[t.category] === t.name;
        return `
        <tr${isChampion ? ' style="background:#fff8e6;"' : ""}>
          <td>${escapeHtml(t.category)}</td>
          <td>${escapeHtml(t.Parish?.name || "-")}</td>
          <td>${escapeHtml(t.name)}</td>
          <td>${t.memberCount}</td>
          <td>${isChampion ? '<span class="status success"><i class="fa-solid fa-trophy"></i> Champion</span>' : "-"}</td>
          <td><button class="btn btn-sm btn-outline" data-action="open" data-category="${escapeHtml(t.category)}" data-parish="${t.parishId}">Open roster</button></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll('[data-action="open"]').forEach((btn) =>
      btn.addEventListener("click", () => {
        setValue("competitionType", btn.dataset.category);
        setValue("parish", btn.dataset.parish);
        loadSelectedTeam();
        $("teamRosterPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      })
    );

    const summary = $("championsSummary");
    if (summary) {
      const entries = Object.entries(champions);
      summary.innerHTML = entries.length
        ? entries.map(([cat, team]) => `<span class="status success"><i class="fa-solid fa-trophy"></i> ${escapeHtml(cat)}: ${escapeHtml(team)}</span>`).join(" ")
        : '<span style="color:#888;">No champions decided yet — play group-stage or final fixtures to see standings here.</span>';
    }
  } catch (err) {
    showError(err.message || "Could not load teams.");
  }
}

// Mirrors the exact winner-determination logic the backend uses for
// certificate generation (bracket FINAL result, falling back to
// group-stage points leader), so the badge shown here always matches who
// actually gets awarded a certificate — one real, connected source of truth.
async function computeChampions() {
  try {
    const { events } = await apiFetch("/sports");
    const champions = {};
    for (const category of ["Football", "Volleyball", "Dance"]) {
      const categoryEvents = events.filter((e) => e.category === category);
      const final = categoryEvents.find((e) => e.bracketSlot === "FINAL" && e.status === "COMPLETED");
      if (final && final.scoreHome != null && final.scoreAway != null && final.scoreHome !== final.scoreAway) {
        champions[category] = final.scoreHome > final.scoreAway ? final.teamHome : final.teamAway;
        continue;
      }
      const groupResults = categoryEvents.filter((e) => e.round === "GROUP" && e.status === "COMPLETED" && e.teamHome && e.teamAway);
      const table = new Map();
      const ensure = (name) => {
        if (!table.has(name)) table.set(name, 0);
        return name;
      };
      for (const e of groupResults) {
        ensure(e.teamHome);
        ensure(e.teamAway);
        if (e.scoreHome > e.scoreAway) table.set(e.teamHome, table.get(e.teamHome) + 3);
        else if (e.scoreAway > e.scoreHome) table.set(e.teamAway, table.get(e.teamAway) + 3);
        else { table.set(e.teamHome, table.get(e.teamHome) + 1); table.set(e.teamAway, table.get(e.teamAway) + 1); }
      }
      if (table.size) {
        const ranked = [...table.entries()].sort((a, b) => b[1] - a[1]);
        champions[category] = ranked[0][0];
      }
    }
    return champions;
  } catch {
    return {};
  }
}

async function awardChampionCertificates() {
  const btn = $("awardCertificatesBtn");
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Awarding…'; }
  try {
    const result = await apiFetch("/certificates/generate", { method: "POST", body: { type: "SPORTS_WINNER" } });
    showSuccess(
      result.teamsAwarded
        ? `${result.issued} new certificate(s) issued to members of ${result.teamsAwarded} winning team(s).`
        : "No completed fixtures yet — nothing to award."
    );
  } catch (err) {
    showError(err.message || "Could not award certificates.");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

let allEventsCache = [];

async function loadEvents(category) {
  try {
    const { events } = await apiFetch(category ? `/sports?category=${encodeURIComponent(category)}` : "/sports");
    allEventsCache = events;
    renderFixturesTable(events);
    renderStandings(events);
  } catch (err) {
    showError(err.message || "Could not load sports events.");
  }
}

function renderFixturesTable(events) {
  // masterTimeline is the real Fixtures-tab table (Time | Competition |
  // Fixture | Venue | Official | Status | Actions). The football/volleyball/
  // dance tab tables are part of the documented out-of-scope mockup — only
  // fall back to them if masterTimeline genuinely isn't on the page.
  const table = $("masterTimeline") || $("fixturesTable") || $("footballFixturesTable") || $("volleyballFixturesTable") || $("danceScheduleTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="7">No fixtures scheduled yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = events
    .map(
      (e) => `
      <tr data-id="${e.id}">
        <td>${formatDateTime(e.startsAt)}</td>
        <td>${escapeHtml(e.category)}</td>
        <td>${escapeHtml(e.teamHome || "TBD")} vs ${escapeHtml(e.teamAway || "TBD")}</td>
        <td>${escapeHtml(e.venue)}</td>
        <td>${e.scoreHome ?? "-"} : ${e.scoreAway ?? "-"}</td>
        <td>${escapeHtml(e.status)}</td>
        <td>
          <button class="btn btn-sm btn-outline" data-action="edit" data-id="${e.id}">Edit</button>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) =>
    btn.addEventListener("click", () => openEditFixtureModal(events.find((e) => e.id === btn.dataset.id)))
  );
}

function renderStandings(events) {
  const table = $("standingsTable") || $("footballStandingsTable") || $("volleyballStandingsTable");
  if (!table) return;
  const tbody = table.tagName === "TABLE" ? table.querySelector("tbody") || table : table;

  const teams = new Map();
  for (const e of events.filter((e) => e.status === "COMPLETED")) {
    for (const [team, scored, conceded] of [
      [e.teamHome, e.scoreHome, e.scoreAway],
      [e.teamAway, e.scoreAway, e.scoreHome],
    ]) {
      if (!team) continue;
      const row = teams.get(team) || { team, played: 0, points: 0, scored: 0, conceded: 0 };
      row.played += 1;
      row.scored += scored ?? 0;
      row.conceded += conceded ?? 0;
      if (scored > conceded) row.points += 3;
      else if (scored === conceded) row.points += 1;
      teams.set(team, row);
    }
  }

  const ranked = [...teams.values()].sort((a, b) => b.points - a.points || b.scored - b.conceded - (a.scored - a.conceded));
  tbody.innerHTML = ranked
    .map(
      (r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.team)}</td><td>${r.played}</td><td>${r.points}</td><td>${r.scored - r.conceded}</td></tr>`
    )
    .join("");
}

/* ==========================================================
   EDIT FIXTURE MODAL
   ========================================================== */

let editingFixtureId = null;

async function openEditFixtureModal(event) {
  if (!event) return;
  editingFixtureId = event.id;

  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  try {
    const { teams } = await apiFetch(`/sports/teams?category=${encodeURIComponent(event.category)}`);
    const options = teams.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
    const home = $("editFixtureHome");
    const away = $("editFixtureAway");
    if (home) home.innerHTML = `<option value="">Select home team</option>${options}`;
    if (away) away.innerHTML = `<option value="">Select away team</option>${options}`;
  } catch {
    showError("Could not load teams for this competition.");
  }

  setValue("editFixtureHome", event.teamHome || "");
  setValue("editFixtureAway", event.teamAway || "");
  const start = event.startsAt ? new Date(event.startsAt) : null;
  setValue("editFixtureDate", start ? start.toISOString().slice(0, 10) : "");
  setValue("editFixtureTime", start ? start.toTimeString().slice(0, 5) : "");
  setValue("editFixtureVenue", event.venue || "");
  setValue("editFixtureGender", event.gender || "MIXED");
  setValue("editFixtureRound", event.round || "");
  setValue("editFixtureGroup", event.group || "");
  setValue("editFixtureBracketSlot", event.bracketSlot || "");
  setValue("editFixtureStatus", event.status || "SCHEDULED");
  setValue("editFixtureScoreHome", event.scoreHome ?? "");
  setValue("editFixtureScoreAway", event.scoreAway ?? "");
  toggleEditRoundFields();

  $("editFixtureModal")?.classList.remove("hidden");
}

function closeEditFixtureModal() {
  $("editFixtureModal")?.classList.add("hidden");
  editingFixtureId = null;
}

function toggleEditRoundFields() {
  const round = $("editFixtureRound")?.value;
  const groupWrap = $("editFixtureGroupWrap");
  const bracketWrap = $("editFixtureBracketWrap");
  if (groupWrap) groupWrap.style.display = round === "GROUP" ? "" : "none";
  if (bracketWrap) bracketWrap.style.display = ["QUARTER", "SEMI", "FINAL"].includes(round) ? "" : "none";
}

function wireEditFixtureModal() {
  $("editFixtureRound")?.addEventListener("change", toggleEditRoundFields);
  $("cancelEditFixture")?.addEventListener("click", closeEditFixtureModal);
  $("editFixtureModal")?.addEventListener("click", (e) => {
    if (e.target.id === "editFixtureModal") closeEditFixtureModal();
  });

  $("saveEditFixture")?.addEventListener("click", async () => {
    if (!editingFixtureId) return;
    const round = $("editFixtureRound")?.value || undefined;
    const home = $("editFixtureHome")?.value;
    const away = $("editFixtureAway")?.value;
    const scoreHomeVal = $("editFixtureScoreHome")?.value;
    const scoreAwayVal = $("editFixtureScoreAway")?.value;
    const date = $("editFixtureDate")?.value;
    const time = $("editFixtureTime")?.value || "09:00";

    try {
      await apiFetch(`/sports/${editingFixtureId}`, {
        method: "PATCH",
        body: {
          teamHome: home || undefined,
          teamAway: away || undefined,
          venue: $("editFixtureVenue")?.value || undefined,
          gender: $("editFixtureGender")?.value || undefined,
          startsAt: date ? new Date(`${date}T${time}`).toISOString() : undefined,
          round,
          group: round === "GROUP" ? $("editFixtureGroup")?.value || undefined : undefined,
          bracketSlot: ["QUARTER", "SEMI", "FINAL"].includes(round) ? $("editFixtureBracketSlot")?.value || undefined : undefined,
          status: $("editFixtureStatus")?.value || undefined,
          scoreHome: scoreHomeVal === "" ? undefined : parseInt(scoreHomeVal, 10),
          scoreAway: scoreAwayVal === "" ? undefined : parseInt(scoreAwayVal, 10),
        },
      });
      showSuccess("Fixture updated.");
      closeEditFixtureModal();
      await loadEvents();
      await loadTeamsOverview($("teamsOverviewFilter")?.value);
    } catch (err) {
      showError(err.message || "Could not update fixture.");
    }
  });

  $("deleteFixtureBtn")?.addEventListener("click", async () => {
    if (!editingFixtureId) return;
    if (!confirm("Delete this fixture? This can't be undone.")) return;
    try {
      await apiFetch(`/sports/${editingFixtureId}`, { method: "DELETE" });
      showSuccess("Fixture deleted.");
      closeEditFixtureModal();
      await loadEvents();
    } catch (err) {
      showError(err.message || "Could not delete fixture.");
    }
  });
}

function wireFixtureForm() {
  const categorySelect = $("fixtureCompetition");
  const roundSelect = $("fixtureRound");

  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  async function populateTeamSelects() {
    const category = capitalize(categorySelect?.value);
    if (!category) return;
    try {
      const { teams } = await apiFetch(`/sports/teams?category=${encodeURIComponent(category)}`);
      const options = teams.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
      const home = $("fixtureHome");
      const away = $("fixtureAway");
      if (home) home.innerHTML = `<option value="">Select home team</option>${options}`;
      if (away) away.innerHTML = `<option value="">Select away team</option>${options}`;
    } catch (err) {
      showError(err.message || "Could not load teams for this competition.");
    }
  }

  function toggleRoundFields() {
    const round = roundSelect?.value;
    const groupWrap = $("fixtureGroupWrap");
    const bracketWrap = $("fixtureBracketSlotWrap");
    if (groupWrap) groupWrap.style.display = round === "GROUP" ? "" : "none";
    if (bracketWrap) bracketWrap.style.display = ["QUARTER", "SEMI", "FINAL"].includes(round) ? "" : "none";
  }

  categorySelect?.addEventListener("change", populateTeamSelects);
  roundSelect?.addEventListener("change", toggleRoundFields);
  populateTeamSelects();
  toggleRoundFields();

  $("fixtureForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const home = $("fixtureHome")?.value;
    const away = $("fixtureAway")?.value;
    const round = roundSelect?.value || undefined;
    try {
      await apiFetch("/sports", {
        method: "POST",
        body: {
          name: home && away ? `${home} vs ${away}` : capitalize(categorySelect?.value) || "Fixture",
          category: capitalize(categorySelect?.value) || "Football",
          gender: $("fixtureGender")?.value || "MIXED",
          venue: $("fixtureVenue")?.value || "TBD",
          startsAt: new Date(`${$("fixtureDate")?.value}T${$("fixtureTime")?.value || "09:00"}`).toISOString(),
          teamHome: home || undefined,
          teamAway: away || undefined,
          round,
          group: round === "GROUP" ? $("fixtureGroup")?.value || undefined : undefined,
          bracketSlot: ["QUARTER", "SEMI", "FINAL"].includes(round) ? $("fixtureBracketSlot")?.value || undefined : undefined,
        },
      });
      showSuccess("Fixture created.");
      e.target.reset();
      toggleRoundFields();
      await loadEvents();
      await loadTeamsOverview($("teamsOverviewFilter")?.value);
    } catch (err) {
      showError(err.message || "Could not create fixture.");
    }
  });
}
