// GY Summit 2026 — forgot password
import { apiFetch, showError } from "./utils.js";

const form = document.getElementById("forgotForm");
const messageBox = document.getElementById("forgotMessage");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const submitBtn = form.querySelector('button[type="submit"]');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = "Sending...";
  }

  try {
    const { message } = await apiFetch("/auth/forgot-password", { method: "POST", body: { email } });
    form.style.display = "none";
    messageBox.style.display = "block";
    messageBox.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success, #16a34a);"></i> ${message}`;
  } catch (err) {
    showError(err.message || "Something went wrong. Please try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitBtn.dataset.originalText;
    }
  }
});
