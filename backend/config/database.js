require("dotenv").config();
const { Sequelize } = require("sequelize");

const {
  DATABASE_URL,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  DB_SSL,
  NODE_ENV,
} = process.env;

// Two ways to configure the database, both supported:
//
//   1. DATABASE_URL — a single Postgres connection string. This is how
//      Neon (and most modern Postgres hosts) hand you credentials, e.g.
//      postgres://user:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
//
//   2. DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD — split vars,
//      which is how Supabase's dashboard presents connection info.
//
// If DATABASE_URL is set, it wins. Otherwise the split vars are required.
let sequelize;

// A pooled (PgBouncer-style) connection needs a bigger pool of app-side
// connections and no session-level features (advisory locks, LISTEN/NOTIFY,
// temp tables — this app doesn't use any of those). Supabase signals this
// with port 6543; Neon signals it with a "-pooler" hostname instead, so we
// check for both rather than assuming Supabase's convention.
function detectPooler(hostOrUrl, port) {
  return String(port) === "6543" || /-pooler\./.test(String(hostOrUrl));
}

if (DATABASE_URL) {
  const usingPooler = detectPooler(DATABASE_URL, new URL(DATABASE_URL).port);

  sequelize = new Sequelize(DATABASE_URL, {
    dialect: "postgres",
    logging: NODE_ENV === "production" ? false : console.log,
    // Neon and Supabase both require SSL; DB_SSL=false opts out only for a
    // local/self-hosted Postgres reached via DATABASE_URL.
    dialectOptions: DB_SSL === "false" ? {} : { ssl: { require: true, rejectUnauthorized: false } },
    pool: { max: usingPooler ? 20 : 10, min: 0, acquire: 30000, idle: 10000 },
    define: { underscored: false },
  });
} else {
  const required = { DB_HOST, DB_PORT, DB_NAME, DB_USER };
  for (const [key, value] of Object.entries(required)) {
    if (!value) {
      throw new Error(
        `Missing required environment variable: ${key} (or set DATABASE_URL instead — see .env.example)`
      );
    }
  }

  const usingPooler = detectPooler(DB_HOST, DB_PORT);

  sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: parseInt(DB_PORT, 10),
    dialect: "postgres",
    logging: NODE_ENV === "production" ? false : console.log,
    dialectOptions: DB_SSL === "true" ? { ssl: { require: true, rejectUnauthorized: false } } : {},
    pool: { max: usingPooler ? 20 : 10, min: 0, acquire: 30000, idle: 10000 },
    define: { underscored: false },
  });
}

module.exports = { sequelize };
