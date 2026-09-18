// GY Summit 2026 — M-Pesa payments
const { Router } = require("express");
const { z } = require("zod");
const { sequelize, Registration, Payment, User } = require("../models");
const { requireAuth } = require("../middleware/auth");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const { initiateStkPush, parseCallback, normalizePhone } = require("../services/mpesaService");
const { issueAdmissionCardForUser } = require("../services/admissionService");
const { getForm } = require("../services/settingsService");
const { notify } = require("../services/notificationService");

const router = Router();

router.post(
  "/initiate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = z.object({ phone: z.string().min(9) }).parse(req.body);

    // Payment Controls (Finance settings) — the admin can turn off M-Pesa
    // entirely (e.g. during a Daraja outage) without touching code.
    const controls = await getForm("paymentControlsForm");
    if (controls.enableMpesa === false) {
      throw new ApiError(503, "M-Pesa payments are temporarily disabled. Please try again later or contact an admin.");
    }

    const registration = await Registration.findOne({ where: { userId: req.auth.userId } });
    if (!registration) throw new ApiError(404, "No registration found");
    if (registration.status === "CONFIRMED") throw new ApiError(409, "Registration is already paid for");
    if (!registration.amountDue || registration.amountDue <= 0) throw new ApiError(400, "Select a ticket type before paying");

    const stk = await initiateStkPush({
      phone: body.phone,
      amount: registration.amountDue,
      accountReference: registration.id,
      description: "GY Summit 2026",
    });

    if (stk.ResponseCode !== "0") throw new ApiError(502, stk.ResponseDescription || "M-Pesa declined the request");

    const payment = await Payment.create({
      registrationId: registration.id,
      amount: registration.amountDue,
      phone: normalizePhone(body.phone),
      status: "PENDING",
      merchantRequestId: stk.MerchantRequestID,
      checkoutRequestId: stk.CheckoutRequestID,
    });

    res.status(202).json({
      message: "Check your phone and enter your M-Pesa PIN to complete payment.",
      paymentId: payment.id,
      checkoutRequestId: stk.CheckoutRequestID,
    });
  })
);

/** Public webhook — Safaricom Daraja posts the payment result here. */
router.post(
  "/callback",
  asyncHandler(async (req, res) => {
    const parsed = parseCallback(req.body);
    const payment = await Payment.findOne({ where: { checkoutRequestId: parsed.checkoutRequestId } });

    if (!payment) {
      console.warn("Received M-Pesa callback for unknown checkoutRequestId", parsed.checkoutRequestId);
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    if (parsed.success) {
      // Payment Controls > Require Manual Approval — when on, real money
      // received via M-Pesa is recorded immediately (payment.status =
      // SUCCESS) but the registration is deliberately left PENDING_PAYMENT
      // and no admission card is issued until an admin reviews it via
      // POST /admin/registrations/:id/approve. No schema change needed —
      // "awaiting approval" is just "payment SUCCESS + registration still
      // PENDING_PAYMENT", which the new admin endpoints query directly.
      const controls = await getForm("paymentControlsForm");
      const requiresManualApproval = controls.manualApproval === true;

      await sequelize.transaction(async (t) => {
        payment.status = "SUCCESS";
        payment.resultCode = parsed.resultCode;
        payment.resultDesc = parsed.resultDesc;
        payment.mpesaReceiptNumber = parsed.mpesaReceiptNumber;
        payment.rawCallback = req.body;
        await payment.save({ transaction: t });

        if (!requiresManualApproval) {
          const registration = await Registration.findByPk(payment.registrationId, { transaction: t });
          registration.status = "CONFIRMED";
          await registration.save({ transaction: t });
          await issueAdmissionCardForUser(registration.userId);

          const user = await User.findByPk(registration.userId, { transaction: t });
          notify("notifyPayment", "paymentTemplate", { email: user?.email, phone: user?.phone },
            "GY Summit 2026 — Payment received",
            { name: user?.fullName, amount: payment.amount, receipt: payment.mpesaReceiptNumber });
        }
      });
    } else {
      payment.status = parsed.resultCode === 1032 ? "CANCELLED" : "FAILED";
      payment.resultCode = parsed.resultCode;
      payment.resultDesc = parsed.resultDesc;
      payment.rawCallback = req.body;
      await payment.save();
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  })
);

router.get(
  "/:paymentId/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payment = await Payment.findByPk(req.params.paymentId, { include: [{ model: Registration, as: "registration" }] });
    if (!payment || payment.registration.userId !== req.auth.userId) throw new ApiError(404, "Payment not found");

    res.json({
      status: payment.status,
      resultDesc: payment.resultDesc,
      mpesaReceiptNumber: payment.mpesaReceiptNumber,
    });
  })
);

module.exports = router;
