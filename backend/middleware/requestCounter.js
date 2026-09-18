// GY Summit 2026 — tracks API requests for the current process so the admin
// System Health panel can show a real (if not historical) request count
// instead of a fabricated number. Resets when the server restarts.
let count = 0;
let windowStart = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function requestCounter(_req, _res, next) {
  if (Date.now() - windowStart > DAY_MS) {
    count = 0;
    windowStart = Date.now();
  }
  count++;
  next();
}

function getRequestCount() {
  return count;
}

module.exports = { requestCounter, getRequestCount };
