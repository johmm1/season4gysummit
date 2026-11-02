// Y-Summit Season 4 2026 — schema upgrade run at server start.
//
// Creates the admission-desk / report tables and adds the new
// Registration columns if they are missing, and removes the old UNIQUE rule on
// Users.email. It never deletes data, so
// it is safe on every boot and on a production database that already has
// data. This means a deploy no longer needs a manual `npm run db:sync`.
const { sequelize, Dormitory, GroupBankReference, Report, Registration, User, GalleryItem } = require("../models");

async function addColumnIfMissing(model, column, definition) {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable(model.getTableName());
  if (!table[column]) {
    await qi.addColumn(model.getTableName(), column, definition);
    console.log(`[schema] added ${model.name}.${column}`);
  }
}


// Email used to be UNIQUE. It no longer is (several youths may be registered
// under one parent's or chairperson's email — the phone number is the unique
// identity), so drop any uniqueness that is still enforced on Users.email.
// Sequelize can leave several differently-named copies behind, so find every
// single-column unique constraint / index on "email" rather than guessing names.
async function dropEmailUniqueness() {
  if (sequelize.getDialect() !== "postgres") return;
  const table = User.getTableName();
  const tableName = typeof table === "string" ? table : table.tableName;

  const [constraints] = await sequelize.query(
    `SELECT c.conname AS name
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = :table AND c.contype = 'u'
        AND array_length(c.conkey, 1) = 1 AND a.attname = 'email'`,
    { replacements: { table: tableName } }
  );
  for (const { name } of constraints) {
    await sequelize.query(`ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS "${name}"`);
    console.log(`[schema] dropped unique constraint ${name} on ${tableName}.email`);
  }

  const [indexes] = await sequelize.query(
    `SELECT i.relname AS name
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
      WHERE t.relname = :table AND x.indisunique AND NOT x.indisprimary
        AND x.indnatts = 1 AND a.attname = 'email'`,
    { replacements: { table: tableName } }
  );
  for (const { name } of indexes) {
    await sequelize.query(`DROP INDEX IF EXISTS "${name}"`);
    console.log(`[schema] dropped unique index ${name} on ${tableName}.email`);
  }

  // Plain (non-unique) index so logging in by email stays fast.
  await sequelize.query(`CREATE INDEX IF NOT EXISTS "users_email_lookup" ON "${tableName}" ("email")`);
}

async function ensureSchema() {
  const { DataTypes } = require("sequelize");
  // Create every table that does not exist yet (judge marks, teams, certificates...).
  // Older databases were set up by hand with `db:sync` before some tables
  // existed, and a missing table makes that whole page fail. This only ever
  // CREATES missing tables; it never alters or drops existing ones. It has its
  // own try/catch so a problem here cannot stop the steps below.
  try {
    await sequelize.sync();
    console.log("[schema] all tables present.");
  } catch (err) {
    console.error("[schema] could not create missing tables:", err.message);
  }

  try {
    // Create-if-missing only; never alters existing tables.
    await Dormitory.sync();
    await GroupBankReference.sync();
    await Report.sync();

    await addColumnIfMissing(Registration, "paidAt", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(Registration, "amountPaid", { type: DataTypes.INTEGER, allowNull: true });
    await addColumnIfMissing(Registration, "paidById", { type: DataTypes.UUID, allowNull: true });
    await addColumnIfMissing(Registration, "bankReferenceId", {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: GroupBankReference.getTableName(), key: "id" },
      onDelete: "SET NULL",
    });
    await addColumnIfMissing(Registration, "dormitoryId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: Dormitory.getTableName(), key: "id" },
      onDelete: "SET NULL",
    });
    await addColumnIfMissing(GalleryItem, "publicId", { type: DataTypes.STRING(255), allowNull: true });
    await addColumnIfMissing(GalleryItem, "resourceType", { type: DataTypes.STRING(20), allowNull: true });
    await dropEmailUniqueness();
    console.log("✅ Schema is up to date.");
  } catch (err) {
    // Never stop the API from booting over a migration problem — log it
    // loudly instead so it shows up in the Render logs.
    console.error("❌ Schema upgrade failed:", err.message);
  }
}

module.exports = { ensureSchema };
