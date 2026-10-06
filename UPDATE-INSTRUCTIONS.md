# How to update your repo with this version

## 1. Put the new files in your repo
From the folder that holds your repo (where `.git` is):

```bash
# unzip over the top, overwriting old files
unzip -o gy2026-rebrand-ysummit-poster-colours.zip -d .

git checkout -b judges-folksong-emails
git status                      # review what changed
git add -A
git commit -m "Poster rebrand, groups/fixtures planner, Folk Song, judges platform, email fixes, new About image"
git push -u origin judges-folksong-emails
```
Open a pull request on GitHub, check it, then merge to `main`.
(Make sure `backend/.env` is NOT in the folder you commit; only `.env.example` should be.)

## 2. Update the database (one time, after deploying the backend)
This version adds a `JUDGE` role and a `JudgeScores` table.

```bash
cd backend
npm run db:sync
```
If it complains about the role type, run this once in your database SQL editor, then `npm run db:sync` again:
```sql
ALTER TYPE "enum_Users_role" ADD VALUE IF NOT EXISTS 'JUDGE';
```
Optional: `npm run seed` creates a Folk Song team for every parish. (The planner also creates any missing teams when you generate fixtures, so this is optional.)

## 3. Fix email (set these on Render > your API service > Environment)
1. `BREVO_API_KEY` (or `RESEND_API_KEY`), the key from your email provider.
2. `EMAIL_FROM`, a sender address you have VERIFIED with that provider.
3. `FRONTEND_URL`, your site address, so password-reset links point to the right place.
4. SMS now goes through Brevo too (same `BREVO_API_KEY`). Add `BREVO_SMS_SENDER` (up to 11 letters/numbers, no spaces, e.g. `YSummit`), and buy SMS credits in Brevo (SMS > Buy credits). You can delete the old `CELCOM_API_KEY`, `CELCOM_PARTNER_ID` and `CELCOM_SHORTCODE` variables.
5. Redeploy, then open Admin > Announcements > "Email delivery check" and send yourself a test.
6. When the test arrives, DELETE `SKIP_OTP_VERIFICATION` so new sign-ups get their verification code again.

## 4. Set up the competition
1. Admin > Sports > Fixtures > Groups & Day Planner: Preview, then "Generate & Save" for Football, Volleyball, Dance and Folk Song.
2. Admin > Judges: add each judge (name, email, phone, temporary password) and give them their login.
3. After group games are done / heats are marked, press "Advance Qualifiers" for each competition. For Football/Volleyball this puts ONLY the four group leaders into the two semi-finals; when a semi-final result is saved the winner drops into the final automatically.
4. If you already generated fixtures with the earlier version, open Sports > Fixtures, pick the competition and press Generate & Save, then confirm Replace to rebuild with the new Tue-Fri format (games from 3:00 pm, group leaders only to the semi-finals).

5. Dance times show as "TBA" until you set them: Sports > Fixtures, edit each Dance fixture and enter its real date and time. The running order is kept until then.
