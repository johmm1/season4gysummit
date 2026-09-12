// GY Summit 2026 — reset password
import { apiFetch, showError } from "./utils.js";

const form = document.getElementById("resetForm");
const messageBox = document.getElementById("resetMessage");

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
const email = params.get("email");

if (!token || !email) {
  form.style.display = "none";
  messageBox.style.display = "block";
  messageBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> This reset link is missing information. Please request a new one from the <a href="forgot-password.html">forgot password page</a>.`;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (newPassword !== confirmPassword) {
    showError("Passwords don't match.");
    return;
  }
  if (newPassword.length < 8) {
    showError("Password must be at least 8 characters.");
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = "Resetting...";
  }

  try {
    await apiFetch("/auth/reset-password", { method: "POST", body: { email, token, newPassword } });
    form.style.display = "none";
    messageBox.style.display = "block";
    messageBox.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success, #16a34a);"></i> Password updated! <a href="login.html">Log in now</a>.`;
  } catch (err) {
    showError(err.message || "This reset link is invalid or has expired.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.originalText;
    }
  }
});
