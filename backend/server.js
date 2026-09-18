// GY Summit 2026 — server entry point
require("dotenv").config();
const app = require("./app");
const { sequelize } = require("./models");
const { checkEnv } = require("./config/validateEnv");

checkEnv();

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ Connected to Postgres.");
  } catch (err) {
    console.error("❌ Could not connect to Postgres:", err.message);
    console.error("   Check DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD, in .env");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`GY Summit 2026 API listening on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  });
}

start();
