// GY Summit 2026 — seeds the Githunguri Presbytery parish structure and
// creates your first SUPER_ADMIN account.
//
// Usage:
//   Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME / SEED_ADMIN_PHONE in .env
//   npm run seed
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { sequelize, Presbytery, Parish, Church, User, SportsTeam } = require("../models");

const PARISH_CHURCHES = {
  "Kagaa Parish": ["Kagaa Church"],
  "Githiga Parish": ["Githiga Church", "Kahuguini Church"],
  "Gathanji Parish": ["Gathanji Church", "Riabai Church"],
  "Gathangari Parish": ["Gathangari Church", "Gathiruini Church"],
  "Riara Ridge Parish": ["Riara Ridge Church"],
  "Matuguta Parish": ["Matuguta Church"],
  "Githunguri Parish": ["Githunguri Church", "Gitwe Church"],
  "Kahunira Parish": ["Kahunira Church"],
  "Gathaithi Parish": ["Gathaithi Church"],
  "Kamburu Parish": ["Kamburu Church"],
  "Karuthi Parish": ["Karuthi Church"],
};
const PARISHES = Object.keys(PARISH_CHURCHES);

async function seedChurchStructure() {
  const [presbytery] = await Presbytery.findOrCreate({
    where: { name: "Githunguri Presbytery" },
  });

  for (const name of PARISHES) {
    const [parish] = await Parish.findOrCreate({ where: { name, presbyteryId: presbytery.id } });
    for (const churchName of PARISH_CHURCHES[name]) {
      await Church.findOrCreate({ where: { name: churchName, parishId: parish.id } });
    }
  }
  const totalChurches = Object.values(PARISH_CHURCHES).reduce((sum, list) => sum + list.length, 0);
  console.log(`✅ Presbytery + ${PARISHES.length} parishes + ${totalChurches} churches ready.`);
}

const SPORTS_CATEGORIES = ["Football", "Volleyball", "Dance"];

async function seedSportsTeams() {
  const parishes = await Parish.findAll();
  let created = 0;
  for (const parish of parishes) {
    for (const category of SPORTS_CATEGORIES) {
      const [, wasCreated] = await SportsTeam.findOrCreate({
        where: { parishId: parish.id, category },
        defaults: { name: `${parish.name} ${category}`, gender: "MIXED" },
      });
      if (wasCreated) created++;
    }
  }
  console.log(`✅ ${created} new sports teams ready (${parishes.length} parishes × ${SPORTS_CATEGORIES.length} categories).`);
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const fullName = process.env.SEED_ADMIN_NAME || "Summit Administrator";
  const phone = process.env.SEED_ADMIN_PHONE || "0700000000";

  if (!email || !password) {
    console.log("⚠️  SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin creation.");
    return;
  }

  const existing = await User.findOne({ where: { email: email.toLowerCase() } });
  if (existing) {
    console.log(`Admin ${email} already exists (role: ${existing.role}). Nothing to do.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await User.create({
    email: email.toLowerCase(),
    phone,
    fullName,
    passwordHash,
    role: "SUPER_ADMIN",
  });
  console.log(`✅ Created SUPER_ADMIN: ${admin.email}`);
}

async function main() {
  await sequelize.authenticate();
  await seedChurchStructure();
  await seedSportsTeams();
  await seedAdmin();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
