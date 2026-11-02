// Y-Summit Season 4 2026 — participant programme (GYS 2026 timetable)
import { requireSession, wireLogoutButton } from "../../assets/js/auth.js";
import { apiFetch, setText, escapeHtml, displayTime, $ } from "../../assets/js/utils.js";
import { EVENT, DAYS } from "./programme-data.js";

/* ------------------------------------------------------------------ */
/* Type metadata + filters                                             */
/* ------------------------------------------------------------------ */

const TYPES = {
  devotion: { label: "Devotion", icon: "fa-hands-praying" },
  worship: { label: "Worship", icon: "fa-music" },
  revival: { label: "Revival", icon: "fa-fire" },
  teaching: { label: "Session", icon: "fa-book-bible" },
  ceremony: { label: "Ceremony", icon: "fa-bullhorn" },
  admin: { label: "Logistics", icon: "fa-clipboard-check" },
  sports: { label: "Sports", icon: "fa-futbol" },
  social: { label: "Social", icon: "fa-masks-theater" },
  meal: { label: "Meal", icon: "fa-utensils" },
  break: { label: "Break", icon: "fa-mug-hot" },
};

const FILTERS = [
  { id: "all", label: "All", icon: "fa-layer-group", types: null },
  { id: "sessions", label: "Sessions", icon: "fa-book-bible", types: ["teaching", "ceremony", "admin"] },
  { id: "worship", label: "Worship & Revival", icon: "fa-fire", types: ["devotion", "worship", "revival"] },
  { id: "fun", label: "Sports & Fun", icon: "fa-futbol", types: ["sports", "social"] },
  { id: "meals", label: "Meals & Breaks", icon: "fa-utensils", types: ["meal", "break"] },
];

const state = { dayId: 1, filter: "all" };
let scheduleByDate = new Map(); // "YYYY-MM-DD" -> fixtures from GET /sports/schedule
let myParish = "";

/* ------------------------------------------------------------------ */
/* Time helpers (all in the summit's own time zone, Nairobi)           */
/* ------------------------------------------------------------------ */

function nowInSummitTz() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT.tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date())
    .reduce((acc, p) => ((acc[p.type] = p.value), acc), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function fmtTime(hhmm) {
  let [h, m] = hhmm.split(":").map(Number);
  if (h === 24) h = 0;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtDuration(s, e) {
  const mins = toMin(e) - toMin(s);
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m} min`;
}

// Date strings are plain calendar dates; parse as UTC so no zone shift can occur.
const parseDate = (iso) => new Date(`${iso}T00:00:00Z`);
const fmtLong = (iso) =>
  parseDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = (iso) =>
  parseDate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayDiff = (a, b) => Math.round((parseDate(a) - parseDate(b)) / 86400000);

/** past | now | next | later — only meaningful on the summit's current day. */
function itemStates(day, now) {
  const result = day.items.map(() => "later");
  if (day.date !== now.date) {
    const past = day.date < now.date;
    return result.map(() => (past ? "past" : "later"));
  }
  let nextAssigned = false;
  day.items.forEach((it, i) => {
    const s = toMin(it.s);
    const e = toMin(it.e);
    if (now.minutes >= e && !(s === e && now.minutes < s)) result[i] = "past";
    else if (now.minutes >= s && now.minutes < e) result[i] = "now";
    else if (!nextAssigned && now.minutes < s) {
      result[i] = "next";
      nextAssigned = true;
    }
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function phoneLink(p) {
  const name = escapeHtml(p.n);
  const role = p.role ? ` <small>${escapeHtml(p.role)}</small>` : "";
  let phone = "";
  if (p.p) {
    const digits = p.p.replace(/\D/g, "");
    phone = p.bad
      ? `<span class="pg-phone pg-phone-plain" title="Number to be confirmed"><i class="fa-solid fa-phone"></i> ${escapeHtml(p.p)}</span>`
      : `<a class="pg-phone" href="tel:+254${digits.replace(/^0/, "")}"><i class="fa-solid fa-phone"></i> ${escapeHtml(p.p)}</a>`;
  }
  return `<li><span class="pg-person-name"><i class="fa-solid fa-user"></i> ${name}${role}</span>${phone}</li>`;
}

const peopleBlock = (who) =>
  who && who.length ? `<ul class="pg-people">${who.map(phoneLink).join("")}</ul>` : "";

function optionsBlock(it) {
  if (!it.options) return "";
  return `
    <div class="pg-options-label"><i class="fa-solid fa-signs-post"></i> ${escapeHtml(it.optionsLabel || "Options")}</div>
    <div class="pg-options">
      ${it.options
        .map(
          (o) => `
        <div class="pg-option">
          <span class="pg-option-tag">${escapeHtml(o.tag)}</span>
          <h4>${escapeHtml(o.t)}</h4>
          ${o.quote ? `<p class="pg-quote">${escapeHtml(o.quote)}</p>` : ""}
          ${o.pts ? `<ul class="pg-points">${o.pts.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
          ${peopleBlock(o.who)}
        </div>`
        )
        .join("")}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Live fixtures (from the Sports planner) inside the sports items     */
/* ------------------------------------------------------------------ */

const ROUND_TAG = { GROUP: "Group", SEMI: "Semi-final", FINAL: "Final" };
const stripSport = (t) => String(t || "").replace(/\s+(Football|Volleyball|Dance|Folk Song)\s*$/i, "");
const isMine = (text) => myParish && String(text || "").toLowerCase().includes(myParish);

function fixturesBlock(it, date) {
  if (!it.fixtures) return "";
  const list = (scheduleByDate.get(date) || []).filter((f) => it.fixtures.includes(f.category));
  if (!list.length) {
    return `<p class="pg-fixtures-empty"><i class="fa-regular fa-calendar"></i> ${escapeHtml(it.fixtures.join(" & "))} fixtures will appear here once they are published.</p>`;
  }
  const rows = list
    .map((f) => {
      const judged = !f.teamAway;
      const who = judged ? stripSport(f.teamHome) || "To be decided" : `${stripSport(f.teamHome) || "TBD"} vs ${stripSport(f.teamAway) || "TBD"}`;
      const tag = `${f.category} · ${f.round === "GROUP" && judged ? "Heat" : ROUND_TAG[f.round] || ""}${f.group ? " " + f.group : ""}${f.round === "FINAL" && judged ? " (Grand Final)" : ""}`.trim();
      const score = !judged && f.status === "COMPLETED" && f.scoreHome != null ? ` <strong>${f.scoreHome} – ${f.scoreAway}</strong>` : "";
      return `<li class="pg-fx ${isMine(`${f.teamHome} ${f.teamAway}`) ? "mine" : ""}">
        <span class="pg-fx-time">${escapeHtml(displayTime(f.time))}</span>
        <span class="pg-fx-main"><small>${escapeHtml(tag)}</small><br>${escapeHtml(who)}${score}</span>
        <span class="pg-fx-venue">${escapeHtml(f.venue || "")}</span>
      </li>`;
    })
    .join("");
  const mineCount = list.filter((f) => isMine(`${f.teamHome} ${f.teamAway}`)).length;
  return `<details class="pg-more pg-fixtures" open>
    <summary><i class="fa-solid fa-futbol"></i> ${list.length} fixture${list.length === 1 ? "" : "s"}${mineCount ? ` · <b>${mineCount} for your parish</b>` : ""}</summary>
    <ul class="pg-fx-list">${rows}</ul>
  </details>`;
}

async function loadFixtures() {
  try {
    const { days } = await apiFetch("/sports/schedule");
    scheduleByDate = new Map(days.map((d) => [d.date, d.events]));
    renderDay();
  } catch {
    /* the programme still works without the live fixtures */
  }
}

function itemCard(it, st, date) {
  const meta = TYPES[it.type] || TYPES.teaching;
  const compact = !it.obj && !it.options && !it.who && !it.sub && !it.ref && !it.team && !it.fixtures;
  const liveTag =
    st === "now"
      ? `<span class="pg-live"><span class="pg-pulse"></span> Happening now</span>`
      : st === "next"
        ? `<span class="pg-live pg-live-next"><i class="fa-regular fa-clock"></i> Up next</span>`
        : "";
  const isMoment = it.s === it.e;
  const dur = isMoment ? "" : fmtDuration(it.s, it.e);

  const scriptures = [
    it.ref ? `<span class="pg-chip"><i class="fa-solid fa-book-open"></i> ${escapeHtml(it.ref)}</span>` : "",
    it.support
      ? `<span class="pg-chip pg-chip-soft"><i class="fa-solid fa-bookmark"></i> Also: ${escapeHtml(it.support)}</span>`
      : "",
  ].join("");

  const objectives = it.obj
    ? `<details class="pg-more">
         <summary><i class="fa-solid fa-list-check"></i> ${it.obj.length} ${it.type === "revival" || it.type === "teaching" ? "objectives" : "key points"}</summary>
         <ul class="pg-points">${it.obj.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
         ${it.emphasis ? `<p class="pg-emphasis"><i class="fa-solid fa-star"></i> <strong>Key emphasis:</strong> ${escapeHtml(it.emphasis)}</p>` : ""}
       </details>`
    : "";

  return `
  <article class="pg-item pg-type-${it.type} ${st === "past" ? "is-past" : ""} ${st === "now" ? "is-now" : ""} ${compact ? "pg-compact" : ""}" data-type="${it.type}">
    <div class="pg-time">
      <strong>${fmtTime(it.s)}</strong>
      ${isMoment ? "" : `<span>${fmtTime(it.e)}</span>`}
      ${dur ? `<em>${dur}</em>` : ""}
    </div>
    <div class="pg-rail"><span class="pg-dot"><i class="fa-solid ${meta.icon}"></i></span></div>
    <div class="pg-card">
      <div class="pg-card-top">
        <span class="pg-badge"><i class="fa-solid ${meta.icon}"></i> ${meta.label}</span>
        ${liveTag}
      </div>
      <h3>${escapeHtml(it.t)}</h3>
      ${it.sub ? `<p class="pg-sub">${escapeHtml(it.sub)}</p>` : ""}
      ${scriptures ? `<div class="pg-chips">${scriptures}</div>` : ""}
      ${it.team ? `<p class="pg-team"><i class="fa-solid fa-people-group"></i> ${escapeHtml(it.team)}</p>` : ""}
      ${objectives}
      ${optionsBlock(it)}
      ${peopleBlock(it.who)}
      ${fixturesBlock(it, date)}
    </div>
  </article>`;
}

function renderDay() {
  const day = DAYS.find((d) => d.id === state.dayId) || DAYS[0];
  const now = nowInSummitTz();
  const states = itemStates(day, now);
  const filter = FILTERS.find((f) => f.id === state.filter) || FILTERS[0];

  const visible = day.items
    .map((it, i) => ({ it, st: states[i] }))
    .filter(({ it }) => !filter.types || filter.types.includes(it.type));

  const sessions = day.items.filter((i) => ["teaching", "revival", "ceremony"].includes(i.type)).length;
  const first = day.items[0];
  const last = day.items[day.items.length - 1];

  $("dayHeader").innerHTML = `
    <div class="pg-day-num"><small>Day</small><strong>${day.id}</strong></div>
    <div class="pg-day-info">
      <h2>${day.weekday}, ${fmtLong(day.date)}</h2>
      <p class="pg-day-theme">${escapeHtml(day.theme)}</p>
      <div class="pg-day-stats">
        <span><i class="fa-regular fa-clock"></i> ${fmtTime(first.s)} – ${fmtTime(last.e)}</span>
        <span><i class="fa-solid fa-calendar-check"></i> ${day.items.length} activities</span>
        ${sessions ? `<span><i class="fa-solid fa-book-bible"></i> ${sessions} main sessions</span>` : ""}
      </div>
    </div>
    ${day.banner ? `<div class="pg-day-banner"><i class="fa-solid ${day.banner.icon}"></i> ${escapeHtml(day.banner.text)}</div>` : ""}`;

  $("timeline").innerHTML = visible.length
    ? visible.map(({ it, st }) => itemCard(it, st, day.date)).join("")
    : `<div class="pg-empty"><i class="fa-regular fa-calendar-xmark"></i><p>Nothing in this category on Day ${day.id}.</p></div>`;
}

function renderTabs() {
  const now = nowInSummitTz();
  $("dayTabs").innerHTML = DAYS.map(
    (d) => `
    <button type="button" role="tab" class="pg-tab ${d.id === state.dayId ? "active" : ""} ${d.date === now.date ? "is-today" : ""}"
            data-day="${d.id}" aria-selected="${d.id === state.dayId}">
      <small>Day ${d.id}</small>
      <strong>${d.weekday.slice(0, 3)}</strong>
      <span>${fmtShort(d.date)}</span>
    </button>`
  ).join("");

  $("filterChips").innerHTML = FILTERS.map(
    (f) => `<button type="button" class="pg-filter ${f.id === state.filter ? "active" : ""}" data-filter="${f.id}">
      <i class="fa-solid ${f.icon}"></i> ${f.label}</button>`
  ).join("");
}

function renderHero() {
  const now = nowInSummitTz();
  const before = dayDiff(EVENT.start, now.date);
  const after = dayDiff(now.date, EVENT.end);
  let status;

  if (before > 0) {
    status = `<i class="fa-solid fa-hourglass-half"></i> Starts in <strong>${before}</strong> ${before === 1 ? "day" : "days"}`;
  } else if (after > 0) {
    status = `<i class="fa-solid fa-heart"></i> The summit has ended — thank you for being part of it`;
  } else {
    const day = DAYS.find((d) => d.date === now.date);
    const sts = day ? itemStates(day, now) : [];
    const cur = day ? day.items[sts.indexOf("now")] : null;
    const nxt = day ? day.items[sts.indexOf("next")] : null;
    status = cur
      ? `<span class="pg-pulse"></span> Now: <strong>${escapeHtml(cur.t)}</strong>`
      : nxt
        ? `<i class="fa-regular fa-clock"></i> Up next: <strong>${escapeHtml(nxt.t)}</strong> at ${fmtTime(nxt.s)}`
        : `<i class="fa-solid fa-moon"></i> That's a wrap for today`;
  }
  $("heroStatus").innerHTML = status;
  setText("heroDates", `${fmtShort(EVENT.start)} – ${fmtLong(EVENT.end)}`);
}

function init() {
  // Open on today's tab during the summit, otherwise on Day 1.
  const today = DAYS.find((d) => d.date === nowInSummitTz().date);
  if (today) state.dayId = today.id;

  renderHero();
  renderTabs();
  renderDay();

  $("dayTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    state.dayId = Number(btn.dataset.day);
    renderTabs();
    renderDay();
    $("dayHeader").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("filterChips").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderTabs();
    renderDay();
  });

  // Keep "now / up next" fresh while the page stays open during the summit.
  // Only re-render when something actually changed, so opened cards stay open.
  const signature = () => {
    const now = nowInSummitTz();
    const day = DAYS.find((d) => d.id === state.dayId);
    return now.date + "|" + itemStates(day, now).join(",");
  };
  let lastSig = signature();
  setInterval(() => {
    const sig = signature();
    if (sig === lastSig) return;
    lastSig = sig;
    renderHero();
    renderDay();
  }, 60000);
}

/* ------------------------------------------------------------------ */
/* Start (kept last so every helper above is initialised first)        */
/* ------------------------------------------------------------------ */

const user = await requireSession();
if (user) {
  wireLogoutButton();
  setText("participantName", user.fullName);
  setText("participantParish", user.Parish?.name || user.Church?.name || "—");
  const photo = $("participantPhoto");
  if (photo && user.avatarUrl) photo.src = user.avatarUrl;
  myParish = (user.Parish?.name || "").toLowerCase();
  init();
  loadFixtures();
}
