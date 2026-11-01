// Y-Summit Season 4 2026 — auth guards and session helpers (JWT-based)
import { apiFetch } from "./utils.js";

const TOKEN_KEY = "gySummitToken";
const ADMIN_ROLES = new Set([
  "SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN",
]);

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Ensures there's a logged-in session and fetches the current profile.
 * Only authentication failures invalidate the saved token. Network, CORS,
 * and server errors leave it intact and show a retry message.
 */
export async function requireSession() {
  if (!getToken()) {
    window.location.href = resolvePath("login.html");
    return null;
  }
  try {
    const { user } = await apiFetch("/auth/me");
    removeSessionError();
    return user;
  } catch (err) {
    console.error("Failed to load profile:", err);

    // /auth/me returns 401 for an invalid/expired session and 403 when the
    // account has been deactivated. Other failures may be temporary.
    if (err.status === 401 || err.status === 403) {
      clearToken();
      window.location.href = resolvePath("login.html");
      return null;
    }

    showSessionError();
    return null;
  }
}

function showSessionError() {
  let notice = document.getElementById("sessionConnectionError");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "sessionConnectionError";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;z-index:10000;top:12px;left:12px;right:12px;max-width:560px;margin:0 auto;padding:16px;border-radius:10px;background:#fff4df;color:#663c00;border:1px solid #e6bd70;box-shadow:0 4px 18px rgba(0,0,0,.15);font:500 14px/1.5 system-ui,sans-serif;text-align:center;";
    notice.innerHTML = '<strong>Could not connect to the summit server.</strong><br>Your login has been kept. Check your internet connection and try again. <button type="button" id="retrySessionCheck" style="margin:10px 6px 0;padding:9px 16px;border:0;border-radius:7px;background:#663c00;color:white;font-weight:700;cursor:pointer">Try again</button>';
    document.body.appendChild(notice);
    notice.querySelector("#retrySessionCheck").addEventListener("click", () => window.location.reload());
  }
}

function removeSessionError() {
  document.getElementById("sessionConnectionError")?.remove();
}

/** Like requireSession, but also bounces non-admins away from admin/* pages. */
export async function requireAdminSession() {
  const user = await requireSession();
  if (!user) return null;
  if (user.role === "JUDGE") {
    window.location.href = resolvePath("admin/judges.html");
    return null;
  }
  if (!ADMIN_ROLES.has(user.role)) {
    window.location.href = resolvePath("participant/dashboard.html");
    return null;
  }
  return user;
}

export function logout() {
  clearToken();
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
