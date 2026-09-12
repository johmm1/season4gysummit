# GY Summit 2026 — Event Registration & Management Platform

Full-stack platform for GY Summit 2026 (PCEA Githunguri Presbytery):
registration, M-Pesa payments, parish bank-reference bulk registration, QR
admission cards, gate check-in, admin dashboards for participants, finance,
announcements, gallery, and sports.

## Stack

- **Frontend:** HTML5, CSS3, vanilla JavaScript (ES modules) — no framework
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (Supabase)
- **ORM:** Sequelize
- **Auth:** JWT + bcrypt (your own, no third-party auth provider)
- **Image storage:** Cloudinary
- **Payments:** Safaricom Daraja API (STK Push)
- **QR/PDF:** `qrcode` + `pdfkit`

## Structure

```
GY-SUMMIT-2026/
├── backend/
│   ├── config/database.js       Sequelize connection
│   ├── models/index.js          All tables + associations
│   ├── middleware/              JWT auth guard, error handler
│   ├── routes/                  All API endpoints (auth, payments, admin, ...)
│   ├── services/                M-Pesa, QR, Cloudinary, JWT helpers
│   ├── database/sync.js         Creates all tables
│   ├── database/seed.js         Seeds parishes + your first admin
│   ├── app.js / server.js       Express app + entry point
│   └── .env.example
└── frontend/
    ├── assets/js/                Shared modules (config, auth, utils, ...)
    ├── admin/                    Admin dashboard pages
    ├── participant/              Participant dashboard pages
    └── index.html / login.html / register.html
```

## 1. Get a Postgres database (Supabase or Neon)

Supabase has a genuinely free Postgres tier — good enough to start with:

1. Sign up at supabase.com, create a new project (pick a strong database
   password when prompted — you'll need it in step 2)
2. Once it's ready, go to **Project Settings → Database → Connection info**
3. Use the **direct connection** values (not the pooler) unless you have a
   specific reason to need connection pooling:
   - Host: `db.<your-project-ref>.supabase.co`
   - Port: `5432`
   - Database: `postgres`
   - User: `postgres`
   - Password: the one you set in step 1 (Project Settings → Database has a
     "Reset database password" option if you've lost it)

(Any other Postgres host — Railway, Neon, a VPS — works the same way, you
just need those five values and `DB_SSL` set correctly for your host.)

## 2. Set up the backend

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — from step 1
- `DB_SSL=true` (Aiven requires SSL; if your host doesn't, set to `false`)
- `JWT_SECRET` — generate with `openssl rand -hex 32` (or see the comment in
  `.env.example` for a Windows PowerShell one-liner)
- `ADMISSION_QR_SECRET` — same, a separate random secret

Then:

```bash
npm install
npm run db:sync    # creates every table
npm run seed        # after setting SEED_ADMIN_* in .env — seeds parishes + your first admin
npm run dev          # http://localhost:4000
```

Health check: `GET http://localhost:4000/health`

### M-Pesa (Daraja) setup

1. Create an app at developer.safaricom.co.ke under "Lipa Na M-Pesa Online"
2. For local testing, expose your machine with `ngrok http 4000` and set
   `MPESA_CALLBACK_URL` to `https://<ngrok-id>.ngrok.io/api/payments/callback`
3. Use the published sandbox shortcode `174379` and its test passkey until
   you go live
4. Switch `MPESA_ENV=production` with your real paybill/till credentials
   when ready to charge real money

### Cloudinary (gallery + profile photos)

Free account at cloudinary.com — copy your Cloud Name, API Key, and API
Secret into `backend/.env`.

## 3. Set up the frontend

`frontend/assets/js/config.js` now auto-detects environment — on
`localhost`/`127.0.0.1` it uses your local backend automatically. For a
real deployment, open that file and set `PRODUCTION_API_URL` to your
deployed backend's URL (it's a single clearly-marked line near the top).

Serve it locally:

```bash
cd frontend
python3 -m http.server 5173
```

Open `http://localhost:5173`.

## 4. Deploy

**Backend → Render**: push this repo to GitHub, then in the Render
dashboard: New → Blueprint → connect the repo. Render reads `render.yaml`
at the repo root and creates the web service automatically — `JWT_SECRET`
and `ADMISSION_QR_SECRET` are auto-generated, everything else marked
`sync: false` you fill in from the dashboard after creation. The start
command runs `db:sync` before every boot, so tables are created/updated
automatically.

**Frontend → Vercel**: push `frontend/` to a repo (or point Vercel at this
repo with `frontend` as the root directory), import it — it's static
HTML, no build step. Update `FRONTEND_URL` on the backend to your Vercel
URL so CORS allows it.

After both are deployed: set `MPESA_CALLBACK_URL` on Render to your real
Render URL, and `PRODUCTION_API_URL` in `frontend/assets/js/config.js` to
your real Render URL, then redeploy the frontend.

## Auth model

There's no third-party auth provider. `POST /api/auth/register` hashes the
password with bcrypt and returns a JWT; `POST /api/auth/login` verifies it
and returns a JWT; the frontend stores that JWT in `localStorage` and sends
it as `Authorization: Bearer <token>` on every API call. Tokens expire after
`JWT_EXPIRES_IN` (default 7 days) — there's no refresh-token flow, so
expired sessions just redirect back to `login.html`.

## Church structure

`Presbytery` → `Parish` → `Church` are real tables now, not free text. The
presbytery and all 11 parishes are seeded automatically by `npm run seed`,
each with one starter church so registration works immediately. Add real
congregation names either by calling `POST /api/structure/churches` directly,
or build a small admin page for it (not included yet — see gaps below).

## What's implemented

- JWT-based signup/login, full multi-step registration form with a working
  parish → church cascading dropdown
- Two registration→payment paths: individual M-Pesa STK push, and parish
  bulk pre-payment via bank-reference codes (admin-issued, slot-limited)
- HMAC-signed QR admission cards, printable PDF pass, camera-based check-in
  scanner (html5-qrcode) with live attendance logging
- Announcements (admin CRUD, participant feed, pinning)
- Gallery (Cloudinary signed direct uploads, admin moderation)
- Sports (fixture creation, live score updates, computed standings)
- Admin dashboard stats, participant management with search/filter/drawer
- Finance: per-parish payment/admission breakdown, Excel export, revenue
  summary
- Admin settings: ~15 settings forms saved generically as JSON, admin
  account creation

## Known gaps / next steps

- **New admin accounts get a temporary password back in the API response**
  (shown to whoever created them) rather than emailed — email/SMS/WhatsApp
  sending now exists (`services/notificationService.js`) but the admin
  account creation endpoint isn't hooked into it yet.
- **WhatsApp free-form messages only reach someone who has messaged your
  business number first** (or within 24h of their last message) — that's
  a Meta platform rule, not a bug. Cold outreach (e.g. "your registration
  is confirmed" as the very first contact) needs a pre-approved message
  *template* set up in the Meta Business dashboard instead of plain text.
- **Sports bracket generator** supports 2, 4, or 8 teams (single
  elimination) — the current `round` schema (GROUP/QUARTER/SEMI/FINAL) has
  no Round-of-16 value, so a 16-team bracket is rejected with a clear
  error rather than silently mis-seeded.
- **Dance judging** stores one scorecard per judge per performance and
  computes a live weighted average — there's no dedicated admin UI screen
  for judges to enter scores yet (the endpoints exist:
  `POST/GET /api/sports/:id/dance-scores`, `GET /api/sports/dance-leaderboard`).
- **Profile edits don't support changing parish/church** yet — that field is
  display-only on `participant/profile.html`.
- `db:sync` (`sync({ alter: true })`) is used instead of versioned
  migrations — simpler, and fine for this project's size.

## Certificate signatures — how they actually work

This already works end-to-end, it's just not on the Settings page — it's
under **Gallery → Certificate Settings → Digital Signatures**:

1. Admin uploads a PNG signature (transparent background looks best) for
   Chairperson and/or Secretary.
2. It uploads straight to Cloudinary on file select, and the returned URL
   is saved into `digitalSignaturesForm` when the form is submitted.
3. `services/certificateService.js` fetches that URL, downloads the image,
   and draws it directly onto the generated certificate PDF above the
   signatory's typed name — so yes, the uploaded image *is* the signature
   that appears on issued certificates, not just a name.

Requires Cloudinary to be configured (`CLOUDINARY_*` env vars) — without
it the upload has nothing to upload to, and the certificate just falls
back to the typed name with no image.

## Do the previews work?

- **Certificate template preview** (Finance page → shows the
  Participation/Winner background images configured in Gallery →
  Certificate Settings) — yes, already real; it reads the actual saved
  template URLs.
- **Announcement preview button** — this one was a dead button with no
  click handler at all. Fixed: it now shows the draft's current title and
  formatted body in the same modal used to view a saved announcement,
  before you publish.

## SMS / WhatsApp / Bulk sending

- **SMS**: Brevo Transactional SMS API (`BREVO_API_KEY`/`BREVO_SMS_SENDER`
  in `.env`), reusing the same phone-normalization already used for
  M-Pesa. Brevo's SMS endpoint is single-recipient only, so publishing an
  announcement fires requests to every matching-audience participant's
  registration phone number with bounded concurrency (10 at a time)
  rather than one call per person sequentially — respecting the Enable
  SMS toggle, and one failed number never blocks the rest of the batch.
- **WhatsApp**: Brevo Transactional WhatsApp API
  (`BREVO_WHATSAPP_SENDER`, plus the same `BREVO_API_KEY` as SMS) — see
  the free-form vs. template caveat above; Brevo sits on top of WhatsApp
  Business, so the same 24-hour-session/approved-template rule from Meta
  still applies (`BREVO_WHATSAPP_TEMPLATE_ID`, optional).
- Every automatic notification (registration received, payment confirmed,
  admission card issued, certificate ready, announcement published) now
  sends to **the phone number given at registration**, on every channel
  that's both configured and turned on in Announcements settings.
- Leave the relevant env vars blank to keep a channel off — the app logs
  what it *would* have sent instead of failing.

## M-Pesa STK push on registration

The STK push now fires automatically as part of `POST /auth/register`
(standard registration, not the group/bank-reference path) instead of
needing a separate "Pay Now" step — the participant gets the M-Pesa PIN
prompt on their phone before the registration API call even returns. A
Daraja failure here (offline, bad credentials) never fails the
registration itself; the participant can still pay manually afterwards
from their dashboard the same way as before.

## Storage — Supabase (previously Cloudinary)

Gallery photos, profile photos, and admin-uploaded files (certificate
signatures, logos, stamps, templates) now go to **Supabase Storage**
instead of Cloudinary — same "signed direct upload from the browser"
pattern, different provider. One-time setup:

1. Supabase dashboard → **Storage** → New bucket → name it to match
   `SUPABASE_STORAGE_BUCKET` (defaults to `gy-summit-2026`) → toggle
   **Public bucket** on (uploaded files need to be viewable without
   another signed request).
2. Settings → API → copy the **Project URL** into `SUPABASE_URL` and the
   **service_role** secret key into `SUPABASE_SERVICE_ROLE_KEY`.

This is separate from `DATABASE_URL`/`DB_*` even if you're using Supabase
for both — the Storage API and the Postgres connection are different
credentials. I couldn't live-test the actual upload against a real
Supabase project (no internet access in this environment) — the exact
request/response shape was verified against Supabase's current docs, but
**test one real upload (e.g. a profile photo) right after deploying**. If
it fails, the most likely cause is the bucket not being set to public.

## Registration OTP verification

Self-registration now requires verifying an email or SMS code before the
account can log in — the participant picks the channel on the register
form. A few design choices worth knowing:

- **Every other account-creation path stays exempt.** `User.isVerified`
  defaults to `true` at the database level; `POST /auth/register` is the
  *only* place that explicitly sets it `false`. Admin-created accounts and
  the seed script's initial admin were never touched and stay usable
  immediately — this was deliberate specifically so a deploy of this
  change can't accidentally lock out existing/seeded accounts.
- Registration itself still succeeds immediately (ticket price, capacity
  and date checks, the M-Pesa STK push) — only *logging in* is gated on
  verification, via `POST /auth/verify-otp` (redeemed at
  `verify-otp.html`). `POST /auth/resend-otp` exists for expired/lost
  codes, with the same "same response either way" anti-enumeration
  pattern as forgot-password.
- Codes are 6 digits, expire in 10 minutes, and — like password reset —
  are sent via a path that ignores the Announcements "Enable Email/SMS"
  toggles, since account verification isn't an optional marketing
  channel.
- One known limitation: the profile-photo picker on the register form
  can't actually upload during registration anymore (there's no session
  token yet, since none is issued until verification) — the participant
  is told to add it afterwards from their profile page instead of the
  upload silently failing.

## Certificate bulk download (for printing)

Gallery → Certificate Centre now has a **"Download All as One PDF"**
control with type/category filters. It calls
`GET /api/admin/certificates/download-all` and streams back a single
multi-page PDF — one certificate per page, in one file — instead of an
admin opening and printing hundreds of individual participant PDFs one at
a time. Background images and signatures are fetched once per
certificate *type* and reused across every page of that type, not
re-downloaded per certificate.

## Forgot / reset password

`login.html`'s "Forgot Password?" link (previously dead, `href="#"`) now
goes to a real flow: `forgot-password.html` → emails a one-hour reset
link (`POST /auth/forgot-password`) → `reset-password.html` → sets a new
password (`POST /auth/reset-password`). A few things worth knowing:

- Both endpoints are rate-limited like login/register.
- The "does this email exist" question is never answered either way in
  the response — same generic message either way, to avoid letting
  someone enumerate registered participants by testing emails.
- Sends via `sendTransactionalEmail()`, which deliberately **ignores**
  Announcements → Notification Channels → Enable Email — password reset
  is account security, not a marketing/announcement toggle an admin
  should be able to switch off.
- Needs `SMTP_*` configured (see Email notifications above) — without it,
  the reset "succeeds" from the user's perspective but the email is only
  logged to the server console, same graceful-no-op pattern as everywhere
  else in this app.

## Settings that actually do something

Every settings form saves to the database correctly, but historically
almost none of them were ever read back outside the admin panel. These
are the ones wired to real effects so far:

| Setting (where) | Effect |
|---|---|
| Registration Fee (Dashboard → General) | Actual amount charged at signup |
| Registration Opens/Closes (Dashboard → General) | Registration API rejects outside this window |
| Maximum Participants (Dashboard → General) | Registration API rejects once full |
| Summit Name, Theme, Theme Verse, Venue, Event dates (Dashboard → General) | Shown on `index.html` (hero, countdown, info cards) |
| Social Media links (Dashboard) | Footer icons on `index.html` |
| Admission Code Prefix / Starting Number (Admissions) | Real prefix/sequence on issued admission cards |
| QR Code Size (Admissions) | Actual size of generated QR images |
| Registration Fee, Payment Deadline / Late Fee (Finance) | Added to the amount charged once the deadline passes |
| Enable M-Pesa / Enable Bank Reference (Finance → Payment Controls) | Registration/payment endpoints reject that method when off |
| Require Manual Approval (Finance → Payment Controls) | Successful M-Pesa payments wait for `POST /admin/registrations/:id/approve` instead of auto-confirming |
| Max Upload Size / Allowed Formats (Gallery) | Enforced on every upload |
| Auto-Publish / Require Approval (Gallery → Visibility) | Controls whether participant uploads need moderation |
| Allow Downloads (Gallery → Download Permissions) | Global master switch over every item's own downloadable flag |
| Public Gallery / Require Login (Gallery) | Gates the new unauthenticated `GET /api/gallery/public` feed |
| Enable Football / Volleyball / Dance (Sports → General) | New fixtures in a disabled category are rejected |
| Football Win/Draw Points (Sports → Football Rules) | Used by the new `GET /api/sports/standings` points table |
| Dance Scoring weights (Sports) | Used to compute every dance performance's weighted average live |
| Notification Channels / Auto Messages / Templates (Announcements) | Real email (Nodemailer), SMS (Brevo), and WhatsApp (Brevo) sent on registration, payment, admission, announcement publish, and certificate issuance |

Watermarking (Gallery) is still not wired — it needs an actual image
watermark uploaded and processed (e.g. via Cloudinary transformations),
which the settings form doesn't yet have real file-upload plumbing behind
it.
