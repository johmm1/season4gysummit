// GY Summit 2026 — notifications (email + SMS + WhatsApp)
//
// Wired to real providers now:
//   - Email: Nodemailer, if SMTP_HOST/USER/PASS are set.
//   - SMS: Brevo Transactional SMS API, if BREVO_API_KEY is set.
//   - WhatsApp: Brevo's Transactional WhatsApp API (same account/API key
//     as SMS — one Brevo account covers all three channels now), if
//     BREVO_API_KEY and BREVO_WHATSAPP_SENDER are set. Brevo sits on top
//     of WhatsApp Business, so the same 24-hour session / approved-
//     template rule still applies — see the note on sendWhatsapp() below.
//
// Any channel left unconfigured logs a clear one-line notice instead of
// silently doing nothing or crashing the request it's attached to — every
// call here is fire-and-forget from the caller's point of view.

const axios = require("axios");
const { getForm } = require("./settingsService");
const { normalizePhone } = require("./mpesaService");

// ---------------- Email ----------------

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const nodemailer = require("nodemailer");
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function sendEmail({ to, subject, body, emailConfig }) {
  const senderName = emailConfig.emailSenderName || "GY Summit 2026";
  const senderEmail = emailConfig.senderEmail;
  const t = getTransporter();
  if (!t || !senderEmail || !to) {
    console.log(`[notify:email:not-configured] would send to ${to}: "${subject}" — ${body}`);
    return;
  }
  await t.sendMail({
    from: `"${senderName}" <${senderEmail}>`,
    replyTo: emailConfig.replyEmail || senderEmail,
    to,
    subject,
    text: body,
  });
}

/**
 * For account-security emails (password reset, etc.) that must always go
 * out regardless of the admin's Announcements > Notification Channels
 * toggles — those toggles are meant to govern optional/marketing-style
 * notifications, not core account recovery. Uses whatever SMTP sender
 * name/address is configured, but never checks channels.enableEmail or
 * autoMessages first.
 */
async function sendTransactionalEmail(to, subject, body) {
  if (!to) return;
  try {
    const emailConfig = await getForm("emailConfigForm");
    await sendEmail({ to, subject, body, emailConfig });
  } catch (err) {
    console.error("[notify:transactional:error]", err.message);
    throw err; // callers of transactional email (e.g. password reset) need to know if it failed
  }
}

// ---------------- SMS (Brevo Transactional SMS) ----------------

const BREVO_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/sms";

// Brevo's sender field is capped at 11 alphanumeric characters (or a full
// number in some regions) — fall back to a safe generic default rather
// than sending an invalid sender and having the whole message rejected.
function brevoSender() {
  const raw = (process.env.BREVO_SMS_SENDER || "GYSummit").replace(/[^A-Za-z0-9]/g, "");
  return raw.slice(0, 11) || "GYSummit";
}

async function sendSms(phone, message) {
  const { BREVO_API_KEY } = process.env;
  if (!phone) return;
  if (!BREVO_API_KEY) {
    console.log(`[notify:sms:not-configured] would SMS +${normalizePhone(phone)}: "${message}"`);
    return;
  }
  await axios.post(
    BREVO_SMS_URL,
    {
      sender: brevoSender(),
      recipient: normalizePhone(phone),
      content: message,
      type: "transactional",
    },
    {
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
}

/**
 * Brevo's transactional SMS endpoint is single-recipient only (unlike some
 * gateways that accept a comma-separated `to` list), so "bulk" here means
 * firing requests for the whole audience with bounded concurrency instead
 * of either a single API call or a slow fully-sequential loop. One bad
 * number/failure is isolated via Promise.allSettled and never aborts the
 * rest of the batch.
 */
async function sendBulkSms(phones, message) {
  const { BREVO_API_KEY } = process.env;
  const numbers = [...new Set(phones.filter(Boolean).map((p) => normalizePhone(p)))];
  if (!numbers.length) return { sent: 0 };
  if (!BREVO_API_KEY) {
    console.log(`[notify:sms:not-configured] would bulk-SMS ${numbers.length} recipient(s): "${message}"`);
    return { sent: 0, skipped: numbers.length };
  }

  const sender = brevoSender();
  const CONCURRENCY = 10; // stay well under Brevo's per-second rate limit
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const chunk = numbers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map((recipient) =>
        axios.post(
          BREVO_SMS_URL,
          { sender, recipient, content: message, type: "transactional" },
          { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" } }
        )
      )
    );
    results.forEach((r) => (r.status === "fulfilled" ? sent++ : failed++));
  }
  return failed ? { sent, failed } : { sent };
}

// ---------------- WhatsApp (Brevo Transactional WhatsApp) ----------------

const BREVO_WHATSAPP_URL = "https://api.brevo.com/v3/whatsapp/sendMessage";

// Brevo's WhatsApp API is a thin layer over WhatsApp Business itself, so
// the underlying Meta rule still applies: a free-form "text" message only
// delivers within a 24-hour window after the contact last messaged your
// WhatsApp number, or the very first message to a new contact. Outside
// that window, WhatsApp requires an approved message *template* instead.
// Since summit participants haven't necessarily messaged the WhatsApp
// number first, production use for cold outreach (e.g. "your registration
// is confirmed") will need a template created and approved in Brevo's
// WhatsApp Campaigns dashboard — set BREVO_WHATSAPP_TEMPLATE_ID once you
// have one and this switches to sending it (templated messages don't
// carry a custom body, so the plain-text `message` argument is ignored in
// that mode). Leave BREVO_WHATSAPP_TEMPLATE_ID unset to keep sending
// plain text, which works immediately for testing and for any participant
// who has messaged in first.
async function sendWhatsapp(phone, message) {
  const { BREVO_API_KEY, BREVO_WHATSAPP_SENDER, BREVO_WHATSAPP_TEMPLATE_ID } = process.env;
  if (!phone) return;
  if (!BREVO_API_KEY || !BREVO_WHATSAPP_SENDER) {
    console.log(`[notify:whatsapp:not-configured] would WhatsApp +${normalizePhone(phone)}: "${message}"`);
    return;
  }
  const body = BREVO_WHATSAPP_TEMPLATE_ID
    ? { contactNumbers: [normalizePhone(phone)], senderNumber: BREVO_WHATSAPP_SENDER, templateId: Number(BREVO_WHATSAPP_TEMPLATE_ID) }
    : { contactNumbers: [normalizePhone(phone)], senderNumber: BREVO_WHATSAPP_SENDER, text: message };

  await axios.post(BREVO_WHATSAPP_URL, body, {
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
  });
}

// ---------------- Template filling ----------------

function fillTemplate(template, vars) {
  if (!template) return null;
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : ""));
}

/**
 * @param eventKey one of "notifyRegistration" | "notifyPayment" | "notifyAdmission" | "notifyAnnouncements" | "notifyCertificates"
 * @param templateKey one of "registrationTemplate" | "paymentTemplate" | "admissionTemplate" | "certificateTemplate" | null
 * @param to { email, phone } — either can be omitted
 * @param subjectFallback used as the email subject, and as the SMS/WhatsApp body if no template/vars.body is set
 * @param vars values available to the template as {{placeholders}}
 */
async function notify(eventKey, templateKey, to, subjectFallback, vars = {}) {
  const recipient = typeof to === "string" ? { email: to } : (to || {});
  try {
    const [channels, autoMessages, emailConfig, templates, whatsappConfig] = await Promise.all([
      getForm("notificationChannelsForm"),
      getForm("autoMessagesForm"),
      getForm("emailConfigForm"),
      getForm("notificationTemplatesForm"),
      getForm("whatsappConfigForm"),
    ]);

    if (autoMessages[eventKey] === false) return;

    const body = fillTemplate(templates[templateKey], vars) || vars.body || subjectFallback;

    if (channels.enableEmail !== false && recipient.email) {
      await sendEmail({ to: recipient.email, subject: subjectFallback, body, emailConfig });
    }
    if (channels.enableSms === true && recipient.phone) {
      await sendSms(recipient.phone, body);
    }
    if (channels.enableWhatsapp === true && recipient.phone) {
      const footer = whatsappConfig.whatsappFooter ? `\n\n${whatsappConfig.whatsappFooter}` : "";
      await sendWhatsapp(recipient.phone, body + footer);
    }
  } catch (err) {
    // Never let a notification failure break the caller's request.
    console.error(`[notify:error] ${eventKey}:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
}

module.exports = { notify, sendBulkSms, sendSms, sendWhatsapp, sendTransactionalEmail };
