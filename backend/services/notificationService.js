// Y-Summit Season 4 2026 — notifications (email + SMS + WhatsApp)
//
// Wired to real providers now:
//   - Email: Brevo Transactional Email API, if BREVO_API_KEY is set.
//     Sends over HTTPS rather than SMTP, which also sidesteps Render
//     blocking outbound SMTP ports. Uses the same BREVO_API_KEY as
//     WhatsApp below — one key covers both channels.
//   - SMS: Brevo Transactional SMS API, if BREVO_API_KEY is set. The same
//     key as email and WhatsApp covers all three channels; the sender name
//     comes from BREVO_SMS_SENDER. Brevo sends one SMS per request, so bulk
//     sends loop in small parallel batches.
//   - WhatsApp: Brevo's Transactional WhatsApp API, if BREVO_API_KEY and
//     BREVO_WHATSAPP_SENDER are set. Brevo sits on top of WhatsApp
//     Business, so the usual 24-hour session / approved-template rule
//     still applies — see the note on sendWhatsapp() below.
//
// Any channel left unconfigured logs a clear one-line notice instead of
// silently doing nothing or crashing the request it's attached to — every
// call here is fire-and-forget from the caller's point of view.

const axios = require("axios");
const { getForm } = require("./settingsService");
const { normalizePhone } = require("./mpesaService");

// ---------------- Email (Brevo or Resend) ----------------
//
// Whichever provider key is present is used (Brevo wins if both are set).
// The "from" address comes from Announcements > Email Settings, or - if that
// is blank - from the EMAIL_FROM environment variable, so a missing admin
// setting can no longer silently stop every email.

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const RESEND_EMAIL_URL = "https://api.resend.com/emails";

let lastEmailResult = null; // { ok, at, to, provider, error } — shown in the admin "Email status" check

function emailProvider() {
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return null;
}

function resolveSender(emailConfig = {}) {
  const senderEmail =
    emailConfig.senderEmail || process.env.EMAIL_FROM || process.env.BREVO_SENDER_EMAIL || process.env.RESEND_FROM || "";
  const senderName = emailConfig.emailSenderName || process.env.EMAIL_FROM_NAME || "Y-Summit Season 4 2026";
  const replyEmail = emailConfig.replyEmail || senderEmail;
  return { senderEmail, senderName, replyEmail };
}

async function sendEmail({ to, subject, body, emailConfig = {} }) {
  const provider = emailProvider();
  const { senderEmail, senderName, replyEmail } = resolveSender(emailConfig);

  if (!to) return;
  if (!provider) {
    const msg = "No email provider key is set (BREVO_API_KEY or RESEND_API_KEY).";
    lastEmailResult = { ok: false, at: new Date().toISOString(), to, provider: null, error: msg };
    console.error(`[notify:email:not-configured] ${msg} Would send to ${to}: "${subject}"`);
    throw new Error(msg);
  }
  if (!senderEmail) {
    const msg = "No sender address — set Sender Email in Announcements > Email Settings, or the EMAIL_FROM environment variable.";
    lastEmailResult = { ok: false, at: new Date().toISOString(), to, provider, error: msg };
    console.error(`[notify:email:not-configured] ${msg} Would send to ${to}: "${subject}"`);
    throw new Error(msg);
  }

  try {
    let messageId;
    if (provider === "brevo") {
      const payload = {
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        subject: subject || "Y-Summit Season 4 2026",
        textContent: body || "",
      };
      if (replyEmail) payload.replyTo = { email: replyEmail };
      const response = await axios.post(BREVO_EMAIL_URL, payload, {
        timeout: 15000,
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      });
      messageId = response.data?.messageId;
    } else {
      const payload = {
        from: `${senderName} <${senderEmail}>`,
        to: [to],
        subject: subject || "Y-Summit Season 4 2026",
        text: body || "",
      };
      if (replyEmail) payload.reply_to = replyEmail;
      const response = await axios.post(RESEND_EMAIL_URL, payload, {
        timeout: 15000,
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      });
      messageId = response.data?.id;
    }
    lastEmailResult = { ok: true, at: new Date().toISOString(), to, provider, messageId };
    console.log(`[notify:email:sent] (${provider}) ${to} — "${subject}" — id=${messageId || "unknown"}`);
    return { provider, messageId };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    lastEmailResult = { ok: false, at: new Date().toISOString(), to, provider, error: detail };
    console.error(`[notify:email:error] (${provider}) ${to} — "${subject}" —`, detail);
    throw err;
  }
}

/** For the admin "Email status" panel: what's configured, and what happened last time. */
async function emailStatus() {
  const emailConfig = await getForm("emailConfigForm");
  const { senderEmail } = resolveSender(emailConfig);
  const provider = emailProvider();
  const problems = [];
  if (!provider) problems.push("No provider key: add BREVO_API_KEY (or RESEND_API_KEY) in your hosting environment variables.");
  if (!senderEmail) problems.push("No sender address: fill Sender Email in Email Settings, or set EMAIL_FROM.");
  if (process.env.SKIP_OTP_VERIFICATION === "true") problems.push("SKIP_OTP_VERIFICATION is on, so sign-up verification codes are skipped. Remove it once email works.");
  if (!process.env.FRONTEND_URL) problems.push("FRONTEND_URL is not set, so password-reset links may be broken.");
  return { provider, senderEmail: senderEmail || null, ready: Boolean(provider && senderEmail), problems, last: lastEmailResult };
}

/**
 * For account-security emails (OTP, password reset) that must always go
 * out regardless of the admin's Announcements > Notification Channels
 * toggles — those toggles are meant to govern optional/marketing-style
 * notifications, not core account recovery.
 */
async function sendTransactionalEmail(to, subject, body) {
  if (!to) return;
  try {
    const emailConfig = await getForm("emailConfigForm");
    return await sendEmail({ to, subject, body, emailConfig });
  } catch (err) {
    console.error("[notify:transactional:error]", err.response?.data ? JSON.stringify(err.response.data) : err.message);
    throw err; // callers of transactional email (e.g. password reset) need to know if it failed
  }
}

// ---------------- SMS (Brevo Transactional SMS) ----------------
//
// POST https://api.brevo.com/v3/transactionalSMS/send  (older accounts/docs
// still use /transactionalSMS/sms, so we fall back to that on a 404).
// Needs SMS credits in your Brevo account (Brevo > SMS > Buy credits) and a
// sender name: up to 11 letters/numbers, no spaces (e.g. "YSUMMIT"). Some
// countries require sender IDs to be registered first; if Kenyan carriers
// drop your messages, ask Brevo support to register the sender for Kenya.

const BREVO_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/send";
const BREVO_SMS_LEGACY_URL = "https://api.brevo.com/v3/transactionalSMS/sms";

function smsSender() {
  const raw = process.env.BREVO_SMS_SENDER || "YSummit";
  // Brevo: max 11 characters for alphanumeric senders (15 digits if numeric).
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "");
  return /^\d+$/.test(cleaned) ? cleaned.slice(0, 15) : cleaned.slice(0, 11) || "YSummit";
}

async function postBrevoSms(payload) {
  const headers = { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" };
  try {
    return await axios.post(BREVO_SMS_URL, payload, { timeout: 15000, headers });
  } catch (err) {
    if (err.response?.status === 404) return axios.post(BREVO_SMS_LEGACY_URL, payload, { timeout: 15000, headers });
    throw err;
  }
}

async function sendSms(phone, message) {
  if (!phone) return;
  const recipient = normalizePhone(phone);
  if (!process.env.BREVO_API_KEY) {
    console.log(`[notify:sms:not-configured] BREVO_API_KEY is missing. Would SMS +${recipient}: "${message}"`);
    return;
  }
  try {
    const response = await postBrevoSms({
      sender: smsSender(),
      recipient,
      content: message,
      type: "transactional",
    });
    console.log(`[notify:sms:sent] (brevo) +${recipient} — ref=${response.data?.messageId || response.data?.reference || "unknown"}`);
    return response.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    const hint = err.response?.status === 402 ? " (not enough Brevo SMS credits)" : "";
    console.error(`[notify:sms:error] (brevo) +${recipient}${hint} —`, detail);
    throw err;
  }
}

/**
 * Bulk SMS (announcements). Brevo sends one message per request, so this
 * sends in parallel batches of 10 to stay quick without hammering the API.
 */
async function sendBulkSms(phones, message) {
  const numbers = [...new Set(phones.filter(Boolean).map((p) => normalizePhone(p)))];
  if (!numbers.length) return { sent: 0 };
  if (!process.env.BREVO_API_KEY) {
    console.log(`[notify:sms:not-configured] BREVO_API_KEY is missing. Would bulk-SMS ${numbers.length} recipient(s): "${message}"`);
    return { sent: 0, skipped: numbers.length };
  }

  const BATCH = 10;
  let sent = 0;
  let failed = 0;
  let firstError = null;
  for (let i = 0; i < numbers.length; i += BATCH) {
    const results = await Promise.allSettled(
      numbers.slice(i, i + BATCH).map((recipient) =>
        postBrevoSms({ sender: smsSender(), recipient, content: message, type: "transactional" })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") sent++;
      else {
        failed++;
        firstError = firstError || (r.reason?.response?.data ? JSON.stringify(r.reason.response.data) : r.reason?.message);
      }
    }
  }
  if (failed) console.error(`[notify:sms:bulk:error] (brevo) ${failed} of ${numbers.length} failed — ${firstError}`);
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
    timeout: 15000,
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

    if (autoMessages[eventKey] === false) {
      console.log(`[notify:disabled] ${eventKey}`);
      return;
    }

    const body = fillTemplate(templates[templateKey], vars) || vars.body || subjectFallback;

    if (channels.enableEmail !== false && recipient.email) {
      try {
        await sendEmail({ to: recipient.email, subject: subjectFallback, body, emailConfig });
      } catch (err) {
        console.error(`[notify:error] ${eventKey}: Email failed —`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
      }
    }

    if (channels.enableSms === true && recipient.phone) {
      try {
        await sendSms(recipient.phone, body);
      } catch (err) {
        console.error(`[notify:error] ${eventKey}: SMS failed —`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
      }
    }

    if (channels.enableWhatsapp === true && recipient.phone) {
      try {
        const footer = whatsappConfig.whatsappFooter ? `\n\n${whatsappConfig.whatsappFooter}` : "";
        await sendWhatsapp(recipient.phone, body + footer);
      } catch (err) {
        console.error(`[notify:error] ${eventKey}: WhatsApp failed —`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
      }
    }
  } catch (err) {
    // Never let a notification failure break the caller's request.
    console.error(`[notify:error] ${eventKey}:`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
  }
}

module.exports = { notify, sendBulkSms, sendSms, sendWhatsapp, sendTransactionalEmail, emailStatus };
