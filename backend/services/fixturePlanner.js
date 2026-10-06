// Y-Summit Season 4 2026 — fixture, group and day planner.
//
// Pure functions only (no database access) so the same logic can be
// previewed, unit-tested and then persisted by routes/sports.routes.js.
//
// What it builds
//   Football / Volleyball : games are played Tuesday to Friday ONLY. Parishes
//     are split into four groups (A-D) that play a round robin on Tue-Thu;
//     ONLY THE GROUP WINNERS go through to the semi-finals (SF1 = A v D,
//     SF2 = B v C) and the final, all on Friday. Bracket slot names (SF1,
//     SF2, F) match the ones the /generate-bracket route and PATCH /:id
//     winner-advancement already use.
//   Dance / Folk Song : judged competitions. Parishes are split into heats
//     (groups A, B, C, ...). Every team gets one timed performance slot in
//     its heat; the top two per heat (by judges' marks) qualify for a Grand
//     Final on the last day (slots DF1.. for Dance, FF1.. for Folk Song).
//
// Scheduling rules (applied to every fixture, across all categories)
//   - a venue hosts one fixture per time slot
//   - a parish is never in two places at once (football, volleyball and dance
//     teams from the same parish share a "parish key"), with a rest buffer
//   - a team plays at most `maxPerDay` group fixtures per day
//   - fixtures that already exist (other categories, manual fixtures) are
//     respected, so generating dance after football will not double-book
//
// All times are East Africa Time (UTC+03:00, no daylight saving).

const EAT_OFFSET = "+03:00";
const GROUP_LETTERS = "ABCDEFGH".split("");
const CROSS_CATEGORY_BUFFER_MIN = 30;

const CATEGORY_DEFAULTS = {
  // Football and Volleyball games are played from 3:00 pm (15:00) onwards.
  // Dance and Folk Song heats run in the mornings so a parish's performers
  // are not pulled between the stage and the pitch.
  Football: {
    durationMin: 60,
    restMin: 90,
    maxPerDay: 1,
    venues: ["Main Pitch", "Pitch B"],
    slots: ["15:00", "16:15", "17:30"],
    openingDayFrom: "15:00",
    semiSlots: ["15:00"], // Friday: both semi-finals together, one per pitch
    finalSlot: "17:30", // Friday: after the semi-finalists have rested
  },
  Volleyball: {
    durationMin: 45,
    restMin: 75,
    maxPerDay: 1,
    venues: ["Court 1", "Court 2"],
    slots: ["15:00", "16:00", "17:00"],
    openingDayFrom: "15:00",
    semiSlots: ["15:00"],
    finalSlot: "16:30",
  },
  Dance: {
    durationMin: 20,
    restMin: 30,
    maxPerDay: 1,
    venues: ["Main Stage"],
    slotStart: "10:00",
    slotCount: 12, // 10:00 - 13:40, one performance every 20 minutes (only used if timesTbc is false)
    finalStart: "16:00",
    finalPrefix: "DF",
    // The organisers will supply the dance timings, so the planner only fixes
    // the DAY and the running ORDER. Each performance gets a placeholder time
    // just after midnight (00:00, 00:01, ...) which every screen shows as
    // "TBA". Set the real time by editing the fixture in Sports > Fixtures.
    timesTbc: true,
  },
  "Folk Song": {
    durationMin: 15,
    restMin: 30,
    maxPerDay: 1,
    venues: ["Main Stage"],
    slotStart: "09:00",
    slotCount: 18, // 09:00 - 13:15, one item every 15 minutes
    heatDayIndexes: [1, 2], // Wed, Thu
    finalStart: "10:00",
    finalPrefix: "FF",
  },
};

// ---------- small helpers ----------

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function eatDate(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00${EAT_OFFSET}`);
}

/** Every calendar day from start to end inclusive, as YYYY-MM-DD. */
function dayRange(startStr, endStr) {
  const days = [];
  const cur = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/** "Kagaa Parish Football" -> "Kagaa Parish". Used to stop a parish being double-booked. */
function parishKey(teamName) {
  return (teamName || "").replace(/\s+(Football|Volleyball|Dance|Folk Song)\s*$/i, "").trim().toLowerCase();
}

/** Snake-seed teams into groups so strong/weak seeds are spread evenly. */
function buildGroups(teams, groupCount) {
  const groups = Array.from({ length: groupCount }, (_, i) => ({ letter: GROUP_LETTERS[i], teams: [] }));
  teams.forEach((team, i) => {
    const row = Math.floor(i / groupCount);
    const col = i % groupCount;
    const idx = row % 2 === 0 ? col : groupCount - 1 - col;
    groups[idx].teams.push(team);
  });
  return groups;
}

/** Circle-method round robin. Returns rounds: [[ [home, away], ... ], ...] (byes skipped). */
function roundRobin(teams) {
  const list = [...teams];
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()); // rotate everything except the first element
  }
  return rounds;
}

// ---------- availability tracking ----------

function createCalendar(existing = []) {
  const venueBusy = new Set(); // "venue|date|HH:MM"
  const parishIntervals = new Map(); // parishKey -> [{start, end}] (epoch minutes, buffer included)
  const perDayCount = new Map(); // "team|date" -> n

  const calendar = {
    venueFree(venue, date, time) {
      return !venueBusy.has(`${venue}|${date}|${time}`);
    },
    // Same-category fixtures need the full rest buffer; fixtures from a
    // different category (e.g. a parish's dance slot vs its football match)
    // only need a short travel/changeover buffer.
    parishFree(team, date, time, durationMin, bufferMin, category) {
      const key = parishKey(team);
      if (!key) return true;
      const start = toEpochMinutes(date, time);
      const end = start + durationMin;
      return !(parishIntervals.get(key) || []).some((iv) => {
        const buf = iv.category === category ? bufferMin : Math.min(bufferMin, CROSS_CATEGORY_BUFFER_MIN);
        return start < iv.end + buf && iv.start < end + buf;
      });
    },
    countOn(team, date) {
      return perDayCount.get(`${team}|${date}`) || 0;
    },
    book({ venue, date, time, teams, durationMin, countsTowardDayLimit, category }) {
      venueBusy.add(`${venue}|${date}|${time}`);
      const start = toEpochMinutes(date, time);
      for (const team of teams.filter(Boolean)) {
        const key = parishKey(team);
        if (!parishIntervals.has(key)) parishIntervals.set(key, []);
        parishIntervals.get(key).push({ start, end: start + durationMin, category });
        if (countsTowardDayLimit) perDayCount.set(`${team}|${date}`, (perDayCount.get(`${team}|${date}`) || 0) + 1);
      }
    },
  };

  for (const ev of existing) {
    const { date, time } = splitEat(ev.startsAt);
    if (isTimeTbc(time)) continue; // "time to be announced" placeholders occupy no real slot
    const dur = (CATEGORY_DEFAULTS[ev.category] || {}).durationMin || 60;
    calendar.book({
      venue: ev.venue,
      date,
      time,
      teams: [ev.teamHome, ev.teamAway],
      durationMin: dur,
      countsTowardDayLimit: false,
      category: ev.category,
    });
  }
  return calendar;
}

function toEpochMinutes(date, time) {
  return Math.floor(eatDate(date, time).getTime() / 60000);
}

/** Placeholder times (before 01:00 EAT) mean "time to be announced". */
const TBA_BEFORE = "01:00";
function isTimeTbc(hhmm) {
  return typeof hhmm === "string" && hhmm < TBA_BEFORE;
}

function splitEat(value) {
  const d = new Date(new Date(value).getTime() + 3 * 3600000); // shift to EAT, read as UTC
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// ---------- knockout seeding ----------

// [rank, group] pairs: rank 1 = group winner. Only winners progress.
const KNOCKOUT_SEEDS = {
  4: {
    SF1: [[1, "A"], [1, "D"]],
    SF2: [[1, "B"], [1, "C"]],
  },
};

const placeholder = ([, group]) => `Winner Group ${group}`;

const ROUND_LABEL = { SEMI: "Semi-Final", FINAL: "Final" };

// ---------- the planners ----------

function resolveDays(options) {
  const days = options.days && options.days.length ? options.days : dayRange(options.eventStart, options.eventEnd);
  if (days.length < 3) throw new Error("At least 3 event days are needed to plan groups, knockouts and a final.");
  return days;
}

/**
 * Football / Volleyball: four groups + round robin, group winners to the
 * semi-finals, final on the last game day. Games run Tuesday to Friday only
 * (the first four event days); the fifth day is left for the judged finals.
 * options: { category, teams[], days? | eventStart+eventEnd, gender?,
 *            durationMin?, venues?, slots?, maxPerDay?, existing? }
 */
function planGroupCompetition(options) {
  const category = options.category;
  const base = CATEGORY_DEFAULTS[category];
  if (!base || isJudgedCategory(category)) throw new Error(`planGroupCompetition does not support "${category}".`);

  const cfg = { ...base, category, ...pick(options, ["durationMin", "venues", "slots", "maxPerDay"]) };
  const teams = [...new Set(options.teams)];
  if (teams.length < 8) {
    throw new Error(`Need at least 8 ${category} teams to make four groups so the four group winners can play the semi-finals (found ${teams.length}).`);
  }
  const groupCount = 4;

  const allDays = resolveDays(options);
  const gameDays = allDays.slice(0, 4); // Tue-Fri only
  if (gameDays.length < 4) throw new Error("Football and Volleyball need four game days (Tuesday to Friday).");
  const groupDays = gameDays.slice(0, 3);
  const knockoutDay = gameDays[3];
  const gender = options.gender || "MIXED";

  const groups = buildGroups(teams, groupCount);
  const calendar = createCalendar(options.existing);
  const fixtures = [];

  // --- group stage: interleave groups round by round so teams get rest ---
  const perGroupRounds = groups.map((g) => roundRobin(g.teams));
  const maxRounds = Math.max(...perGroupRounds.map((r) => r.length));
  const queue = [];
  for (let r = 0; r < maxRounds; r++) {
    groups.forEach((g, gi) => {
      (perGroupRounds[gi][r] || []).forEach(([home, away]) => queue.push({ group: g.letter, home, away, matchday: r + 1 }));
    });
  }

  const unscheduled = [];
  for (const m of queue) {
    const slot = findGroupSlot({ calendar, cfg, groupDays, home: m.home, away: m.away, maxPerDay: cfg.maxPerDay })
      || findGroupSlot({ calendar, cfg, groupDays, home: m.home, away: m.away, maxPerDay: cfg.maxPerDay + 1 });
    if (!slot) { unscheduled.push(m); continue; }
    calendar.book({ venue: slot.venue, date: slot.date, time: slot.time, teams: [m.home, m.away], durationMin: cfg.durationMin, countsTowardDayLimit: true, category });
    fixtures.push({
      name: `${category} Group ${m.group} — ${m.home} vs ${m.away}`,
      category, gender, round: "GROUP", group: m.group, bracketSlot: null,
      teamHome: m.home, teamAway: m.away, venue: slot.venue,
      startsAt: eatDate(slot.date, slot.time), matchday: m.matchday,
    });
  }
  if (unscheduled.length) {
    throw new Error(
      `Could not fit ${unscheduled.length} group fixture(s) into Tuesday-Thursday. Add venues or time slots.`
    );
  }

  // --- Friday: semi-finals (group winners only) then the final ---
  const seeds = KNOCKOUT_SEEDS[groupCount];
  Object.keys(seeds).forEach((slot, i) => {
    fixtures.push(knockoutFixture({
      category, gender, round: "SEMI", slot,
      venue: cfg.venues[i % cfg.venues.length], date: knockoutDay,
      time: cfg.semiSlots[Math.floor(i / cfg.venues.length) % cfg.semiSlots.length], seeds: seeds[slot], cfg,
    }));
  });
  const finalFixture = knockoutFixture({ category, gender, round: "FINAL", slot: "F", venue: cfg.venues[0], date: knockoutDay, time: cfg.finalSlot, seeds: null, cfg });
  // Placeholders until the semi-finals finish; PATCH /:id then drops each winner in (SF1 -> home, SF2 -> away).
  finalFixture.teamHome = "Winner SF1";
  finalFixture.teamAway = "Winner SF2";
  fixtures.push(finalFixture);

  return { category, groupCount, groups: groups.map((g) => ({ group: g.letter, teams: g.teams })), fixtures, days: gameDays };
}

function knockoutFixture({ category, gender, round, slot, venue, date, time, seeds, cfg }) {
  return {
    name: `${category} ${ROUND_LABEL[round]} — ${slot}`,
    category, gender, round, group: null, bracketSlot: slot, venue,
    teamHome: seeds ? placeholder(seeds[0]) : null,
    teamAway: seeds ? placeholder(seeds[1]) : null,
    startsAt: eatDate(date, time),
    matchday: null,
  };
}

function findGroupSlot({ calendar, cfg, groupDays, home, away, maxPerDay }) {
  for (let d = 0; d < groupDays.length; d++) {
    const date = groupDays[d];
    if (calendar.countOn(home, date) >= maxPerDay || calendar.countOn(away, date) >= maxPerDay) continue;
    for (const time of cfg.slots) {
      if (d === 0 && cfg.openingDayFrom && toMinutes(time) < toMinutes(cfg.openingDayFrom)) continue;
      for (const venue of cfg.venues) {
        if (!calendar.venueFree(venue, date, time)) continue;
        if (!calendar.parishFree(home, date, time, cfg.durationMin, cfg.restMin, cfg.category)) continue;
        if (!calendar.parishFree(away, date, time, cfg.durationMin, cfg.restMin, cfg.category)) continue;
        return { date, time, venue };
      }
    }
  }
  return null;
}

/**
 * Dance / Folk Song: heats (groups) with timed performance slots + a Grand
 * Final skeleton on the last day.
 * options: { category?, teams[], groupCount?, days? | eventStart+eventEnd, heatDays?, existing? }
 */
function planJudged(options) {
  const category = options.category || "Dance";
  if (!isJudgedCategory(category)) throw new Error(`planJudged does not support "${category}".`);
  const cfg = { ...CATEGORY_DEFAULTS[category], category, ...pick(options, ["venues", "slotStart", "slotCount", "durationMin"]) };
  const teams = [...new Set(options.teams)];
  if (teams.length < 3) throw new Error(`Need at least 3 ${category} teams to make heats (found ${teams.length}).`);

  const groupCount = options.groupCount || (teams.length >= 9 ? 3 : 2);
  if (groupCount < 1 || groupCount > GROUP_LETTERS.length) throw new Error("Invalid heat count.");

  const days = resolveDays(options);
  // Default heats: the second and third day (Wed/Thu); the Grand Final is on the last day.
  const defaultHeatDays = cfg.heatDayIndexes
    ? cfg.heatDayIndexes.map((i) => days[i]).filter(Boolean)
    : days.slice(1, Math.max(2, days.length - 2));
  const heatDays = options.heatDays && options.heatDays.length ? options.heatDays : defaultHeatDays;
  const finalDay = days[days.length - 1];

  const groups = buildGroups(teams, groupCount);
  const calendar = createCalendar(options.existing);
  const fixtures = [];
  const venue = cfg.venues[0];
  const slotTimes = Array.from({ length: cfg.slotCount }, (_, i) => fromMinutes(toMinutes(cfg.slotStart) + i * cfg.durationMin));

  const tbcCounter = new Map(); // date -> placeholder minutes already used (keeps running order)
  const nextTbc = (date) => {
    const n = tbcCounter.get(date) || 0;
    tbcCounter.set(date, n + 1);
    return fromMinutes(n); // 00:00, 00:01, ... = "TBA, in this order"
  };

  groups.forEach((g, gi) => {
    const date = heatDays[Math.floor((gi * heatDays.length) / groups.length)];
    g.teams.forEach((team, order) => {
      if (cfg.timesTbc) {
        fixtures.push({
          name: `${category} Heat ${g.letter} — ${team}`,
          category, gender: "MIXED", round: "GROUP", group: g.letter, bracketSlot: null,
          teamHome: team, teamAway: null, venue, startsAt: eatDate(date, nextTbc(date)), matchday: order + 1,
        });
        return;
      }
      let i = 0; // first slot that is free for the venue AND this parish (earlier gaps get reused)
      while (i < slotTimes.length && !(calendar.venueFree(venue, date, slotTimes[i]) && calendar.parishFree(team, date, slotTimes[i], cfg.durationMin, cfg.restMin, category))) i++;
      if (i >= slotTimes.length) throw new Error(`No free performance slot left on ${date} for ${team}. Add another heat day.`);
      const time = slotTimes[i];
      calendar.book({ venue, date, time, teams: [team], durationMin: cfg.durationMin, countsTowardDayLimit: true, category });
      fixtures.push({
        name: `${category} Heat ${g.letter} — ${team}`,
        category, gender: "MIXED", round: "GROUP", group: g.letter, bracketSlot: null,
        teamHome: team, teamAway: null, venue, startsAt: eatDate(date, time), matchday: order + 1,
      });
    });
  });

  const finalists = Math.min(groups.length * 2, teams.length);
  for (let i = 0; i < finalists; i++) {
    const time = cfg.timesTbc ? nextTbc(finalDay) : fromMinutes(toMinutes(cfg.finalStart) + i * cfg.durationMin);
    fixtures.push({
      name: `${category} Grand Final — Performance ${i + 1}`,
      category, gender: "MIXED", round: "FINAL", group: null, bracketSlot: `${cfg.finalPrefix}${i + 1}`,
      teamHome: "Finalist (TBD)", teamAway: null, venue, startsAt: eatDate(finalDay, time), matchday: null,
    });
  }

  return { category, groupCount, groups: groups.map((g) => ({ group: g.letter, teams: g.teams })), fixtures, days };
}

function planDance(options) {
  return planJudged({ ...options, category: "Dance" });
}

function isJudgedCategory(category) {
  return category === "Dance" || category === "Folk Song";
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  return out;
}

module.exports = {
  CATEGORY_DEFAULTS,
  KNOCKOUT_SEEDS,
  EAT_OFFSET,
  planGroupCompetition,
  planJudged,
  planDance,
  isJudgedCategory,
  buildGroups,
  roundRobin,
  dayRange,
  splitEat,
  isTimeTbc,
  parishKey,
};
