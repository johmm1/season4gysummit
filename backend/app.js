// GY Summit 2026 — Express app
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { requestCounter } = require("./middleware/requestCounter");

const authRoutes = require("./routes/auth.routes");
const structureRoutes = require("./routes/structure.routes");
const registrationRoutes = require("./routes/registration.routes");
const paymentsRoutes = require("./routes/payments.routes");
const admissionRoutes = require("./routes/admission.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const announcementsRoutes = require("./routes/announcements.routes");
const galleryRoutes = require("./routes/gallery.routes");
const sportsRoutes = require("./routes/sports.routes");
const adminRoutes = require("./routes/admin.routes");
const financeRoutes = require("./routes/finance.routes");
const uploadsRoutes = require("./routes/uploads.routes");
const certificatesRoutes = require("./routes/certificates.routes");
const publicRoutes = require("./routes/public.routes");

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: (process.env.FRONTEND_URL || "").split(",").map((s) => s.trim()).filter(Boolean),
    credentials: true,
  })
);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

const globalLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);
app.use(requestCounter);

app.get("/health", (_req, res) => res.json({ ok: true, service: "gy-summit-2026-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/structure", structureRoutes);
app.use("/api/registration", registrationRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/admission", admissionRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/gallery", galleryRoutes);
app.use("/api/sports", sportsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/certificates", certificatesRoutes);
app.use("/api/public", publicRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
