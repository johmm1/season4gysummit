// Y-Summit Season 4 2026 — additive schema upgrade run at server start.
//
// Creates the new admission-desk / report tables and adds the new
// Registration columns if they are missing. It only ever ADDS things, so
// it is safe on every boot and on a production database that already has
// data. This means a deploy no longer needs a manual `npm run db:sync`.
const { sequelize, Dormitory, GroupBankReference, Report, Registration } = require("../models");

async function addColumnIfMissing(model, column, definition) {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable(model.getTableName());
  if (!table[column]) {
    await qi.addColumn(model.getTableName(), column, definition);
    console.log(`[schema] added ${model.name}.${column}`);
  }
}

async function ensureSchema() {
  const { DataTypes } = require("sequelize");
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
    console.log("✅ Schema is up to date.");
  } catch (err) {
    // Never stop the API from booting over a migration problem — log it
    // loudly instead so it shows up in the Render logs.
    console.error("❌ Schema upgrade failed:", err.message);
  }
}

module.exports = { ensureSchema };
