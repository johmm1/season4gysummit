// GY Summit 2026 — auth middleware
const { verifyToken } = require("../services/jwtService");
const { User, ADMIN_ROLES } = require("../models");

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
