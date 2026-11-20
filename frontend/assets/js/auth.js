// Y-Summit Season 4 2026 — auth guards and session helpers (JWT-based)
import { apiFetch } from "./utils.js";

const ADMIN_ROLES = new Set([
  "SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN",
]);

// Compatibility exports for older page modules. Session credentials are now HttpOnly cookies.
export function getToken() { return null; }
export function setToken(_token) { /* intentionally never persist credentials in browser storage */ }
export function clearToken() { /* the server clears the HttpOnly cookie on logout */ }

/**
 * Checks the saved session. A freshly issued token is checked twice because
 * a just-restarted API/database connection can briefly reject the first
 * profile request. Only confirmed authentication failures clear the token.
 */
export async function requireSession() {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { user } = await apiFetch("/auth/me");
      if (!user?.id || !user?.role) throw new Error("The server returned an incomplete account profile.");
      removeSessionError();
      return user;
    } catch (err) {
      lastError = err;
      console.error(`Session check failed (attempt ${attempt + 1}/2):`, err);
      if (err.status !== 401 || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (lastError?.status === 401 || lastError?.status === 403) {
    clearToken();
    redirectToLogin("session");
    return null;
  }

  // Keep the token on network, CORS, and server errors so users aren't
  // silently signed out when the API is temporarily unavailable.
  showSessionError(lastError?.message);
  return null;
}

function redirectToLogin(reason) {
  const target = resolvePath("login.html");
  if (/\/login\.html$/.test(window.location.pathname)) return;
  window.location.replace(reason ? `${target}?reason=${reason}` : target);
}

function showSessionError(message) {
  if (document.getElementById("sessionConnectionError")) return;
  const notice = document.createElement("div");
  notice.id = "sessionConnectionError";
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;z-index:10000;top:12px;left:12px;right:12px;max-width:560px;margin:0 auto;padding:16px;border-radius:10px;background:#fff4df;color:#663c00;border:1px solid #e6bd70;box-shadow:0 4px 18px rgba(0,0,0,.15);font:500 14px/1.5 system-ui,sans-serif;text-align:center;";
  const detail = message ? `<p style="margin:6px 0 0">${escapeText(message)}</p>` : "";
  notice.innerHTML = `<strong>Could not connect to the summit server.</strong><br>Your session has been kept. Check your internet connection and try again.${detail}<br><button type="button" id="retrySessionCheck" style="margin:10px 6px 0;padding:9px 16px;border:0;border-radius:7px;background:#663c00;color:white;font-weight:700;cursor:pointer">Try again</button>`;
  document.body.appendChild(notice);
  notice.querySelector("#retrySessionCheck").addEventListener("click", () => window.location.reload());
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function removeSessionError() {
  document.getElementById("sessionConnectionError")?.remove();
}

/** Like requireSession, but also bounces non-admins away from admin/* pages. */
export async function requireAdminSession() {
  const user = await requireSession();
  if (!user) return null;
  if (user.role === "JUDGE") {
    window.location.replace(resolvePath("admin/judges.html"));
    return null;
  }
  if (!ADMIN_ROLES.has(user.role)) {
    window.location.replace(resolvePath("participant/dashboard.html"));
    return null;
  }
  return user;
}

export async function logout() {
  try { await apiFetch("/auth/logout", { method: "POST" }); } catch (err) { console.warn("Session logout request failed:", err); }
  window.location.href = resolvePath("login.html");
}

function resolvePath(page) {
  const inSubfolder = /\/(admin|participant)\//.test(window.location.pathname);
  return inSubfolder ? `../${page}` : page;
}

export function wireLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (btn) btn.addEventListener("click", (e) => {
    e.preventDefault();
    logout();
  });
}
