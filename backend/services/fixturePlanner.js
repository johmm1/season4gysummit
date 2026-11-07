// Y-Summit Season 4 2026 — fixture, group and day planner.
//
// Pure functions only (no database access) so the same logic can be
// previewed, unit-tested and then persisted by routes/sports.routes.js.
//
// What it builds
//   Football / Volleyball : games are played Tuesday to Friday ONLY, inside
//     the "Games" windows of the official programme (Tue 14:00-18:00,
//     Wed 15:30-18:00, Thu 15:30-17:30, Fri finals 14:00-16:30). Parishes are
//     split into four groups (A-D) that play a round robin on Tue-Thu; ONLY
//     THE GROUP WINNERS go through to the semi-finals (SF1 = A v D,
//     SF2 = B v C) and the final, all on Friday. Bracket slot names (SF1,
//     SF2, F) match the ones the /generate-bracket route and PATCH /:id
//     winner-advancement already use.
//   Dance / Folk Song : judged competitions, BOTH held on Friday evening
//     (Talent Show Night). Parishes are split into heats (groups A, B, C, ...).
//     Every team gets one performance in its heat; the top two per heat (by the
//     AVERAGE of all judges' marks) qualify for a Grand Final the same evening
//     (slots DF1.. for Dance, FF1.. for Folk Song). Folk Song runs first, then
//     Dance; exact times are set by the organisers (shown as "TBA", running
//     order kept).

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
const CROSS_CATEGORY_BUFFER_MIN = 15; // a parish moving between its football pitch, volleyball court and stage

// We have ONE football pitch and ONE volleyball court, so games are kept short
// enough to fit the programme windows (see windows below).
const FB_MIN = 35;
const VB_MIN = 30;

const CATEGORY_DEFAULTS = {
  // Football and Volleyball follow the "Games" windows of the programme
  // (frontend/participant/js/programme-data.js). windows[0] = Tuesday,
  // [1] = Wednesday, [2] = Thursday. A game may start on any `stepMin` boundary
  // inside its day's window as long as it also FINISHES inside the window, and
  // a venue hosts one game at a time.
  //   Tue 14:00-18:00 · Wed 15:30-18:00 · Thu 15:30-17:30 · Fri finals 14:00-16:30
  Football: {
    durationMin: FB_MIN,
    restMin: 90,
    maxPerDay: 1,
    venues: ["Main Pitch"], // one football pitch
    stepMin: 15,
    windows: [
      { start: "14:00", end: "18:00" },
      { start: "15:30", end: "18:00" },
      { start: "15:30", end: "17:30" },
    ],
    knockout: { start: "14:00", end: "16:30" }, // Friday "Games Finals": SF1, SF2, then the final, one after another
  },
  Volleyball: {
    durationMin: VB_MIN,
    restMin: 75,
    maxPerDay: 1,
    venues: ["Court 1"], // one volleyball court
    stepMin: 15,
    windows: [
      { start: "14:00", end: "18:00" },
      { start: "15:30", end: "18:00" },
      { start: "15:30", end: "17:30" },
    ],
    knockout: { start: "14:00", end: "16:30" },
  },
  // Dance and Folk Song are both on FRIDAY EVENING (programme: Talent Show
  // Night, 19:00 onwards). The organisers supply the running times, so the
  // planner fixes the DAY and the running ORDER only: each performance gets a
  // placeholder time just after midnight (00:00, 00:01, ...) which every
  // screen shows as "TBA". Folk Song takes placeholders 00:00-00:29 and Dance
  // 00:30-00:59 so the two competitions keep their order on the evening
  // (Folk Song first, then Dance). Set the real time by editing the fixture in
  // Sports > Fixtures.
  Dance: {
    durationMin: 20,
    restMin: 30,
    maxPerDay: 1,
    venues: ["Main Stage"],
    slotStart: "20:00", // only used if timesTbc is false
    slotCount: 12,
    finalStart: "22:30",
    finalPrefix: "DF",
    timesTbc: true,
    tbcStartMinute: 30,
  },
  "Folk Song": {
    durationMin: 15,
    restMin: 30,
    maxPerDay: 1,
    venues: ["Main Stage"],
    slotStart: "19:00", // only used if timesTbc is false
    slotCount: 12,
    finalStart: "21:30",
    finalPrefix: "FF",
    timesTbc: true,
    tbcStartMinute: 0,
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

const WEEKDAY = { 0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday" };
function weekdayOf(dateStr) {
  return WEEKDAY[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

/**
 * The four game days: Tuesday, Wednesday, Thursday, Friday. Picked by real
 * weekday so a wrong event date in Settings cannot push games onto a
 * Saturday; if the range holds no Tue-Fri run, the first four days are used.
 */
function pickGameDays(allDays) {
  const wanted = ["Tuesday", "Wednesday", "Thursday", "Friday"];
  const picked = wanted.map((w) => allDays.find((d) => weekdayOf(d) === w));
  return picked.every(Boolean) ? picked : allDays.slice(0, 4);
}

/** Friday (the evening of Folk Song and Dance); falls back to the 4th event day. */
function pickFriday(allDays) {
  return allDays.find((d) => weekdayOf(d) === "Friday") || allDays[Math.min(3, allDays.length - 1)];
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
  const venueBusy = new Map(); // "venue|date" -> [{start, end}] (epoch minutes)
  const parishIntervals = new Map(); // parishKey -> [{start, end}] (epoch minutes, buffer included)
  const perDayCount = new Map(); // "team|date" -> n

  const calendar = {
    venueFree(venue, date, time, durationMin = 1) {
      const start = toEpochMinutes(date, time);
      const end = start + durationMin;
      return !(venueBusy.get(`${venue}|${date}`) || []).some((iv) => start < iv.end && iv.start < end);
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
      const start = toEpochMinutes(date, time);
      const vKey = `${venue}|${date}`;
      if (!venueBusy.has(vKey)) venueBusy.set(vKey, []);
      venueBusy.get(vKey).push({ start, end: start + durationMin });
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

/**
 * Eleven-church football cup: Pool A has six teams (three opening ties);
 * Pool B has five (two ties, then the fifth team plays the best loser).
 * Three pool winners per pool meet cross-pool; three winners + best loser
 * qualify for two semi-finals, followed by third place and the final.
 */
function planElevenChurchCup(options) {
  const teams = [...new Set(options.teams || [])];
  if (teams.length !== 11) throw new Error(`The 11-church cup requires exactly 11 football teams (found ${teams.length}).`);
  const days = pickGameDays(resolveDays(options));
  if (days.length < 4) throw new Error("The 11-church cup needs Tuesday, Wednesday, Thursday and Friday event days.");
  const [tue, wed, thu, fri] = days;
  const poolA = teams.slice(0, 6);
  const poolB = teams.slice(6, 11);
  const venue = (options.venues && options.venues[0]) || "Main Pitch";
  const duration = options.durationMin || FB_MIN;
  const gender = options.gender || "MIXED";
  const fixtures = [];
  const add = (slot, round, date, time, home, away, group, name) => fixtures.push({
    name: name || `Football ${slot}`, category: "Football", gender, round,
    group: group || null, bracketSlot: slot, teamHome: home || null, teamAway: away || null,
    venue, startsAt: eatDate(date, time), matchday: null,
  });
  poolA.forEach((team, i) => { if (i % 2 === 0) add(`PA${i/2+1}`, "GROUP", tue, ["14:00","15:00","16:00"][i/2], team, poolA[i+1], "A", `Pool A — ${team} vs ${poolA[i+1]}`); });
  add("PB1","GROUP",tue,"17:00",poolB[0],poolB[1],"B",`Pool B — ${poolB[0]} vs ${poolB[1]}`);
  add("PB2","GROUP",tue,"17:45",poolB[2],poolB[3],"B",`Pool B — ${poolB[2]} vs ${poolB[3]}`);
  add("PB3","GROUP",wed,"15:30",poolB[4],"Best Loser","B",`Pool B — ${poolB[4]} vs Best Loser`);
  for(let i=1;i<=3;i++) add(`CP${i}`,"QUARTER",wed,["16:15","17:00","17:45"][i-1],`Pool A Winner ${i}`,`Pool B Winner ${i}`,null,`Cross-Pool Match ${i}`);
  add("SF1","SEMI",thu,"15:30","Winner Cross Match 1","Winner Cross Match 2",null,"Semi-Final I");
  add("SF2","SEMI",thu,"16:30","Winner Cross Match 3","Best Loser",null,"Semi-Final II");
  add("THIRD","FINAL",fri,"14:00","Loser Semi-Final I","Loser Semi-Final II",null,"Third-Place Match");
  add("F","FINAL",fri,"15:15","Winner Semi-Final I","Winner Semi-Final II",null,"Final");
  return {
    category:"Football", groupCount:2,
    groups:[{group:"A",teams:poolA},{group:"B",teams:poolB}],
    fixtures, days,
  };
}



function resolveDays(options) {
  const days = options.days && options.days.length ? options.days : dayRange(options.eventStart, options.eventEnd);
  if (days.length < 3) throw new Error("At least 3 event days are needed to plan groups, knockouts and a final.");
  return days;
}

/**
 * Football / Volleyball: four groups + round robin, group winners to the
 * semi-finals, final on Friday. Games run Tuesday to Friday only
 * (picked by weekday); Dance and Folk Song are on the Friday evening.
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
  const gameDays = pickGameDays(allDays); // Tue-Fri only
  if (gameDays.length < 4) throw new Error("Football and Volleyball need four game days (Tuesday to Friday).");
  const groupDays = gameDays.slice(0, 3);
  const knockoutDay = gameDays[3];
  const gender = options.gender || "MIXED";

  const groups = buildGroups(teams, groupCount);
  // --- group stage: interleave groups round by round so teams get rest ---
  const perGroupRounds = groups.map((g) => roundRobin(g.teams));
  const maxRounds = Math.max(...perGroupRounds.map((r) => r.length));
  const queue = [];
  for (let r = 0; r < maxRounds; r++) {
    groups.forEach((g, gi) => {
      (perGroupRounds[gi][r] || []).forEach(([home, away]) => queue.push({ group: g.letter, home, away, matchday: r + 1 }));
    });
  }

  // Football and Volleyball share parishes and the same Tue-Thu windows, so a
  // plain first-fit pass can paint itself into a corner (a parish's last game
  // has no free window left). Try the natural order first; if anything is left
  // over, retry with other day preferences and queue orders and keep the first
  // plan that fits every game.
  const attempt = (dayOrder, order) => {
    const calendar = createCalendar(options.existing);
    const placed = [];
    const left = [];
    for (const m of order) {
      const slot = findGroupSlot({ calendar, cfg, groupDays, dayOrder, home: m.home, away: m.away, maxPerDay: cfg.maxPerDay })
        || findGroupSlot({ calendar, cfg, groupDays, dayOrder, home: m.home, away: m.away, maxPerDay: cfg.maxPerDay + 1 });
      if (!slot) { left.push(m); continue; }
      calendar.book({ venue: slot.venue, date: slot.date, time: slot.time, teams: [m.home, m.away], durationMin: cfg.durationMin, countsTowardDayLimit: true, category });
      placed.push({
        name: `${category} Group ${m.group} — ${m.home} vs ${m.away}`,
        category, gender, round: "GROUP", group: m.group, bracketSlot: null,
        teamHome: m.home, teamAway: m.away, venue: slot.venue,
        startsAt: eatDate(slot.date, slot.time), matchday: m.matchday,
      });
    }
    return { placed, left };
  };

  const dayOrders = [[0, 1, 2], [2, 1, 0], [1, 2, 0], [0, 2, 1], [1, 0, 2], [2, 0, 1]].map((o) => o.filter((i) => i < groupDays.length));
  const queueOrders = [queue, [...queue].reverse(), ...[3, 6, 9].map((n) => [...queue.slice(n % queue.length), ...queue.slice(0, n % queue.length)])];
  let best = null;
  search: for (const order of queueOrders) {
    for (const dayOrder of dayOrders) {
      const result = attempt(dayOrder, order);
      if (!best || result.left.length < best.left.length) best = result;
      if (!result.left.length) break search;
    }
  }
  const unscheduled = best.left;
  const fixtures = best.placed;
  if (unscheduled.length) {
    throw new Error(
      `Could not fit ${unscheduled.length} group fixture(s) into the Tuesday-Thursday game windows (${unscheduled.map((m) => `${m.home} vs ${m.away}`).join("; ")}). Add venues or time slots.`
    );
  }

  // --- Friday: semi-finals (group winners only) then the final ---
  // Games on one venue run back to back (15 min changeover); the final starts
  // once both semi-finals are over plus a 30 min rest for the finalists, and
  // must finish by the end of the Games Finals slot.
  const seeds = KNOCKOUT_SEEDS[groupCount];
  const GAP = 15;
  const FINAL_REST = 30;
  const venueFree = new Map(cfg.venues.map((v) => [v, toMinutes(cfg.knockout.start)]));
  let semisEnd = 0;
  Object.keys(seeds).forEach((slot, i) => {
    const venue = cfg.venues[i % cfg.venues.length];
    const start = venueFree.get(venue);
    venueFree.set(venue, start + cfg.durationMin + GAP);
    semisEnd = Math.max(semisEnd, start + cfg.durationMin);
    fixtures.push(knockoutFixture({ category, gender, round: "SEMI", slot, venue, date: knockoutDay, time: fromMinutes(start), seeds: seeds[slot], cfg }));
  });
  const finalVenue = cfg.venues[0];
  const finalStart = Math.max(semisEnd + FINAL_REST, venueFree.get(finalVenue));
  if (finalStart + cfg.durationMin > toMinutes(cfg.knockout.end)) {
    throw new Error(`${category} semi-finals and final do not fit before ${cfg.knockout.end} on Friday with ${cfg.durationMin}-minute games. Shorten the match duration.`);
  }
  const finalFixture = knockoutFixture({ category, gender, round: "FINAL", slot: "F", venue: finalVenue, date: knockoutDay, time: fromMinutes(finalStart), seeds: null, cfg });
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

/** Start times (HH:MM) for game day `d` that begin and end inside that day's window. */
function windowStarts(cfg, d) {
  const w = (cfg.windows || [])[d] || (cfg.windows || [])[(cfg.windows || []).length - 1];
  if (!w) return [];
  const out = [];
  for (let t = toMinutes(w.start); t + cfg.durationMin <= toMinutes(w.end); t += cfg.stepMin || 15) out.push(fromMinutes(t));
  return out;
}

function findGroupSlot({ calendar, cfg, groupDays, dayOrder, home, away, maxPerDay }) {
  for (const d of dayOrder || groupDays.map((_, i) => i)) {
    const date = groupDays[d];
    if (calendar.countOn(home, date) >= maxPerDay || calendar.countOn(away, date) >= maxPerDay) continue;
    // A custom slot list (from the request) applies to every day; otherwise
    // every start time that fits the day's programme window is tried, earliest first.
    const daySlots = cfg.slots || windowStarts(cfg, d);
    for (const time of daySlots) {
      for (const venue of cfg.venues) {
        if (!calendar.venueFree(venue, date, time, cfg.durationMin)) continue;
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
  // Dance and Folk Song are both on Friday evening: heats first, then the Grand Final.
  const eveningDay = pickFriday(days);
  const heatDays = options.heatDays && options.heatDays.length ? options.heatDays : [eveningDay];
  const finalDay = eveningDay;

  const groups = buildGroups(teams, groupCount);
  const calendar = createCalendar(options.existing);
  const fixtures = [];
  const venue = cfg.venues[0];
  const slotTimes = Array.from({ length: cfg.slotCount }, (_, i) => fromMinutes(toMinutes(cfg.slotStart) + i * cfg.durationMin));

  const tbcCounter = new Map(); // date -> placeholder minutes already used (keeps running order)
  const nextTbc = (date) => {
    const n = tbcCounter.get(date) || 0;
    tbcCounter.set(date, n + 1);
    return fromMinutes((cfg.tbcStartMinute || 0) + n); // 00:00, 00:01, ... = "TBA, in this order"
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
      while (i < slotTimes.length && !(calendar.venueFree(venue, date, slotTimes[i], cfg.durationMin) && calendar.parishFree(team, date, slotTimes[i], cfg.durationMin, cfg.restMin, category))) i++;
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
  pickGameDays,
  pickFriday,
  KNOCKOUT_SEEDS,
  EAT_OFFSET,
  planGroupCompetition,
  planElevenChurchCup,
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
