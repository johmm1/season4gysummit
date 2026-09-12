// GY Summit 2026 — M-Pesa Daraja STK Push client
const axios = require("axios");

const BASE_URL =
  process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  cachedToken = { token: data.access_token, expiresAt: Date.now() + parseInt(data.expires_in, 10) * 1000 };
  return cachedToken.token;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
  );
}

function password(ts) {
  return Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`).toString("base64");
}

function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return digits;
}

async function initiateStkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const ts = timestamp();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: normalizePhone(phone),
      PartyB: process.env.MPESA_SHORTCODE,
      PhoneNumber: normalizePhone(phone),
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountReference.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

function parseCallback(body) {
  const cb = body.Body.stkCallback;
  const items = cb.CallbackMetadata?.Item ?? [];
  const get = (name) => items.find((i) => i.Name === name)?.Value;

  return {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    success: cb.ResultCode === 0,
    amount: get("Amount"),
    mpesaReceiptNumber: get("MpesaReceiptNumber"),
    phone: get("PhoneNumber") ? String(get("PhoneNumber")) : undefined,
    transactionDate: get("TransactionDate"),
  };
}

module.exports = { initiateStkPush, parseCallback, normalizePhone };
