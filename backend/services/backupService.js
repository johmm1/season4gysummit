// GY Summit 2026 — real database backups via `pg_dump` (Postgres/Supabase).
// Files are written to backend/backups/ (gitignored) and listed/streamed from
// there — no fake "backup history" rows, only files that genuinely exist.
//
// Note: pg_dump needs a normal session connection. If your DB_PORT is set to
// Supabase's pooler (6543), backups may fail or time out — the direct
// connection (port 5432) is what Supabase recommends for pg_dump/pg_restore.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BACKUP_DIR = path.join(__dirname, "..", "backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function runBackup() {
  ensureBackupDir();
  const { DATABASE_URL, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `gy-summit-2026-${timestamp}.sql`;
  const filepath = path.join(BACKUP_DIR, filename);

  return new Promise((resolve, reject) => {
    // pg_dump accepts a connection URI directly — simplest way to support
    // both DATABASE_URL (Neon) and the split DB_* vars (Supabase) without
    // duplicating the "which one is set" logic that already lives in
    // config/database.js. The password is stripped out of the URI and
    // passed via PGPASSWORD instead, same as the split-vars path below —
    // a CLI argument is visible to anyone who can run `ps` on this server,
    // an env var passed straight to the child process isn't.
    const env = { ...process.env };
    let args;
    if (DATABASE_URL) {
      const parsed = new URL(DATABASE_URL);
      if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
      parsed.password = "";
      args = [parsed.toString(), "--no-owner", "--no-privileges"];
    } else {
      args = [
        `--host=${DB_HOST}`,
        `--port=${DB_PORT || 5432}`,
        `--username=${DB_USER}`,
        `--dbname=${DB_NAME}`,
        "--no-owner",
        "--no-privileges",
      ];
      if (DB_PASSWORD) env.PGPASSWORD = DB_PASSWORD;
    }

    const dump = spawn("pg_dump", args, { env });
    const out = fs.createWriteStream(filepath);
    dump.stdout.pipe(out);

    let stderr = "";
    dump.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    dump.on("error", (err) => {
      // Most commonly: pg_dump isn't installed / not on PATH.
      reject(new Error(`pg_dump could not run: ${err.message}`));
    });

    dump.on("close", (code) => {
      if (code !== 0) {
        fs.unlink(filepath, () => {});
        reject(new Error(stderr.trim() || `pg_dump exited with code ${code}`));
        return;
      }
      resolve(filename);
    });
  });
}

function listBackups() {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, bytes: stat.size, createdAt: stat.birthtime };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getBackupPath(filename) {
  // Prevent path traversal — only allow the exact filenames this module generates.
  if (!/^gy-summit-2026-[\w-]+\.sql$/.test(filename)) return null;
  const filepath = path.join(BACKUP_DIR, filename);
  return fs.existsSync(filepath) ? filepath : null;
}

module.exports = { runBackup, listBackups, getBackupPath };
