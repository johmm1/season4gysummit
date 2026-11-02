// Y-Summit Season 4 2026 — authentication (JWT + bcrypt)
const { Router } = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { z } = require("zod");
const { Op } = require("sequelize");
const rateLimit = require("express-rate-limit");
const { OAuth2Client } = require("google-auth-library");
const { sequelize, User, Registration, Presbytery, Parish, Church } = require("../models");
const { signToken } = require("../services/jwtService");
const { normalizePhone } = require("../services/phoneUtils");
const { logAction } = require("../services/auditService");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { getForm } = require("../services/settingsService");
const { notify, sendTransactionalEmail } = require("../services/notificationService");

// Fallback only — the real values come from the admin's General Settings
// (generalSettingsForm: registrationFee, maximumParticipants, registrationOpen/Close)
// via settingsService, so a change saved in the admin UI takes effect here
// immediately instead of requiring a redeploy.
const FALLBACK_TICKET_PRICE = parseInt(process.env.TICKET_PRICE || "2200", 10);

const router = Router();

// Login/register are the highest-value brute-force targets in the app, so
// they get a much tighter limit than the 300-req/min global default —
// 20 attempts per 15 minutes per IP, enough for a genuine user who
// mistypes a password a few times, not enough for credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Several participants may share one email address (a chairperson or parent
// registering youths who have no email of their own), so an email can match
// more than one account. The PHONE NUMBER is the unique identity, which is why
// people can also sign in / reset their password with their phone number.
async function findAccounts(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return [];
  if (id.includes("@")) {
    return User.findAll({ where: { email: id.toLowerCase() }, order: [["createdAt", "ASC"]], limit: 25 });
  }
  const user = await User.findOne({ where: { phone: normalizePhone(id) } });
  return user ? [user] : [];
}

const PHONE_TAKEN = "This phone number is already registered to another participant. Each participant needs their own phone number — use a parent's or guardian's number if they don't have one.";

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().min(9),
  presbyteryId: z.coerce.number().int().nullish(),
  parishId: z.coerce.number().int().nullish(),
  churchId: z.coerce.number().int().nullish(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().optional(),
  idNumber: z.string().max(20).optional(),
  hasMedicalCondition: z.coerce.boolean().optional(),
  medicalCondition: z.string().max(500).optional(),
  medication: z.string().max(500).optional(),
  allergies: z.string().max(500).optional(),
  medicalNotes: z.string().max(1000).optional(),
  disability: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const general = await getForm("generalSettingsForm");
    let ticketPrice = general.registrationFee !== undefined && general.registrationFee !== ""
      ? Number(general.registrationFee)
      : FALLBACK_TICKET_PRICE;
    const today = new Date().toISOString().slice(0, 10);
    if (general.registrationOpen && today < general.registrationOpen) throw new ApiError(403, `Registration opens on ${general.registrationOpen}.`);
    if (general.registrationClose && today > general.registrationClose) throw new ApiError(403, `Registration closed on ${general.registrationClose}.`);
    if (general.maximumParticipants && Number(general.maximumParticipants) > 0 && await Registration.count() >= Number(general.maximumParticipants)) throw new ApiError(409, "Registration is full.");
    if (await User.findOne({ where: { phone: normalizePhone(body.phone) } })) throw new ApiError(409, PHONE_TAKEN);
    const passwordHash = await bcrypt.hash(body.password, 12);
    const createdAccount = await sequelize.transaction(async (t) => {
      const created = await User.create({
        fullName: body.fullName, email: body.email.toLowerCase(), phone: normalizePhone(body.phone),
        passwordHash, presbyteryId: body.presbyteryId, parishId: body.parishId,
        churchId: body.churchId, dateOfBirth: body.dateOfBirth || null, gender: body.gender,
        emergencyContactName: body.emergencyContactName,
        emergencyContactPhone: body.emergencyContactPhone ? normalizePhone(body.emergencyContactPhone) : undefined,
        idNumber: body.idNumber, hasMedicalCondition: body.hasMedicalCondition ?? false,
        medicalCondition: body.medicalCondition, medication: body.medication, allergies: body.allergies,
        medicalNotes: body.medicalNotes, disability: body.disability, avatarUrl: body.avatarUrl, role: "PARTICIPANT",
      }, { transaction: t });
      const registration = await Registration.create({ userId: created.id, ticketType: "STANDARD", amountDue: ticketPrice, status: "CONFIRMED" }, { transaction: t });
      return { user: created, registration };
    });
    const { user, registration } = createdAccount;
    try {
      await Promise.resolve(notify("notifyRegistration", "registrationTemplate", { email: user.email, phone: user.phone },
        "Y-Summit Season 4 2026 — Registration received",
        { name: user.fullName, ticketType: registration.ticketType, amountDue: registration.amountDue })).catch((err) => {
          console.error("[register] notification failed:", err.message);
        });
    } catch (err) { console.error("[register] notification failed:", err.message); }
    try {
      await logAction(user.id, "REGISTER", "auth", user.id, { role: user.role });
    } catch (err) { console.error("[register] audit log failed:", err.message); }
    return res.status(201).json({ success: true, message: "Account successfully created.", token: signToken(user), user, registration });
  })
);

const loginSchema = z.object({
  identifier: z.string().trim().min(3).optional(),
  email: z.string().trim().min(3).optional(), // older clients send the email (or phone) here
  password: z.string().min(1),
}).refine((b) => b.identifier || b.email, { message: "Enter your email or phone number." });

router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const identifier = body.identifier || body.email;
    const accounts = await findAccounts(identifier);

    const matches = [];
    for (const account of accounts) {
      if (await bcrypt.compare(body.password, account.passwordHash)) matches.push(account);
    }

    if (!matches.length) {
      await logAction(accounts[0]?.id || null, "LOGIN_FAILED", "auth", accounts[0]?.id || null,
        { identifier, reason: accounts.length ? "bad_password" : "no_such_account" });
      throw new ApiError(401, "Invalid email/phone or password.");
    }
    if (matches.length > 1) {
      throw new ApiError(409, "More than one account uses this email and password. Sign in with the phone number of the account you want instead.");
    }

    const user = matches[0];
    if (!user.isActive) {
      await logAction(user.id, "LOGIN_FAILED", "auth", user.id, { reason: "account_deactivated" });
      throw new ApiError(403, "This account has been deactivated.");
    }

    user.lastLoginAt = new Date();
    await user.save();
    await logAction(user.id, "LOGIN", "auth", user.id, { role: user.role });

    const token = signToken(user);
    res.json({ token, user });
  })
);

// ---- Google Sign-In ----
//
// This is a LOGIN method, not a registration method: it only works for
// someone who has already registered normally (phone, parish, church —
// all still required and none of that comes from Google). A Google
// sign-in just proves "I own this email address" and, if that email
// matches an existing verified account, issues the same kind of session
// token the password login does. If no account matches, it says so
// plainly rather than silently creating an incomplete account that's
// missing required registration fields.
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

const googleLoginSchema = z.object({ credential: z.string().min(20) });

router.post(
  "/google",
  authLimiter,
  asyncHandler(async (req, res) => {
    if (!googleClient) {
      throw new ApiError(503, "Google Sign-In isn't configured yet.");
    }
    const { credential } = googleLoginSchema.parse(req.body);

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw new ApiError(401, "Google Sign-In failed — that token couldn't be verified.");
    }
    if (!payload?.email || !payload.email_verified) {
      throw new ApiError(401, "That Google account's email isn't verified.");
    }

    const matching = await User.findAll({ where: { email: payload.email.toLowerCase() }, limit: 2 });
    if (matching.length > 1) {
      throw new ApiError(409, "More than one account uses this email, so Google Sign-In can't tell which one you mean. Sign in with your phone number and password instead.");
    }
    const user = matching[0];
    if (!user) {
      // Same reasoning as elsewhere in this file: don't reveal whether an
      // email is registered to an unauthenticated caller. Here the caller
      // HAS proven ownership of the email (via Google), so it's safe to
      // say plainly that there's no account — this isn't an enumeration
      // risk the way it would be for a bare email address.
      throw new ApiError(404, `No Y-Summit account found for ${payload.email}. Register first, then Google Sign-In will work.`);
    }
    if (!user.isActive) {
      await logAction(user.id, "LOGIN_FAILED", "auth", user.id, { reason: "account_deactivated", via: "google" });
      throw new ApiError(403, "This account has been deactivated.");
    }
    user.lastLoginAt = new Date();
    await user.save();
    await logAction(user.id, "LOGIN", "auth", user.id, { role: user.role, via: "google" });

    const token = signToken(user);
    res.json({ token, user });
  })
);

const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3).optional(),
  email: z.string().trim().min(3).optional(), // older clients send the email (or phone) here
}).refine((b) => b.identifier || b.email, { message: "Enter your email or phone number." });

router.post(
  "/forgot-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = forgotPasswordSchema.parse(req.body);
    const accounts = (await findAccounts(body.identifier || body.email)).filter((a) => a.isActive && a.email);

    // Always respond the same way whether or not an account exists —
    // confirming/denying one here would let someone enumerate participants.
    const genericResponse = { message: "If an account exists, a reset link has been sent to its email address." };

    if (accounts.length) {
      // FRONTEND_URL may list several origins; use the first. If it's missing,
      // fall back to the site the request came from so the link still works.
      const frontendUrl = ((process.env.FRONTEND_URL || "").split(",")[0].trim() || req.get("origin") || "").replace(/\/$/, "");

      // Accounts that share an email get ONE email with a separate link per
      // account, so each person resets only their own password.
      const byEmail = new Map();
      for (const user of accounts) {
        const rawToken = crypto.randomBytes(32).toString("hex");
        user.resetTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        user.resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save();
        const link = `${frontendUrl}/reset-password.html?token=${rawToken}&uid=${user.id}&email=${encodeURIComponent(user.email)}`;
        if (!byEmail.has(user.email)) byEmail.set(user.email, []);
        byEmail.get(user.email).push({ user, link });
        await logAction(user.id, "PASSWORD_RESET_REQUESTED", "auth", user.id, {});
      }

      for (const [email, entries] of byEmail) {
        const text = entries.length === 1
          ? `Hi ${entries[0].user.fullName},\n\nSomeone (hopefully you) asked to reset your Y-Summit Season 4 2026 password. This link is valid for 1 hour:\n\n${entries[0].link}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`
          : `Hello,\n\nMore than one Y-Summit Season 4 2026 account uses this email address. Open the link for the account you want to reset (each is valid for 1 hour):\n\n${entries.map((e) => `${e.user.fullName} (${e.user.phone}):\n${e.link}`).join("\n\n")}\n\nIf you didn't request this, you can safely ignore this email — no password will change.`;
        try {
          await sendTransactionalEmail(email, "Y-Summit Season 4 2026 — Reset your password", text);
        } catch (err) {
          // Don't leak send failures to the client — just log for the admin
          // to notice (e.g. SMTP misconfigured).
          console.error("[forgot-password] failed to send reset email:", err.message);
        }
      }
    }

    res.json(genericResponse);
  })
);

const resetPasswordSchema = z.object({
  uid: z.string().uuid().optional(),
  email: z.string().email().optional(),
  token: z.string().min(20),
  newPassword: z.string().min(8),
}).refine((b) => b.uid || b.email, { message: "This reset link is incomplete." });

router.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    const candidates = body.uid
      ? [await User.findByPk(body.uid)]
      : await User.findAll({ where: { email: body.email.toLowerCase() }, limit: 25 });

    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const user = candidates.find((u) => u && u.resetTokenHash === tokenHash && u.resetTokenExpiresAt && u.resetTokenExpiresAt > new Date());
    if (!user) throw new ApiError(400, "This reset link is invalid or has expired. Please request a new one.");

    user.passwordHash = await bcrypt.hash(body.newPassword, 12);
    user.resetTokenHash = null;
    user.resetTokenExpiresAt = null;
    await user.save();
    await logAction(user.id, "PASSWORD_RESET_COMPLETED", "auth", user.id, {});

    try {
      await sendTransactionalEmail(
        user.email,
        "Y-Summit Season 4 2026 — Your password was changed",
        `Hi ${user.fullName},\n\nYour Y-Summit Season 4 2026 password was just changed. If this wasn't you, please contact an admin immediately.`
      );
    } catch (err) {
      console.error("[reset-password] failed to send confirmation email:", err.message);
    }

    res.json({ message: "Password updated. You can now log in." });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.auth.userId, {
      include: [
        { model: Registration, as: "registration" },
        { model: Presbytery },
        { model: Parish },
        { model: Church },
      ],
    });
    if (!user) throw new ApiError(404, "User not found");
    res.json({ user });
  })
);

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().min(9).optional(),
  parishId: z.coerce.number().int().nullish(),
  churchId: z.coerce.number().int().nullish(),
  occupation: z.string().max(120).optional(),
  institution: z.string().max(120).optional(),
  emergencyContactName: z.string().max(120).optional(),
  emergencyContactPhone: z.string().optional(),
  medicalCondition: z.string().max(500).optional(),
  allergies: z.string().max(500).optional(),
  medicalNotes: z.string().max(1000).optional(),
  dietaryRequirements: z.string().max(60).optional(),
  disability: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
});

router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = updateProfileSchema.parse(req.body);
    if (body.phone) body.phone = normalizePhone(body.phone);
    if (body.emergencyContactPhone) body.emergencyContactPhone = normalizePhone(body.emergencyContactPhone);

    if (body.phone) {
      const taken = await User.findOne({ where: { phone: body.phone, id: { [Op.ne]: req.auth.userId } }, attributes: ["id"] });
      if (taken) throw new ApiError(409, PHONE_TAKEN);
    }

    await User.update(body, { where: { id: req.auth.userId } });
    const user = await User.findByPk(req.auth.userId);
    res.json({ user });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    const user = await User.findByPk(req.auth.userId);
    const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!valid) throw new ApiError(401, "Current password is incorrect.");

    user.passwordHash = await bcrypt.hash(body.newPassword, 12);
    await user.save();
    res.json({ ok: true });
  })
);

module.exports = router;
