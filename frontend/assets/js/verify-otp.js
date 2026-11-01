// Y-Summit Season 4 2026 — administrator email verification
import { apiFetch, showError, showSuccess } from "./utils.js";
import { setToken } from "./auth.js";

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN"]);

const params = new URLSearchParams(window.location.search);
const email = params.get("email");

const form = document.getElementById("verifyForm");
const messageBox = document.getElementById("verifyMessage");
const intro = document.getElementById("verifyIntro");

if (!email) {
  form.style.display = "none";
  messageBox.style.display = "block";
  messageBox.innerHTML = `We couldn't tell which account to verify. Please <a href="register.html">register</a> or <a href="login.html">log in</a> again.`;
} else {
  intro.textContent = "Enter the 6-digit code sent to your email to verify your administrator account.";
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
    const { token, user } = await apiFetch("/auth/verify-otp", { method: "POST", body: { email, otp } });
    setToken(token);

    window.location.href = user.role === "JUDGE" ? "admin/judges.html" : ADMIN_ROLES.has(user.role) ? "admin/dashboard.html" : "participant/dashboard.html";
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
    await apiFetch("/auth/resend-otp", { method: "POST", body: { email } });
    showSuccess("A new code is on its way.");
  } catch (err) {
    showError(err.message || "Couldn't resend right now — try again shortly.");
  } finally {
    link.textContent = original;
  }
});
