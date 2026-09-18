// GY Summit 2026 — auth guards and session helpers (JWT-based)
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
 * Ensures there's a logged-in session, fetches the current profile from our
 * API, and redirects to /login.html if not. Call this at the top of every
 * protected page.
 */
export async function requireSession() {
  if (!getToken()) {
    window.location.href = resolvePath("login.html");
    return null;
  }
  try {
    const { user } = await apiFetch("/auth/me");
    return user;
  } catch (err) {
    console.error("Failed to load profile:", err);
    clearToken();
    window.location.href = resolvePath("login.html");
    return null;
  }
}

/** Like requireSession, but also bounces non-admins away from admin/* pages. */
export async function requireAdminSession() {
  const user = await requireSession();
  if (!user) return null;
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
