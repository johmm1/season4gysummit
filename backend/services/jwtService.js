// Y-Summit Season 4 2026 — JWT helpers
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("Missing required environment variable: JWT_SECRET");
}
// Explicitly pin the signing algorithm. This prevents accepting tokens
// signed with an unintended algorithm during verification.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { algorithm: "HS256", expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    // Existing 7-day sessions remain valid until their original expiry;
    // newly issued tokens use the shorter 12-hour default.
    maxAge: "7d",
  });
}

module.exports = { signToken, verifyToken };
