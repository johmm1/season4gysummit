// Y-Summit Season 4 2026 — error handling
const { ZodError } = require("zod");

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }

  if (err.name === "SequelizeUniqueConstraintError") {
    const fields = [...new Set((err.errors || []).map((item) => item.path).filter(Boolean))];
    const label = fields.includes("email") ? "email address" : fields.includes("phone") ? "phone number" : fields.length ? fields.join(", ") : "value";
    return res.status(409).json({ error: `That ${label} is already registered. Please check the details or sign in.`, details: err.errors?.map((e) => e.message) });
  }
  if (err.name === "SequelizeValidationError") {
    return res.status(400).json({ error: "Validation failed", details: err.errors?.map((e) => e.message) });
  }

  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ error: "That file is too large." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed request body." });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV === "production" ? {} : { debug: err.message }),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, notFoundHandler, errorHandler, asyncHandler };
