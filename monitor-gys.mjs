/**
 * Read-only GYS Summit availability monitor.
 * Checks public pages and API health only; never submits forms or writes to the database.
 * Optional alerts: set BREVO_API_KEY and EMAIL_FROM on the Render Cron service.
 */
const checks = [
  ["Public homepage", "https://www.githunguripresbytaryyouthsummit.co.ke/"],
  ["Registration page", "https://www.githunguripresbytaryyouthsummit.co.ke/register.html"],
  ["Login page", "https://www.githunguripresbytaryyouthsummit.co.ke/login.html"],
  ["Backend health", "https://gy-summit-2026-api.onrender.com/health"],
  ["Public settings API", "https://gy-summit-2026-api.onrender.com/api/public/settings"],
];

const results = await Promise.all(checks.map(async ([name, url]) => {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": "GYS-Summit-Monitor/1.0" }
    });
    return { name, url, status: response.status, ok: response.ok, ms: Date.now() - started };
  } catch (error) {
    return { name, url, status: "NETWORK_ERROR", ok: false, ms: Date.now() - started, error: String(error.message || error) };
  }
}));

const failed = results.filter(r => !r.ok);
const timestamp = new Date().toISOString();
const report = {
  timestamp,
  overall: failed.length ? "DEGRADED" : "HEALTHY",
  checks: results
};
console.log(JSON.stringify(report, null, 2));

const apiKey = process.env.BREVO_API_KEY;
const sender = process.env.EMAIL_FROM;
const recipient = process.env.ALERT_EMAIL || "gysummitadmin@gmail.com";
if (failed.length && apiKey && sender) {
  const lines = failed.map(r => `- ${r.name}: ${r.status}${r.error ? " — " + r.error : ""} (${r.url})`).join("\n");
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      sender: { email: sender },
      to: [{ email: recipient }],
      subject: "[GYS Summit] Monitoring alert — service check failed",
      textContent: `GYS Summit monitoring detected ${failed.length} failed check(s) at ${timestamp}.\n\n${lines}\n\nThis monitor performs read-only GET requests and does not modify participant records.`
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`Brevo alert failed: HTTP ${response.status} ${await response.text()}`);
  console.log(`Alert email accepted for delivery to ${recipient}.`);
} else if (failed.length) {
  console.error("Checks failed, but email alerts are not configured. Set BREVO_API_KEY and EMAIL_FROM on this Render Cron service.");
}
