// GY Summit 2026 — creates every table from the models in models/index.js
//
// Usage:  npm run db:sync
//
// This is the simplest way to get your database schema created. It uses
// Sequelize's `sync({ alter: true })`, which inspects your actual Postgres
// database and adds/adjusts tables and columns to match the models —
// safe to re-run any time you add a new field to a model.
require("dotenv").config();
const { sequelize } = require("../models");

async function main() {
  console.log("Connecting to Postgres...");
  await sequelize.authenticate();
  console.log("Connected. Creating/updating tables...");

  await sequelize.sync({ alter: true });

  console.log("✅ All tables are in place.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed to sync database:", err.message);
  process.exit(1);
});
