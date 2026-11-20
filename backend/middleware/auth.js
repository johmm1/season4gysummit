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
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or malformed Authorization header" });
    }

    const token = header.slice("Bearer ".length);
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
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
