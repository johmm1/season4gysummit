// GY Summit 2026 — OTP verification (after registration, or after a
// "please verify your account" login block)
import { apiFetch, showError, showSuccess } from "./utils.js";
import { setToken } from "./auth.js";

const params = new URLSearchParams(window.location.search);
const email = params.get("email");
const channel = params.get("channel") || "email";

const form = document.getElementById("verifyForm");
const messageBox = document.getElementById("verifyMessage");
const intro = document.getElementById("verifyIntro");

if (!email) {
  form.style.display = "none";
  messageBox.style.display = "block";
  messageBox.innerHTML = `We couldn't tell which account to verify. Please <a href="register.html">register</a> or <a href="login.html">log in</a> again.`;
} else {
  intro.textContent = `Enter the 6-digit code we sent to your ${channel === "phone" ? "phone" : "email"}.`;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const otp = document.getElementById("otp").value.trim();
  const submitBtn = form.querySelector('button[type="submit"]');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = "Verifying...";
  }

  try {
    const { token } = await apiFetch("/auth/verify-otp", { method: "POST", body: { email, otp } });
    setToken(token);

    if (sessionStorage.getItem("gySummitAddPhotoReminder")) {
      sessionStorage.removeItem("gySummitAddPhotoReminder");
      showSuccess("Verified! Don't forget to add your profile photo from your profile page.");
    } else {
      showSuccess("Verified! Taking you to your dashboard...");
    }
    window.location.href = "participant/dashboard.html";
  } catch (err) {
    showError(err.message || "That code didn't work. Please try again or resend.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.originalText;
    }
  }
});

document.getElementById("resendOtpLink")?.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!email) return;
  const link = e.target;
  const original = link.textContent;
  link.textContent = "Sending...";
  try {
    await apiFetch("/auth/resend-otp", { method: "POST", body: { email, channel } });
    showSuccess("A new code is on its way.");
  } catch (err) {
    showError(err.message || "Couldn't resend right now — try again shortly.");
  } finally {
    link.textContent = original;
  }
});
