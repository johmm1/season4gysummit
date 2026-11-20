// Y-Summit Season 4 2026 — auth middleware
const { verifyToken } = require("../services/jwtService");
const { User, ADMIN_ROLES } = require("../models");

const SESSION_COOKIE = "gys_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_ORIGINS = new Set([
  "https://githunguripresbytaryouthsummit.co.ke",
  "https://www.githunguripresbytaryouthsummit.co.ke",
  ...(process.env.FRONTEND_URL || "").split(",").map((value) => value.trim()).filter(Boolean),
]);

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const cookieToken = readCookie(req, SESSION_COOKIE);
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : cookieToken;
    if (!token) return res.status(401).json({ error: "Missing or malformed session" });

    // Cookie-authenticated writes require a trusted browser Origin. SameSite=Lax
    // is an additional CSRF barrier; legacy Bearer clients remain compatible.
    if (cookieToken && !SAFE_METHODS.has(req.method)) {
      const origin = req.get("origin");
      if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return res.status(403).json({ error: "Untrusted request origin" });
      }
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const user = await User.findByPk(payload.sub);
    if (!user) return res.status(401).json({ error: "No account found for this session" });
    if (!user.isActive) return res.status(403).json({ error: "Account has been deactivated" });

    req.auth = { userId: user.id, role: user.role, email: user.email };
    req.currentUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, ADMIN_ROLES };
