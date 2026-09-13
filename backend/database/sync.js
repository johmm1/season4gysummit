// GY Summit 2026 — creates every table from the models in models/index.js
//
// Usage:  npm run db:sync
//
// Tries sync({ alter: true }) first — this inspects your actual Postgres
// database and adjusts tables/columns to match the models, so it's safe
// to re-run any time you add a new field to a model. If the tables
// already exist and match the models exactly, alter has nothing to do,
// but a known Sequelize+Postgres bug can still make it fail while
// double-checking an autoIncrement id column: it tries to ALTER a
// column's type to "SERIAL", which isn't a real Postgres type — only
// valid in CREATE TABLE — so Postgres correctly rejects it. When that
// exact failure happens, falling back to a plain sync() (create any
// missing tables, touch nothing that already exists) gets you unstuck
// without needing to alter anything that wasn't actually going to change.
require("dotenv").config();
const { sequelize } = require("../models");

async function main() {
  console.log("Connecting to Postgres...");
  await sequelize.authenticate();
  console.log("Connected. Creating/updating tables...");

  try {
    await sequelize.sync({ alter: true });
  } catch (err) {
    if (err.message.includes('type "serial" does not exist')) {
      console.warn("⚠️  Hit the known Sequelize/Postgres alter+autoIncrement bug — falling back to a plain sync() instead.");
      await sequelize.sync();
    } else {
      throw err;
    }
  }

  console.log("✅ All tables are in place.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed to sync database:", err.message);
  process.exit(1);
});
