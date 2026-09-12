// GY Summit 2026 — login page (JWT-based)
import { apiFetch, showError, $ } from "./utils.js";
import { getToken, setToken, requireSession } from "./auth.js";

const ADMIN_ROLES = new Set([
  "SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN",
]);

// If already logged in, skip straight to the right dashboard.
if (getToken()) {
  const user = await requireSession().catch(() => null);
  if (user) redirectForRole(user);
}

const form = $("loginForm");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  const submitBtn = form.querySelector('button[type="submit"]');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.textContent;
    submitBtn.textContent = "Signing in...";
  }

  try {
    const { token, user } = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
    setToken(token);
    redirectForRole(user);
  } catch (err) {
    if (err.status === 403 && err.message?.toLowerCase().includes("verify")) {
      // Account exists and the password was right, it just isn't verified
      // yet — send them straight to the code-entry page instead of a dead
      // end error.
      showError(err.message);
      setTimeout(() => {
        window.location.href = `verify-otp.html?email=${encodeURIComponent(email)}`;
      }, 1500);
    } else {
      showError(err.message || "Login failed. Check your email and password.");
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText;
    }
  }
});

function redirectForRole(user) {
  window.location.href = ADMIN_ROLES.has(user.role) ? "admin/dashboard.html" : "participant/dashboard.html";
}
