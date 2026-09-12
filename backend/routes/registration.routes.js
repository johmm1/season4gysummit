// GY Summit 2026 — registration & ticketing
const { Router } = require("express");
const { z } = require("zod");
const { Registration, Payment, GroupBankReference } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { getSetting } = require("../services/settingsService");

const router = Router();

const FALLBACK_TICKET_PRICE = parseInt(process.env.TICKET_PRICE || "1900", 10);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const registration = await Registration.findOne({
      where: { userId: req.auth.userId },
      include: [{ model: Payment, as: "payments" }],
    });
    if (!registration) throw new ApiError(404, "No registration found");
    res.json({ registration });
  })
);

const selectTicketSchema = z.object({
  groupCode: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

router.post(
  "/select-ticket",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = selectTicketSchema.parse(req.body);
    const registration = await Registration.findOne({ where: { userId: req.auth.userId } });
    if (!registration) throw new ApiError(404, "No registration found");
    if (registration.status === "CONFIRMED") throw new ApiError(409, "Registration is already confirmed");

    // There's only one ticket type now — this endpoint just lets a
    // participant attach a group code or notes; price is fixed at signup.
    const ticketPrice = await getSetting("generalSettingsForm", "registrationFee", FALLBACK_TICKET_PRICE);
    registration.amountDue = registration.amountDue || Number(ticketPrice);
    registration.groupCode = body.groupCode;
    registration.notes = body.notes;
    await registration.save();

    res.json({ registration });
  })
);

router.get(
  "/verify-bank-reference/:code",
  asyncHandler(async (req, res) => {
    const code = req.params.code.trim().toUpperCase();
    const ref = await GroupBankReference.findOne({ where: { code } });
    if (!ref || !ref.isActive) return res.json({ valid: false, availableSlots: 0, usedSlots: 0 });

    res.json({
      valid: ref.usedSlots < ref.totalSlots,
      parish: ref.parish,
      availableSlots: Math.max(0, ref.totalSlots - ref.usedSlots),
      usedSlots: ref.usedSlots,
      totalSlots: ref.totalSlots,
    });
  })
);

module.exports = router;
