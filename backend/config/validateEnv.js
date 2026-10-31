// Y-Summit Season 4 2026 — startup environment check
// Warns about optional integrations without blocking local development.

function checkEnv() {
  const warnings = [];

  const storageVars = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missingStorage = storageVars.filter((v) => !process.env[v]);
  if (missingStorage.length) {
    warnings.push(`Gallery/profile-photo uploads will fail — missing: ${missingStorage.join(", ")}`);
  }

  if (!process.env.BREVO_API_KEY && !process.env.RESEND_API_KEY) {
    warnings.push("EMAIL IS NOT SENDING — no BREVO_API_KEY or RESEND_API_KEY is set, so registration, verification and password-reset emails cannot go out.");
  }
  if ((process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) && !process.env.EMAIL_FROM) {
    warnings.push("EMAIL_FROM is not set — emails rely on Sender Email in Announcements > Email Settings. If that is blank, nothing is sent.");
  }
  if (!process.env.BREVO_API_KEY) {
    warnings.push("SMS notifications are not configured (BREVO_API_KEY) — turning on SMS in Announcements settings will just log instead of sending.");
  } else if (!process.env.BREVO_SMS_SENDER) {
    warnings.push("BREVO_SMS_SENDER is not set — SMS will go out under the default sender name \"YSummit\".");
  }
  if (!process.env.BREVO_WHATSAPP_SENDER) {
    warnings.push("WhatsApp notifications are not configured (BREVO_API_KEY/BREVO_WHATSAPP_SENDER) — turning on WhatsApp in Announcements settings will just log instead of sending.");
  }
  if (!process.env.GOOGLE_CLIENT_ID) {
    warnings.push("Google Sign-In is not configured (GOOGLE_CLIENT_ID) — the 'Continue with Google' button will show an error if clicked.");
  }

  if (!process.env.FRONTEND_URL) {
    warnings.push("FRONTEND_URL is not set — CORS will reject every browser request from your deployed frontend.");
  }

  if (warnings.length) {
    console.warn("\n⚠️  Optional configuration missing (app will still start):");
    warnings.forEach((w) => console.warn(`   - ${w}`));
    console.warn("");
  }
}

module.exports = { checkEnv };
