// GY Summit 2026 — Notifications
//
// EMAIL: Brevo Transactional Email API (HTTPS / port 443)
// SMS: Brevo Transactional SMS API
// WHATSAPP: Brevo Transactional WhatsApp API
//
// IMPORTANT:
// Email no longer uses SMTP/Nodemailer.
// This avoids Render's outbound SMTP port restrictions.

const axios = require("axios");
const { getForm } = require("./settingsService");
const { normalizePhone } = require("./mpesaService");

// ============================================================
// EMAIL — BREVO TRANSACTIONAL EMAIL API
// ============================================================

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

/**
 * Send an email through Brevo's HTTPS API.
 *
 * Required Render environment variable:
 *
 * BREVO_API_KEY
 *
 * Sender information comes from:
 *
 * SystemSettings -> emailConfigForm
 *
 * Example:
 * {
 *   "emailSenderName": "GY Summit 2026",
 *   "senderEmail": "yourverifiedemail@gmail.com",
 *   "replyEmail": "yourverifiedemail@gmail.com"
 * }
 */
async function sendEmail({ to, subject, body, emailConfig = {} }) {
  const { BREVO_API_KEY } = process.env;

  const senderName =
    emailConfig.emailSenderName || "GY Summit 2026";

  const senderEmail =
    emailConfig.senderEmail;

  const replyEmail =
    emailConfig.replyEmail || senderEmail;

  // Validate recipient
  if (!to) {
    console.log(
      `[notify:email:not-configured] No recipient email provided`
    );
    return;
  }

  // Validate Brevo API key
  if (!BREVO_API_KEY) {
    console.log(
      `[notify:email:not-configured] BREVO_API_KEY is missing. Would send to ${to}: "${subject}"`
    );
    return;
  }

  // Validate sender
  if (!senderEmail) {
    console.log(
      `[notify:email:not-configured] senderEmail is missing in emailConfigForm. Would send to ${to}: "${subject}"`
    );
    return;
  }

  try {
    const payload = {
      sender: {
        name: senderName,
        email: senderEmail,
      },

      to: [
        {
          email: to,
        },
      ],

      subject: subject || "GY Summit 2026",

      textContent:
        body || "",
    };

    // Add reply-to only when available
    if (replyEmail) {
      payload.replyTo = {
        email: replyEmail,
      };
    }

    const response = await axios.post(
      BREVO_EMAIL_URL,
      payload,
      {
        timeout: 15000,

        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    console.log(
      `[notify:email:sent] ${to} — "${subject}" — messageId=${response.data?.messageId || "unknown"}`
    );

    return response.data;
  } catch (err) {
    const brevoError =
      err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;

    console.error(
      `[notify:email:error] ${to} — "${subject}" — ${brevoError}`
    );

    throw err;
  }
}


// ============================================================
// TRANSACTIONAL EMAIL
// ============================================================

/**
 * Used for account-security emails such as:
 *
 * - OTP
 * - Password reset
 * - Account recovery
 *
 * This does NOT depend on notification channel toggles.
 */
async function sendTransactionalEmail(
  to,
  subject,
  body
) {
  if (!to) {
    console.log(
      "[notify:transactional] No recipient email"
    );
    return;
  }

  try {
    const emailConfig =
      await getForm("emailConfigForm");

    return await sendEmail({
      to,
      subject,
      body,
      emailConfig,
    });
  } catch (err) {
    console.error(
      "[notify:transactional:error]",
      err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message
    );

    // Keep the original behavior:
    // transactional email callers know that sending failed.
    throw err;
  }
}


// ============================================================
// SMS — BREVO TRANSACTIONAL SMS
// ============================================================

const BREVO_SMS_URL =
  "https://api.brevo.com/v3/transactionalSMS/sms";


/**
 * Brevo SMS sender name.
 *
 * Maximum is normally 11 alphanumeric characters.
 */
function brevoSender() {
  const raw = (
    process.env.BREVO_SMS_SENDER ||
    "GYSummit"
  ).replace(
    /[^A-Za-z0-9]/g,
    ""
  );

  return raw.slice(0, 11) || "GYSummit";
}


/**
 * Send one SMS.
 */
async function sendSms(phone, message) {
  const {
    BREVO_API_KEY,
  } = process.env;

  if (!phone) {
    return;
  }

  if (!BREVO_API_KEY) {
    console.log(
      `[notify:sms:not-configured] Would SMS +${normalizePhone(phone)}: "${message}"`
    );

    return;
  }

  try {
    const response = await axios.post(
      BREVO_SMS_URL,
      {
        sender: brevoSender(),

        recipient:
          normalizePhone(phone),

        content: message,

        type: "transactional",
      },
      {
        timeout: 15000,

        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
        },
      }
    );

    console.log(
      `[notify:sms:sent] +${normalizePhone(phone)}`
    );

    return response.data;
  } catch (err) {
    console.error(
      "[notify:sms:error]",
      err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message
    );

    throw err;
  }
}


/**
 * Send SMS to multiple recipients.
 */
async function sendBulkSms(
  phones,
  message
) {
  const {
    BREVO_API_KEY,
  } = process.env;

  const numbers = [
    ...new Set(
      phones
        .filter(Boolean)
        .map((p) =>
          normalizePhone(p)
        )
    ),
  ];

  if (!numbers.length) {
    return {
      sent: 0,
    };
  }

  if (!BREVO_API_KEY) {
    console.log(
      `[notify:sms:not-configured] Would bulk-SMS ${numbers.length} recipient(s): "${message}"`
    );

    return {
      sent: 0,
      skipped: numbers.length,
    };
  }

  const sender =
    brevoSender();

  const CONCURRENCY = 10;

  let sent = 0;
  let failed = 0;

  for (
    let i = 0;
    i < numbers.length;
    i += CONCURRENCY
  ) {
    const chunk =
      numbers.slice(
        i,
        i + CONCURRENCY
      );

    const results =
      await Promise.allSettled(
        chunk.map(
          (recipient) =>
            axios.post(
              BREVO_SMS_URL,
              {
                sender,

                recipient,

                content:
                  message,

                type:
                  "transactional",
              },
              {
                timeout: 15000,

                headers: {
                  "api-key":
                    BREVO_API_KEY,

                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json",
                },
              }
            )
        )
      );

    results.forEach(
      (result) => {
        if (
          result.status ===
          "fulfilled"
        ) {
          sent++;
        } else {
          failed++;

          console.error(
            "[notify:sms:bulk:error]",
            result.reason
              ?.response?.data ||
              result.reason?.message
          );
        }
      }
    );
  }

  return failed
    ? {
        sent,
        failed,
      }
    : {
        sent,
      };
}


// ============================================================
// WHATSAPP — BREVO TRANSACTIONAL WHATSAPP
// ============================================================

const BREVO_WHATSAPP_URL =
  "https://api.brevo.com/v3/whatsapp/sendMessage";


/**
 * Send WhatsApp message through Brevo.
 *
 * Environment variables:
 *
 * BREVO_API_KEY
 * BREVO_WHATSAPP_SENDER
 * BREVO_WHATSAPP_TEMPLATE_ID (optional)
 */
async function sendWhatsapp(
  phone,
  message
) {
  const {
    BREVO_API_KEY,
    BREVO_WHATSAPP_SENDER,
    BREVO_WHATSAPP_TEMPLATE_ID,
  } = process.env;

  if (!phone) {
    return;
  }

  if (
    !BREVO_API_KEY ||
    !BREVO_WHATSAPP_SENDER
  ) {
    console.log(
      `[notify:whatsapp:not-configured] Would WhatsApp +${normalizePhone(phone)}: "${message}"`
    );

    return;
  }

  try {
    let payload;

    if (
      BREVO_WHATSAPP_TEMPLATE_ID
    ) {
      payload = {
        contactNumbers: [
          normalizePhone(phone),
        ],

        senderNumber:
          BREVO_WHATSAPP_SENDER,

        templateId:
          Number(
            BREVO_WHATSAPP_TEMPLATE_ID
          ),
      };
    } else {
      payload = {
        contactNumbers: [
          normalizePhone(phone),
        ],

        senderNumber:
          BREVO_WHATSAPP_SENDER,

        text: message,
      };
    }

    const response =
      await axios.post(
        BREVO_WHATSAPP_URL,
        payload,
        {
          timeout: 15000,

          headers: {
            "api-key":
              BREVO_API_KEY,

            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },
        }
      );

    console.log(
      `[notify:whatsapp:sent] +${normalizePhone(phone)}`
    );

    return response.data;
  } catch (err) {
    console.error(
      "[notify:whatsapp:error]",
      err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message
    );

    throw err;
  }
}


// ============================================================
// TEMPLATE FILLING
// ============================================================

function fillTemplate(
  template,
  vars
) {
  if (!template) {
    return null;
  }

  return String(template).replace(
    /\{\{(\w+)\}\}/g,
    (_, key) =>
      vars[key] !== undefined
        ? vars[key]
        : ""
  );
}


// ============================================================
// GENERAL NOTIFICATION SYSTEM
// ============================================================

/**
 * eventKey:
 *
 * notifyRegistration
 * notifyPayment
 * notifyAdmission
 * notifyAnnouncements
 * notifyCertificates
 *
 * templateKey:
 *
 * registrationTemplate
 * paymentTemplate
 * admissionTemplate
 * certificateTemplate
 *
 * to:
 *
 * { email, phone }
 *
 * or simply:
 *
 * "email@example.com"
 */
async function notify(
  eventKey,
  templateKey,
  to,
  subjectFallback,
  vars = {}
) {
  const recipient =
    typeof to === "string"
      ? {
          email: to,
        }
      : (
          to || {}
        );

  try {
    const [
      channels,
      autoMessages,
      emailConfig,
      templates,
      whatsappConfig,
    ] = await Promise.all([
      getForm(
        "notificationChannelsForm"
      ),

      getForm(
        "autoMessagesForm"
      ),

      getForm(
        "emailConfigForm"
      ),

      getForm(
        "notificationTemplatesForm"
      ),

      getForm(
        "whatsappConfigForm"
      ),
    ]);

    // Automatic notification disabled
    if (
      autoMessages[eventKey] ===
      false
    ) {
      console.log(
        `[notify:disabled] ${eventKey}`
      );

      return;
    }

    const body =
      fillTemplate(
        templates[templateKey],
        vars
      ) ||
      vars.body ||
      subjectFallback;

    // --------------------------------------------------------
    // EMAIL
    // --------------------------------------------------------

    if (
      channels.enableEmail !==
        false &&
      recipient.email
    ) {
      try {
        await sendEmail({
          to:
            recipient.email,

          subject:
            subjectFallback,

          body,

          emailConfig,
        });
      } catch (err) {
        console.error(
          `[notify:error] ${eventKey}: Email failed —`,
          err.response?.data
            ? JSON.stringify(
                err.response.data
              )
            : err.message
        );
      }
    }

    // --------------------------------------------------------
    // SMS
    // --------------------------------------------------------

    if (
      channels.enableSms ===
        true &&
      recipient.phone
    ) {
      try {
        await sendSms(
          recipient.phone,
          body
        );
      } catch (err) {
        console.error(
          `[notify:error] ${eventKey}: SMS failed —`,
          err.response?.data
            ? JSON.stringify(
                err.response.data
              )
            : err.message
        );
      }
    }

    // --------------------------------------------------------
    // WHATSAPP
    // --------------------------------------------------------

    if (
      channels.enableWhatsapp ===
        true &&
      recipient.phone
    ) {
      try {
        const footer =
          whatsappConfig.whatsappFooter
            ? `\n\n${whatsappConfig.whatsappFooter}`
            : "";

        await sendWhatsapp(
          recipient.phone,
          body + footer
        );
      } catch (err) {
        console.error(
          `[notify:error] ${eventKey}: WhatsApp failed —`,
          err.response?.data
            ? JSON.stringify(
                err.response.data
              )
            : err.message
        );
      }
    }
  } catch (err) {
    // Never let notification failure
    // break the main request.
    console.error(
      `[notify:error] ${eventKey}:`,
      err.response?.data
        ? JSON.stringify(
            err.response.data
          )
        : err.message
    );
  }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  notify,
  sendBulkSms,
  sendSms,
  sendWhatsapp,
  sendTransactionalEmail,
};
