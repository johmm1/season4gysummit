// Y-Summit Season 4 2026 — forgiving name matching for the admission desk.
//
// Handles: one name or several, any order ("Wanjiru Kamau" / "kamau wanjiru"),
// partial names ("wanj"), misspellings ("Wanjiro", "Kamao"), double letters,
// and phone digits. Pure functions — no database access — so it is easy to test.

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text).split(" ").filter(Boolean);
}

// Levenshtein distance with an early exit once it exceeds `max`.
function distance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// A light phonetic key so spellings that sound alike still match
// (e.g. "Njeri"/"Njery", "Kariuki"/"Kariuky", "Mwangi"/"Mwangy").
function phonetic(word) {
  return word
    .replace(/ph/g, "f")
    .replace(/ck|kh|q/g, "k")
    .replace(/c(?=[aou])/g, "k")
    .replace(/c/g, "s")
    .replace(/w/g, "u")
    .replace(/y/g, "i")
    .replace(/z/g, "s")
    .replace(/(.)\1+/g, "$1")
    .replace(/[aeiou]+/g, (m, offset) => (offset === 0 ? "a" : ""))
    .replace(/h/g, "");
}

// How well does one query word match one name word? 0..1
function wordScore(q, w) {
  if (q === w) return 1;
  if (w.startsWith(q)) return q.length >= 2 ? 0.92 : 0.6;
  if (q.length >= 3 && w.includes(q)) return 0.78;
  const max = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
  const d = distance(q, w.length > q.length + max ? w.slice(0, q.length + max) : w, max);
  if (d <= max) {
    const base = 1 - d / Math.max(q.length, w.length);
    return Math.max(0.55, Math.min(0.9, base));
  }
  if (q.length >= 3 && phonetic(q) && phonetic(q) === phonetic(w)) return 0.7;
  // Partly typed AND slightly misspelled ("esta" for "Esther").
  if (q.length >= 3 && distance(q, w.slice(0, q.length), 1) <= 1) return 0.68;
  return 0;
}

function scoreName(queryTokens, nameTokens) {
  if (!queryTokens.length || !nameTokens.length) return { score: 0, exact: false };
  const used = new Set();
  let total = 0;
  let matched = 0;
  let exactCount = 0;
  for (const q of queryTokens) {
    let best = 0;
    let bestIdx = -1;
    nameTokens.forEach((w, i) => {
      if (used.has(i)) return;
      const s = wordScore(q, w);
      if (s > best) { best = s; bestIdx = i; }
    });
    if (bestIdx >= 0 && best > 0) {
      used.add(bestIdx);
      matched++;
      total += best;
      if (best === 1) exactCount++;
    }
  }
  if (!matched) return { score: 0, exact: false };
  // Average over the words the user typed; every typed word must find something.
  let score = total / queryTokens.length;
  if (matched < queryTokens.length) score *= 0.5;
  // Small bonus when the person typed all of (or most of) the name.
  score += Math.min(0.06, (matched / nameTokens.length) * 0.06);
  return { score: Math.min(1, score), exact: exactCount === queryTokens.length };
}

/**
 * @param {string} query  what the desk typed
 * @param {Array}  people objects with fullName and phone
 * @returns {Array<{item, score, exact}>} best matches first
 */
function rankByName(query, people, { limit = 10, minScore = 0.5 } = {}) {
  const digits = String(query).replace(/\D/g, "");
  const isPhone = digits.length >= 4 && digits.length >= normalize(query).replace(/\s/g, "").length - 1;
  const qTokens = tokens(query);
  const out = [];

  for (const item of people) {
    if (isPhone) {
      const phone = String(item.phone || "").replace(/\D/g, "");
      if (phone.endsWith(digits) || phone.includes(digits)) {
        out.push({ item, score: phone.endsWith(digits) ? 1 : 0.9, exact: true });
      }
      continue;
    }
    const { score, exact } = scoreName(qTokens, tokens(item.fullName));
    if (score >= minScore) out.push({ item, score, exact });
  }

  out.sort((a, b) =>
    b.score - a.score || String(a.item.fullName).localeCompare(String(b.item.fullName)));
  return out.slice(0, limit);
}

module.exports = { rankByName, normalize, scoreName, wordScore };
