// Y-Summit Season 4 2026 — login page (JWT-based)
import { apiFetch, showError, $ } from "./utils.js";
import { requireSession } from "./auth.js";
import { CONFIG } from "./config.js";

const ADMIN_ROLES = new Set([
  "SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN",
]);

// Explain why the user was returned to this page instead of silently
// showing the login form again.
const loginParams = new URLSearchParams(window.location.search);
if (loginParams.get("reason") === "session") {
  showError("Your session was rejected by the summit server. Please sign in again. If this repeats, contact the summit administrator.");
  window.history.replaceState({}, "", window.location.pathname);
}

// If already logged in, skip straight to the right dashboard.
const existingUser = await requireSession().catch(() => null);
if (existingUser) redirectForRole(existingUser);

initGoogleSignIn();

function initGoogleSignIn() {
  const container = $("googleSignInBtn");
  if (!container || !CONFIG.GOOGLE_CLIENT_ID) {
    container?.parentElement?.querySelector(".auth-divider")?.remove();
    if (container) container.style.display = "none";
    return;
  }

  const tryInit = () => {
    if (!window.google?.accounts?.id) return setTimeout(tryInit, 100);
    google.accounts.id.initialize({ client_id: CONFIG.GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    google.accounts.id.renderButton(container, { theme: "outline", size: "large", width: 320, text: "continue_with" });
  };
  tryInit();
}

async function handleGoogleCredential(response) {
  await completeLogin(() => apiFetch("/auth/google", {
    method: "POST",
    body: { credential: response.credential },
  }));
}

const form = $("loginForm");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const identifier = $("email").value.trim();
  const password = $("password").value;
  if (!identifier || !password) {
    showError("Enter your email or phone number and password.");
    return;
  }

  await completeLogin(() => apiFetch("/auth/login", {
    method: "POST",
    body: { identifier, password },
  }));
});

async function completeLogin(loginRequest) {
  const form = $("loginForm");
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText ||= submitBtn.textContent;
    submitBtn.textContent = "Signing in...";
  }

  try {
    const result = await loginRequest();
    if (!result?.user?.id || !result?.user?.role) {
      throw new Error("The server did not return a complete login session. Please try again.");
    }

    // Verify the newly issued token before navigating. This prevents the
    // dashboard from flashing briefly and then bouncing back to login.
    const verified = await apiFetch("/auth/me");
    if (!verified?.user?.id || verified.user.id !== result.user.id) {
      throw new Error("The server issued a login token but could not verify the account session.");
    }
    redirectForRole(verified.user);
  } catch (err) {
    console.error("Login/session verification failed:", err);
    showError(err.message || "Login failed. Check your email/phone and password, then try again.");
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || "Login";
    }
  }
}

function redirectForRole(user) {
  window.location.replace(user.role === "JUDGE" ? "admin/judges.html" : ADMIN_ROLES.has(user.role) ? "admin/dashboard.html" : "participant/dashboard.html");
}
