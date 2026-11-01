// Y-Summit Season 4 2026 — judging criteria and score maths.
//
// Judged competitions (Dance, Folk Song) are marked by judges on a few
// criteria, each out of 10. A weighted total out of 100 is stored with
// every score so leaderboards are just averages across judges.
//
// Dance keeps using the weights already set in Sports > Dance Scoring
// (danceScoringForm); Folk Song's weights are defined here.

const MAX_PER_CRITERION = 10;

const CRITERIA = {
  Dance: [
    { key: "theme", label: "Theme interpretation", weightKey: "danceWeightTheme", weight: 20 },
    { key: "creativity", label: "Creativity & choreography", weightKey: "danceWeightCreativity", weight: 20 },
    { key: "sync", label: "Synchronisation & technique", weightKey: "danceWeightSync", weight: 20 },
    { key: "presence", label: "Stage presence", weightKey: "danceWeightPresence", weight: 20 },
    { key: "costume", label: "Costume & props", weightKey: "danceWeightCostume", weight: 20 },
  ],
  "Folk Song": [
    { key: "message", label: "Lyrics & message (theme fit)", weight: 25 },
    { key: "vocals", label: "Vocal quality & pitch", weight: 25 },
    { key: "harmony", label: "Harmony & blend", weight: 20 },
    { key: "authenticity", label: "Authenticity & cultural expression", weight: 15 },
    { key: "presence", label: "Stage presence & costume", weight: 15 },
  ],
};

const JUDGED_CATEGORIES = Object.keys(CRITERIA);

function isJudged(category) {
  return JUDGED_CATEGORIES.includes(category);
}

/** Criteria for a category with weights resolved (Dance reads the admin's saved weights). */
function criteriaFor(category, danceWeights = {}) {
  return (CRITERIA[category] || []).map((c) => ({
    key: c.key,
    label: c.label,
    max: MAX_PER_CRITERION,
    weight: c.weightKey && danceWeights[c.weightKey] !== undefined ? Number(danceWeights[c.weightKey]) : c.weight,
  }));
}

/** Weighted total out of 100. `scores` is { criterionKey: 0..10 }. */
function computeTotal(criteria, scores) {
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0) || 100;
  const raw = criteria.reduce((sum, c) => sum + (Number(scores[c.key]) / c.max) * c.weight, 0);
  return Math.round((raw / totalWeight) * 10000) / 100;
}

/**
 * Validates a judge's marks: every criterion present, a number from 0 to the
 * maximum (halves allowed). Returns { ok, scores, error }.
 */
function validateMarks(criteria, input) {
  const scores = {};
  for (const c of criteria) {
    const value = Number(input?.[c.key]);
    if (input?.[c.key] === undefined || input?.[c.key] === null || input?.[c.key] === "" || !Number.isFinite(value)) {
      return { ok: false, error: `Please enter a mark for "${c.label}".` };
    }
    if (value < 0 || value > c.max) return { ok: false, error: `"${c.label}" must be between 0 and ${c.max}.` };
    if (Math.round(value * 2) !== value * 2) return { ok: false, error: `"${c.label}" can only use whole or half marks (e.g. 7 or 7.5).` };
    scores[c.key] = value;
  }
  return { ok: true, scores };
}

/**
 * Average total (0-100) for one performance across all judges, or null if
 * unmarked. Old Dance cards saved before judging existed (DanceScore, 0-100
 * per criterion) still count, using the same weights.
 */
function eventAverage(event, danceWeights = {}) {
  const totals = (event.judgeScores || []).map((s) => Number(s.total));
  for (const legacy of event.danceScores || []) totals.push(legacyDanceTotal(legacy, danceWeights));
  if (!totals.length) return null;
  return Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100;
}

function legacyDanceTotal(score, weights) {
  const criteria = criteriaFor("Dance", weights);
  const field = { theme: "themeScore", creativity: "creativityScore", sync: "syncScore", presence: "presenceScore", costume: "costumeScore" };
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0) || 100;
  return criteria.reduce((sum, c) => sum + Number(score[field[c.key]]) * c.weight, 0) / totalWeight;
}

function judgeCount(event) {
  return (event.judgeScores || []).length + (event.danceScores || []).length;
}

module.exports = { CRITERIA, JUDGED_CATEGORIES, MAX_PER_CRITERION, isJudged, criteriaFor, computeTotal, validateMarks, eventAverage, judgeCount };
