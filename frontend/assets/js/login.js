// GY Summit 2026 — login page (JWT-based)
import { apiFetch, showError, $ } from "./utils.js";
import { getToken, setToken, requireSession } from "./auth.js";
import { CONFIG } from "./config.js";

const ADMIN_ROLES = new Set([
  "SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN",
]);

// If already logged in, skip straight to the right dashboard.
if (getToken()) {
  const user = await requireSession().catch(() => null);
  if (user) redirectForRole(user);
}

initGoogleSignIn();

function initGoogleSignIn() {
  const container = $("googleSignInBtn");
  if (!container || !CONFIG.GOOGLE_CLIENT_ID) {
    // No client ID configured — just hide the button rather than show a
    // broken one. See frontend/assets/js/config.js.
    container?.parentElement?.querySelector(".auth-divider")?.remove();
    if (container) container.style.display = "none";
    return;
  }

  // google.accounts.id comes from the GSI script tag in login.html,
  // loaded with `async defer` — it may not be ready the instant this
  // module runs, so poll briefly rather than assuming it's there yet.
  const tryInit = () => {
    if (!window.google?.accounts?.id) return setTimeout(tryInit, 100);
    google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: 320, text: "continue_with" });
  };
  tryInit();
}

async function handleGoogleCredential(response) {
  try {
    const { token, user } = await apiFetch("/auth/google", {
      method: "POST",
      body: { credential: response.credential },
    });
    setToken(token);
    redirectForRole(user);
  } catch (err) {
    showError(err.message || "Google Sign-In failed.");
  }
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
