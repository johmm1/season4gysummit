// GY Summit 2026 — shared frontend utilities
import { CONFIG } from "./config.js";

const TOKEN_KEY = "gySummitToken";

/**
 * Calls the backend API, automatically attaching the current JWT (if any)
 * as a Bearer header. Throws an Error with a useful message on non-2xx
 * responses.
 */
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = {
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData) && typeof options.body !== "string"
        ? JSON.stringify(options.body)
        : options.body,
  });

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await res.json().catch(() => ({})) : null;

  if (!res.ok) {
    const message = payload?.error || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.details = payload?.details;
    throw error;
  }

  return payload;
}

/** Downloads a file response (PDF/xlsx) from the API, triggering a browser save. */
export async function apiDownload(path, filename) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Small toast notification — creates the container on first use. */
export function toast(message, type = "info", duration = 4000) {
  let container = document.getElementById("gySummitToastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "gySummitToastContainer";
    container.style.cssText =
      "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;";
    document.body.appendChild(container);
  }
  const colors = { info: "#2563eb", success: "#16a34a", error: "#dc2626", warning: "#d97706" };
  const el = document.createElement("div");
  el.textContent = message;
  el.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);font-size:14px;max-width:340px;font-family:inherit;`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

export function showError(message) {
  toast(message, "error");
}
export function showSuccess(message) {
  toast(message, "success");
}

/** Formats a number as KES currency, e.g. 1500 -> "KES 1,500". */
export function formatKes(amount) {
  return `KES ${Number(amount ?? 0).toLocaleString("en-KE")}`;
}

export function formatDate(dateLike) {
  if (!dateLike) return "—";
  return new Date(dateLike).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  return new Date(dateLike).toLocaleString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Runs an event countdown into the given element IDs (days/hours/minutes/seconds). */
export function startCountdown(targetDateIso, ids) {
  function tick() {
    const diff = new Date(targetDateIso).getTime() - Date.now();
    const clamp = (n) => String(Math.max(0, n)).padStart(2, "0");
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    if (ids.days) setText(ids.days, clamp(days));
    if (ids.hours) setText(ids.hours, clamp(hours));
    if (ids.minutes) setText(ids.minutes, clamp(minutes));
    if (ids.seconds) setText(ids.seconds, clamp(seconds));
  }
  tick();
  return setInterval(tick, 1000);
}

export function $(id) {
  return document.getElementById(id);
}

export function setText(id, value) {
  const el = typeof id === "string" ? $(id) : id;
  if (el) el.textContent = value;
}

export function setValue(id, value) {
  const el = typeof id === "string" ? $(id) : id;
  if (el && value !== undefined && value !== null) el.value = value;
}

export function on(id, event, handler) {
  const el = typeof id === "string" ? $(id) : id;
  if (el) el.addEventListener(event, handler);
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Formats a byte count as a human-readable size, e.g. 2_500_000 -> "2.5 MB". */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let value = n;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
