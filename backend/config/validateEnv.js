// Y-Summit Season 4 2026 — startup environment check
//
// JWT_SECRET, ADMISSION_QR_SECRET, and the database vars already throw
// immediately (in jwtService.js / qrService.js / config/database.js) if
// missing — those are non-negotiable for the app to run at all. This just
// adds a clear, all-in-one-place boot-time warning for the *optional*
// integrations (M-Pesa, Cloudinary), which previously failed silently or
// with a cryptic error the first time someone tried to pay or upload a
// photo — sometimes days after deploy. Nothing here blocks startup.

function checkEnv() {
  const warnings = [];

  const mpesaVars = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL"];
  const missingMpesa = mpesaVars.filter((v) => !process.env[v]);
  if (missingMpesa.length) {
    warnings.push(`M-Pesa payments will fail — missing: ${missingMpesa.join(", ")}`);
  } else if (process.env.MPESA_CALLBACK_URL && !process.env.MPESA_CALLBACK_URL.startsWith("https://")) {
    warnings.push("MPESA_CALLBACK_URL should be a public HTTPS URL — Safaricom will not call back to http:// or localhost.");
  }

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
  if (process.env.SKIP_OTP_VERIFICATION === "true") {
    warnings.push("SKIP_OTP_VERIFICATION is on — new accounts skip email verification. Turn it off once email is delivering.");
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
