// GY Summit 2026 — issues an admission card once a registration is CONFIRMED
const { AdmissionCard, User } = require("../models");
const { signAdmissionToken, generateCardNumber } = require("./qrService");
const { getForm } = require("./settingsService");
const { notify } = require("./notificationService");

async function issueAdmissionCardForUser(userId) {
  const existing = await AdmissionCard.findOne({ where: { userId } });
  if (existing) return existing;

  // Admissions > Admission Code Prefix / Starting Admission Number, set in
  // the admin UI, previously had no effect — cards always came out "GY26-000001"
  // regardless of what was saved. Read them here so the setting is real.
  const admissionSettings = await getForm("admissionSettingsForm");
  const prefix = admissionSettings.admissionPrefix || "GY26";
  const startNumber = Number(admissionSettings.admissionStartNumber) || 1;

  const count = await AdmissionCard.count();
  const cardNumber = generateCardNumber(startNumber + count, prefix);
  const qrCode = signAdmissionToken(userId);

  const card = await AdmissionCard.create({ userId, qrCode, cardNumber });

  const user = await User.findByPk(userId, { attributes: ["fullName", "email", "phone"] });
  notify("notifyAdmission", "admissionTemplate", { email: user?.email, phone: user?.phone },
    "GY Summit 2026 — Your admission card is ready",
    { name: user?.fullName, cardNumber });

  return card;
}

module.exports = { issueAdmissionCardForUser };
