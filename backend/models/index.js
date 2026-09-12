// GY Summit 2026 — Sequelize models and associations
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

const ROLES = ["SUPER_ADMIN", "ADMIN", "FINANCE_ADMIN", "ADMISSIONS_ADMIN", "SPORTS_ADMIN", "GALLERY_ADMIN", "PARTICIPANT"];
const ADMIN_ROLES = ROLES.filter((r) => r !== "PARTICIPANT");

// ---- Church structure (dynamic dropdowns on register.html) ----

const Presbytery = sequelize.define("Presbytery", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
});

const Parish = sequelize.define("Parish", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
});

const Church = sequelize.define("Church", {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
});

// ---- Core ----

const User = sequelize.define("User", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  fullName: { type: DataTypes.STRING(120), allowNull: false },
  email: { type: DataTypes.STRING(160), allowNull: false, unique: true, validate: { isEmail: true } },
  phone: { type: DataTypes.STRING(20), allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING(100), allowNull: false },
  // Defaults to true so admin-created accounts (seed script, admin.routes.js
  // "create admin") stay usable without any extra step — /auth/register is
  // the ONLY place that explicitly overrides this to false before sending
  // an OTP, so self-registered participants are the only ones gated.
  isVerified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  otpHash: { type: DataTypes.STRING(64), allowNull: true },
  otpExpiresAt: { type: DataTypes.DATE, allowNull: true },
  otpChannel: { type: DataTypes.ENUM("email", "phone"), allowNull: true },
  resetTokenHash: { type: DataTypes.STRING(64), allowNull: true },
  resetTokenExpiresAt: { type: DataTypes.DATE, allowNull: true },
  role: { type: DataTypes.ENUM(...ROLES), allowNull: false, defaultValue: "PARTICIPANT" },
  presbyteryId: { type: DataTypes.INTEGER, allowNull: true },
  parishId: { type: DataTypes.INTEGER, allowNull: true },
  churchId: { type: DataTypes.INTEGER, allowNull: true },
  dateOfBirth: { type: DataTypes.DATEONLY, allowNull: true },
  gender: { type: DataTypes.ENUM("MALE", "FEMALE"), allowNull: true },
  idNumber: { type: DataTypes.STRING(20), allowNull: true },
  occupation: { type: DataTypes.STRING(120), allowNull: true },
  institution: { type: DataTypes.STRING(120), allowNull: true },
  emergencyContactName: { type: DataTypes.STRING(120), allowNull: true },
  emergencyContactPhone: { type: DataTypes.STRING(20), allowNull: true },
  hasMedicalCondition: { type: DataTypes.BOOLEAN, defaultValue: false },
  medicalCondition: { type: DataTypes.STRING(500), allowNull: true },
  medication: { type: DataTypes.STRING(500), allowNull: true },
  allergies: { type: DataTypes.STRING(500), allowNull: true },
  medicalNotes: { type: DataTypes.STRING(1000), allowNull: true },
  dietaryRequirements: { type: DataTypes.STRING(60), allowNull: true },
  disability: { type: DataTypes.STRING(500), allowNull: true },
  avatarUrl: { type: DataTypes.STRING(500), allowNull: true },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastLoginAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ fields: ["role"] }, { fields: ["presbyteryId"] }],
});

const GroupBankReference = sequelize.define("GroupBankReference", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  parish: { type: DataTypes.STRING(120), allowNull: false },
  totalSlots: { type: DataTypes.INTEGER, allowNull: false },
  usedSlots: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const Registration = sequelize.define("Registration", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  ticketType: { type: DataTypes.ENUM("STANDARD", "GROUP"), defaultValue: "STANDARD" },
  amountDue: { type: DataTypes.INTEGER, defaultValue: 0 },
  status: {
    type: DataTypes.ENUM("PENDING_PAYMENT", "CONFIRMED", "CANCELLED", "REFUNDED"),
    defaultValue: "PENDING_PAYMENT",
  },
  groupCode: { type: DataTypes.STRING(40), allowNull: true },
  notes: { type: DataTypes.STRING(500), allowNull: true },
}, {
  indexes: [{ fields: ["status"] }],
});

const Payment = sequelize.define("Payment", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  amount: { type: DataTypes.INTEGER, allowNull: false },
  phone: { type: DataTypes.STRING(20), allowNull: false },
  status: {
    type: DataTypes.ENUM("PENDING", "SUCCESS", "FAILED", "CANCELLED", "TIMEOUT"),
    defaultValue: "PENDING",
  },
  merchantRequestId: { type: DataTypes.STRING(80), allowNull: true, unique: true },
  checkoutRequestId: { type: DataTypes.STRING(80), allowNull: true, unique: true },
  mpesaReceiptNumber: { type: DataTypes.STRING(40), allowNull: true, unique: true },
  resultCode: { type: DataTypes.INTEGER, allowNull: true },
  resultDesc: { type: DataTypes.STRING(255), allowNull: true },
  rawCallback: { type: DataTypes.JSON, allowNull: true },
}, {
  indexes: [{ fields: ["status"] }],
});

const AdmissionCard = sequelize.define("AdmissionCard", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  qrCode: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  cardNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true },
  issuedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  isRevoked: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Attendance = sequelize.define("Attendance", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: { type: DataTypes.ENUM("CHECK_IN", "SESSION", "MEAL", "SPORTS"), defaultValue: "CHECK_IN" },
  label: { type: DataTypes.STRING(120), allowNull: true },
  scannedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
  indexes: [{ fields: ["type"] }, { fields: ["scannedAt"] }],
});

const Announcement = sequelize.define("Announcement", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  title: { type: DataTypes.STRING(150), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  audience: { type: DataTypes.JSON, allowNull: false, defaultValue: ["PARTICIPANT"] },
  // Narrows delivery further within the role(s) above — recorded here too
  // (not just used transiently at send time) so the admin list can show
  // who an announcement actually went to.
  parishId: { type: DataTypes.INTEGER, allowNull: true },
  sportsOnly: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  isPinned: { type: DataTypes.BOOLEAN, defaultValue: false },
  isPublished: { type: DataTypes.BOOLEAN, defaultValue: true },
  publishAt: { type: DataTypes.DATE, allowNull: true },
}, {
  indexes: [{ fields: ["isPublished"] }],
});

const GalleryItem = sequelize.define("GalleryItem", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  url: { type: DataTypes.STRING(500), allowNull: false },
  caption: { type: DataTypes.STRING(200), allowNull: true },
  albumName: { type: DataTypes.STRING(80), defaultValue: "General" },
  isApproved: { type: DataTypes.BOOLEAN, defaultValue: true },
  mediaType: { type: DataTypes.ENUM("photo", "video", "document"), defaultValue: "photo" },
  visibility: {
    type: DataTypes.ENUM("public", "participants", "committee", "private"),
    defaultValue: "public",
  },
  downloadable: { type: DataTypes.BOOLEAN, defaultValue: true },
  bytes: { type: DataTypes.BIGINT, allowNull: true },
});

const SportsEvent = sequelize.define("SportsEvent", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  category: { type: DataTypes.STRING(60), allowNull: false },
  gender: { type: DataTypes.ENUM("MALE", "FEMALE", "MIXED"), defaultValue: "MIXED" },
  startsAt: { type: DataTypes.DATE, allowNull: false },
  venue: { type: DataTypes.STRING(120), allowNull: false },
  status: { type: DataTypes.ENUM("SCHEDULED", "ONGOING", "COMPLETED", "CANCELLED"), defaultValue: "SCHEDULED" },
  scoreHome: { type: DataTypes.INTEGER, allowNull: true },
  scoreAway: { type: DataTypes.INTEGER, allowNull: true },
  teamHome: { type: DataTypes.STRING(80), allowNull: true },
  teamAway: { type: DataTypes.STRING(80), allowNull: true },
  round: { type: DataTypes.ENUM("GROUP", "QUARTER", "SEMI", "FINAL"), allowNull: true },
  group: { type: DataTypes.STRING(1), allowNull: true },
  bracketSlot: { type: DataTypes.STRING(10), allowNull: true },
}, {
  indexes: [{ fields: ["category"] }, { fields: ["startsAt"] }],
});

const SportsEntry = sequelize.define("SportsEntry", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  teamName: { type: DataTypes.STRING(80), allowNull: true },
}, {
  indexes: [{ unique: true, fields: ["sportsEventId", "userId"] }],
});

// A judge's scorecard for one dance performance (a SportsEvent with
// category="Dance"). Criteria weights are read live from
// danceScoringForm (Sports > Dance Scoring) when computing totals, rather
// than baked in here, so changing the weights in the admin UI re-scores
// every existing card automatically.
const DanceScore = sequelize.define("DanceScore", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  judgeName: { type: DataTypes.STRING(120), allowNull: false },
  themeScore: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  creativityScore: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  syncScore: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  presenceScore: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  costumeScore: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
  comments: { type: DataTypes.TEXT, allowNull: true },
}, {
  indexes: [{ unique: true, fields: ["sportsEventId", "judgeName"] }],
});

const SportsTeam = sequelize.define("SportsTeam", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  category: { type: DataTypes.STRING(60), allowNull: false },
  gender: { type: DataTypes.ENUM("MALE", "FEMALE", "MIXED"), defaultValue: "MIXED" },
  coachName: { type: DataTypes.STRING(120), allowNull: true },
  chairpersonName: { type: DataTypes.STRING(120), allowNull: true },
  chairpersonPhone: { type: DataTypes.STRING(20), allowNull: true },
}, {
  indexes: [{ fields: ["category"] }, { unique: true, fields: ["parishId", "category"] }],
});

const SportsTeamMember = sequelize.define("SportsTeamMember", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  position: { type: DataTypes.STRING(60), allowNull: true },
  jerseyNumber: { type: DataTypes.INTEGER, allowNull: true },
  isCaptain: { type: DataTypes.BOOLEAN, defaultValue: false },
  isEligible: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  indexes: [{ unique: true, fields: ["sportsTeamId", "userId"] }],
});

const Certificate = sequelize.define("Certificate", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  serial: { type: DataTypes.INTEGER, autoIncrement: true, unique: true },
  type: { type: DataTypes.ENUM("PARTICIPATION", "SPORTS_WINNER"), allowNull: false },
  category: { type: DataTypes.STRING(60), allowNull: true },
}, {
  indexes: [{ unique: true, fields: ["userId", "type", "category"] }],
});

const AuditLog = sequelize.define("AuditLog", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  action: { type: DataTypes.STRING(80), allowNull: false },
  entityType: { type: DataTypes.STRING(60), allowNull: false },
  entityId: { type: DataTypes.STRING(80), allowNull: true },
  metadata: { type: DataTypes.JSON, allowNull: true },
}, {
  indexes: [{ fields: ["entityType", "entityId"] }],
});

const SystemSetting = sequelize.define("SystemSetting", {
  key: { type: DataTypes.STRING(80), primaryKey: true },
  value: { type: DataTypes.JSON, allowNull: false },
}, { timestamps: true });

// A private, low-noise inbox for direct admin<->participant messages
// (covers the "messages" table from the project brief).
const Message = sequelize.define("Message", {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  subject: { type: DataTypes.STRING(150), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// ---- Associations ----

Presbytery.hasMany(Parish, { foreignKey: "presbyteryId" });
Parish.belongsTo(Presbytery, { foreignKey: "presbyteryId" });

Parish.hasMany(Church, { foreignKey: "parishId" });
Church.belongsTo(Parish, { foreignKey: "parishId" });

User.belongsTo(Presbytery, { foreignKey: "presbyteryId" });
User.belongsTo(Parish, { foreignKey: "parishId" });
User.belongsTo(Church, { foreignKey: "churchId" });

User.hasOne(Registration, { foreignKey: "userId", as: "registration", onDelete: "CASCADE" });
Registration.belongsTo(User, { foreignKey: "userId", as: "user" });

GroupBankReference.hasMany(Registration, { foreignKey: "bankReferenceId", as: "registrations" });
Registration.belongsTo(GroupBankReference, { foreignKey: "bankReferenceId", as: "bankReference" });

Registration.hasMany(Payment, { foreignKey: "registrationId", as: "payments", onDelete: "CASCADE" });
Payment.belongsTo(Registration, { foreignKey: "registrationId", as: "registration" });

User.hasOne(AdmissionCard, { foreignKey: "userId", as: "admissionCard", onDelete: "CASCADE" });
AdmissionCard.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Attendance, { foreignKey: "userId", as: "attendances", onDelete: "CASCADE" });
Attendance.belongsTo(User, { foreignKey: "userId", as: "user" });
AdmissionCard.hasMany(Attendance, { foreignKey: "admissionCardId", as: "attendances", onDelete: "CASCADE" });
Attendance.belongsTo(AdmissionCard, { foreignKey: "admissionCardId", as: "admissionCard" });
User.hasMany(Attendance, { foreignKey: "scannedById", as: "ScannedAttendances" });
Attendance.belongsTo(User, { foreignKey: "scannedById", as: "ScannedBy" });

User.hasMany(Announcement, { foreignKey: "authorId" });
Announcement.belongsTo(User, { foreignKey: "authorId", as: "author" });

User.hasMany(GalleryItem, { foreignKey: "uploadedById" });
GalleryItem.belongsTo(User, { foreignKey: "uploadedById", as: "uploadedBy" });

SportsEvent.hasMany(SportsEntry, { foreignKey: "sportsEventId", onDelete: "CASCADE" });
SportsEntry.belongsTo(SportsEvent, { foreignKey: "sportsEventId" });

SportsEvent.hasMany(DanceScore, { foreignKey: "sportsEventId", as: "danceScores", onDelete: "CASCADE" });
DanceScore.belongsTo(SportsEvent, { foreignKey: "sportsEventId" });
User.hasMany(SportsEntry, { foreignKey: "userId", onDelete: "CASCADE" });
SportsEntry.belongsTo(User, { foreignKey: "userId" });

Parish.hasMany(SportsTeam, { foreignKey: "parishId" });
SportsTeam.belongsTo(Parish, { foreignKey: "parishId" });
SportsTeam.hasMany(SportsTeamMember, { foreignKey: "sportsTeamId", as: "members", onDelete: "CASCADE" });
SportsTeamMember.belongsTo(SportsTeam, { foreignKey: "sportsTeamId" });
User.hasMany(SportsTeamMember, { foreignKey: "userId", onDelete: "CASCADE" });
SportsTeamMember.belongsTo(User, { foreignKey: "userId", as: "user" });

User.hasMany(Certificate, { foreignKey: "userId", onDelete: "CASCADE" });
Certificate.belongsTo(User, { foreignKey: "userId" });

User.hasMany(AuditLog, { foreignKey: "actorId" });
AuditLog.belongsTo(User, { foreignKey: "actorId", as: "actor" });

User.hasMany(Message, { foreignKey: "recipientId", as: "InboxMessages" });
Message.belongsTo(User, { foreignKey: "recipientId", as: "recipient" });
User.hasMany(Message, { foreignKey: "senderId", as: "SentMessages" });
Message.belongsTo(User, { foreignKey: "senderId", as: "sender" });

module.exports = {
  sequelize,
  ROLES,
  ADMIN_ROLES,
  Presbytery,
  Parish,
  Church,
  User,
  GroupBankReference,
  Registration,
  Payment,
  AdmissionCard,
  Attendance,
  Announcement,
  GalleryItem,
  SportsEvent,
  SportsEntry,
  SportsTeam,
  SportsTeamMember,
  DanceScore,
  Certificate,
  AuditLog,
  SystemSetting,
  Message,
};
