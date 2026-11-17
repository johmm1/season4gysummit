// Daily participant registration summary email (Africa/Nairobi).
const { Op } = require("sequelize");
const { User, Parish, AuditLog } = require("../models");
const { sendTransactionalEmail } = require("./notificationService");

const RECIPIENT = process.env.DAILY_REGISTRATION_REPORT_EMAIL || "ndungugathua252@gmail.com";
const TIME_ZONE = "Africa/Nairobi";
const SEND_HOUR = 20; // 8:00 p.m. EAT
let interval = null;

function nairobiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function utcRangeForNairobiDate(dateString) {
  const start = new Date(`${dateString}T00:00:00+03:00`);
  const nextDate = new Date(`${dateString}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateString = nextDate.toISOString().slice(0, 10);
  const end = new Date(`${nextDateString}T00:00:00+03:00`);
  return { start, end };
}

async function sendDailySummary(dateString) {
  const alreadySent = await AuditLog.findOne({
    where: { action: "DAILY_REGISTRATION_SUMMARY_SENT", entityType: "registration_summary", entityId: dateString },
    attributes: ["id"],
  });
  if (alreadySent) return;

  const { start, end } = utcRangeForNairobiDate(dateString);
  const users = await User.findAll({
    where: { role: "PARTICIPANT", createdAt: { [Op.gte]: start, [Op.lt]: end } },
    attributes: ["id", "parishId"],
    include: [{ model: Parish, attributes: ["name"], required: false }],
    order: [["createdAt", "ASC"]],
  });

  const byParish = new Map();
  for (const user of users) {
    const parishName = user.Parish?.name || "Unassigned parish";
    byParish.set(parishName, (byParish.get(parishName) || 0) + 1);
  }
  const breakdown = byParish.size
    ? [...byParish.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `- ${name}: ${count}`).join("\n")
    : "No registrations were recorded today.";

  const subject = `Y-Summit daily registrations — ${dateString}`;
  const body = [
    "Y-Summit Season 4 2026 — Daily Registration Summary",
    "",
    `Date: ${dateString} (East Africa Time)`,
    `New participant accounts: ${users.length}`,
    "",
    "Registrations by parish:",
    breakdown,
    "",
    "This is an automated daily summary. It counts participant accounts created during the reporting day.",
  ].join("\n");

  await sendTransactionalEmail(RECIPIENT, subject, body);
  await AuditLog.create({
    action: "DAILY_REGISTRATION_SUMMARY_SENT",
    entityType: "registration_summary",
    entityId: dateString,
    metadata: { recipient: RECIPIENT, count: users.length },
  });
  console.log(`[registration-summary] Sent ${users.length} registration(s) to ${RECIPIENT} for ${dateString}.`);
}

async function checkAndSend() {
  const parts = nairobiDateParts();
  if (Number(parts.hour) < SEND_HOUR) return;
  const dateString = `${parts.year}-${parts.month}-${parts.day}`;
  try {
    await sendDailySummary(dateString);
  } catch (err) {
    console.error("[registration-summary] Daily email failed:", err.response?.data || err.message);
  }
}

function startDailyRegistrationSummary() {
  if (interval) return;
  // Check immediately after startup, then every minute. If the service restarts
  // after 8 p.m., it still sends that day's report once the database is available.
  checkAndSend();
  interval = setInterval(checkAndSend, 60_000);
  console.log(`[registration-summary] Scheduled daily delivery after 8:00 p.m. EAT to ${RECIPIENT}.`);
}

module.exports = { startDailyRegistrationSummary };
