// GY Summit 2026 — notifications (email + SMS + WhatsApp)
//
// Wired to real providers now:
//   - Email: Brevo Transactional Email API, if BREVO_API_KEY is set.
//     Sends over HTTPS rather than SMTP, which also sidesteps Render
//     blocking outbound SMTP ports. Uses the same BREVO_API_KEY as
//     WhatsApp below — one key covers both channels.
//   - SMS: Celcom Africa (isms.celcomafrica.com), if CELCOM_API_KEY and
//     CELCOM_PARTNER_ID are set. A Kenya-market SMS gateway — Celcom's
//     API natively accepts a comma-separated list of numbers in one
//     request, so bulk sends are genuinely one HTTP call, not a loop.
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

// ---------------- Email (Brevo Transactional Email) ----------------

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

async function sendEmail({ to, subject, body, emailConfig = {} }) {
  const { BREVO_API_KEY } = process.env;
  const senderName = emailConfig.emailSenderName || "GY Summit 2026";
  const senderEmail = emailConfig.senderEmail;
  const replyEmail = emailConfig.replyEmail || senderEmail;

  if (!to) return;
  if (!BREVO_API_KEY) {
    console.log(`[notify:email:not-configured] BREVO_API_KEY is missing. Would send to ${to}: "${subject}"`);
    return;
  }
  if (!senderEmail) {
    console.log(`[notify:email:not-configured] senderEmail is missing in emailConfigForm. Would send to ${to}: "${subject}"`);
    return;
  }

  // Brevo requires the sender address to be verified before it will
  // deliver — but unlike some providers this doesn't need DNS/domain
  // ownership: Brevo → Senders, Domains & Dedicated IPs → Senders → Add
  // a sender → confirm the link Brevo emails to that address, and it's
  // ready to send. (Full domain authentication is optional and only
  // improves deliverability/reputation at higher volume.) A real error
  // here almost always means senderEmail isn't a verified sender yet.
  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject: subject || "GY Summit 2026",
    textContent: body || "",
  };
  if (replyEmail) payload.replyTo = { email: replyEmail };

  try {
    const response = await axios.post(BREVO_EMAIL_URL, payload, {
      timeout: 15000,
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    });
    console.log(`[notify:email:sent] ${to} — "${subject}" — id=${response.data?.messageId || "unknown"}`);
    return response.data;
  } catch (err) {
    console.error(`[notify:email:error] ${to} — "${subject}" —`, err.response?.data ? JSON.stringify(err.response.data) : err.message);
    throw err;
  }
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

// ---------------- SMS (Celcom Africa) ----------------

const CELCOM_SMS_URL = "https://isms.celcomafrica.com/api/services/sendsms/";

function celcomCreds() {
  const { CELCOM_API_KEY, CELCOM_PARTNER_ID, CELCOM_SHORTCODE } = process.env;
  return { apikey: CELCOM_API_KEY, partnerID: CELCOM_PARTNER_ID, shortcode: CELCOM_SHORTCODE || "INFOTEXT" };
}

async function sendSms(phone, message) {
  const { apikey, partnerID, shortcode } = celcomCreds();
  if (!phone) return;
  if (!apikey || !partnerID) {
    console.log(`[notify:sms:not-configured] would SMS +${normalizePhone(phone)}: "${message}"`);
    return;
  }
  try {
    const response = await axios.post(
      CELCOM_SMS_URL,
      { apikey, partnerID, mobile: normalizePhone(phone), message, shortcode, pass_type: "plain" },
      { timeout: 15000, headers: { "Content-Type": "application/json" } }
    );
    console.log(`[notify:sms:sent] +${normalizePhone(phone)}`);
    return response.data;
  } catch (err) {
    console.error("[notify:sms:error]", err.response?.data ? JSON.stringify(err.response.data) : err.message);
    throw err;
  }
}

/**
 * Celcom's API accepts a comma-separated `mobile` list in a single
 * request — genuinely one HTTP call for the whole audience, the same
 * way the original Africa's Talking integration worked, rather than a
 * loop of per-recipient requests.
 */
async function sendBulkSms(phones, message) {
  const { apikey, partnerID, shortcode } = celcomCreds();
  const numbers = [...new Set(phones.filter(Boolean).map((p) => normalizePhone(p)))];
  if (!numbers.length) return { sent: 0 };
  if (!apikey || !partnerID) {
    console.log(`[notify:sms:not-configured] would bulk-SMS ${numbers.length} recipient(s): "${message}"`);
    return { sent: 0, skipped: numbers.length };
  }

  // Chunk defensively — Celcom's docs don't publish a hard cap on a
  // comma-separated recipient list, but sending an unbounded number of
  // numbers in one request body is asking for a timeout or a silent
  // truncation on their end.
  const CHUNK = 500;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const chunk = numbers.slice(i, i + CHUNK);
    try {
      const response = await axios.post(
        CELCOM_SMS_URL,
        { apikey, partnerID, mobile: chunk.join(","), message, shortcode, pass_type: "plain" },
        { timeout: 20000, headers: { "Content-Type": "application/json" } }
      );
      const results = response.data?.responses || [];
      const chunkSent = results.filter((r) => r["respose-code"] === 200).length;
      sent += chunkSent;
      failed += chunk.length - chunkSent;
    } catch (err) {
      failed += chunk.length;
      console.error("[notify:sms:bulk:error]", err.response?.data ? JSON.stringify(err.response.data) : err.message);
    }
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

module.exports = { notify, sendBulkSms, sendSms, sendWhatsapp, sendTransactionalEmail };
