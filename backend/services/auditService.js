// GY Summit 2026 — writes real entries to the AuditLog table.
// Previously this model existed in the schema but nothing ever wrote to it.
const { AuditLog } = require("../models");

/**
 * @param {string|null} actorId - the user performing the action (null for system/anonymous)
 * @param {string} action - short verb, e.g. "LOGIN", "SETTINGS_UPDATED", "ADMIN_CREATED"
 * @param {string} entityType - what was acted on, e.g. "auth", "settings", "gallery", "sports_roster"
 * @param {string} [entityId] - id of the affected record, if any
 * @param {object} [metadata] - any extra context (kept small — this is a JSON column)
 */
async function logAction(actorId, action, entityType, entityId, metadata) {
  try {
    await AuditLog.create({ actorId: actorId || null, action, entityType, entityId: entityId ? String(entityId) : null, metadata });
  } catch (err) {
    // Never let audit logging break the actual request.
    console.error("Audit log write failed:", err.message);
  }
}

module.exports = { logAction };
