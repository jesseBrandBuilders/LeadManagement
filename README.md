# R3VCORE Webinar Studio

A working-code project for Vercel + Supabase, replacing the FileMaker sending workflow. Leads upload, campaign editor with live preview, Google OAuth self-tests and sends, durable queue with pause/resume, tracking signals, centralized opt-outs, registration imports, follow-up drafts, and results exports.

Frontend: responsive HTML/CSS/JavaScript. Server: Vercel Node functions using built-in fetch/crypto. Database and administrator login: Supabase Postgres/Auth. There are no npm package dependencies and no build step. The code has local automated tests; production credentials/deployment and the SQL migration need verification in your own projects.

## 1. Preview locally

```bash
npm test
npm run dev
```

Open http://localhost:3000/?demo=1 . Design preview uses clearly labeled sample data and blocks live email sending. CSV import and draft editing work locally in preview, but preview data is not persisted. The separate Webinar_Studio_Preview.html is a standalone version of this design preview.

## 2. Supabase

Use a NEW, dedicated Supabase project so the migration doesn't conflict with existing table/function names. Run supabase/schema.sql ONCE in SQL Editor. It creates the tables and RPCs, enables RLS, and revokes campaign data access from anonymous and authenticated browser users. The server's service-role key accesses data only after the app has validated your administrator session. Do not add browser policies granting these tables access.

In Authentication → Users, add jesse@r3vcore.com with a strong password and mark the email confirmed. Turn off public user sign-ups for this single-admin app. This login is separate from Google OAuth and is not your Google password. The API requires both the configured administrator email and a confirmed account. For this version, ADMIN_EMAIL allows exactly one administrator.

Get your project's URL, public anon/publishable key, and server service-role JWT key from Supabase. This starter uses the service-role JWT key, not a new sb_secret key, because it sends that value in the REST Authorization header. Keep the service role key private. The anon/publishable key is safe to expose for Auth; RLS/grants prevent it reading campaign data.

## 3. Vercel

Push this folder's contents to a private GitHub repository, then import it into Vercel. Framework: Other. Build command: none. Output directory: public. vercel.json defines the functions and tracking rewrites. Select Node 22 or newer. If your Vercel plan doesn't permit the configured function duration, reduce batch size/duration together and retest before sending.

Add the following server environment variables. Their example names are in .env.example. Set them for Production; use a separate safe configuration if testing Preview deployments.

| Variable | Value |
|---|---|
| SUPABASE_URL | Your project HTTPS URL |
| SUPABASE_ANON_KEY | Public Auth key |
| SUPABASE_SERVICE_ROLE_KEY | Server-only service-role JWT key |
| ADMIN_EMAIL | jesse@r3vcore.com |
| GMAIL_ADDRESS | jesse@r3vcore.com |
| GOOGLE_CLIENT_ID | Existing Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Existing Google OAuth client secret |
| GOOGLE_REFRESH_TOKEN | Existing refresh token authorized as Jesse with gmail.send |
| APP_URL | Final production HTTPS origin, no path; e.g. https://webinars.r3vcore.com |
| TRACKING_SECRET | Random secret of at least 32 characters; keep stable |
| CRON_SECRET | Different random secret of at least 32 characters |
| DAILY_SEND_CAP | 200 to start; counts attempts over a rolling 24-hour window |
| SEND_ENABLED | false until configuration is ready; true for self-test and live sending |

Generate each secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Don't commit filled .env files or paste keys into chat. All Google credentials and the service-role key remain server-side. They are not accepted/stored by the frontend. Only the Supabase URL/public Auth key and admin email are returned by the public configuration endpoint.

Redeploy after setting the environment variables. The optional custom domain is useful, but Vercel's production URL works. Production tracking routes must be PUBLIC to signed-out mail clients, so turn off whole-deployment authentication protection for this public-facing app deployment. The app's administrator API is still protected by Supabase Auth, and the tracking routes use opaque signed tokens. You can keep preview deployments protected. Don't point emailed links at ephemeral preview URLs.

## 4. Reuse your Google authorization

No new OAuth callback is needed for runtime refresh-token sending. Use the same Google client ID, secret, and refresh token you just obtained for jesse@r3vcore.com. Verify that Gmail API is enabled and the token grants https://www.googleapis.com/auth/gmail.send . It must be authorized for Jesse's account, not another mailbox. Google can revoke refresh tokens; don't assume they last forever. External apps in Testing can have seven-day token expiry for this scope. Use the appropriate Internal/production setup for your Workspace organization. Admin API controls can also block authorization.

Sign into the app → Connection → Check Google connection. That refreshes an access token without sending an email. Then set SEND_ENABLED=true and redeploy, complete a campaign, and Send self-test. Check the actual From address, inbox content, links, date/timezone, and unsubscribe behavior. A successful Google token refresh alone doesn't prove the correct mailbox or inbox delivery.

## 5. Use the app

1. Upload leads as UTF-8 CSV. Headers such as Email, First Name, Last Name, Organization (or School) are detected; change mapping if needed. Max 2,000 rows / 2 MB per import. Invalid emails and within-file duplicates are skipped and reported. Across imports, addresses are normalized and merged; list memberships are retained. Existing opt-outs are NEVER cleared by reimport.
2. Create a campaign and select the imported list. Add subject, title, human-readable date/time/timezone, message, registration HTTPS URL, company postal address, and a truthful contact reason. The message is plain-text input converted safely to HTML. Greeting, button, footer, text alternative, and tracking are generated automatically. {{first_name}} and {{last_name}} merge tags are supported. First names fall back to “there.”
3. Save and Send self-test to jesse@r3vcore.com. Each content change invalidates the successful-test marker. Review the inbox, then Review & start. Campaign content and recipient snapshots are frozen after launch. To change the message, pause and create a fresh campaign.
4. Keep the authenticated dashboard OPEN while sending. It submits batches of up to three messages, then refreshes progress. Closing the browser leaves the remaining queue saved but stops browser-driven work. A paused campaign stops new claims; a message already in flight may finish.
5. Import registrations from your webinar platform using its CSV email column. The app matches them to campaign recipients. Create follow-up copies the invitation to a new draft linked to the original campaign and excludes registered/opted-out addresses. Edit the follow-up and self-test before launch.
6. Export results or review individual messages. Uncertain sends are never automatically retried; inspect Gmail Sent Mail before choosing an outcome in Review. Pause before resolving. The app requires your explicit acknowledgement that you checked Sent Mail.

Import existing opt-outs before selecting an audience: either set contacts.unsubscribed_at in Supabase or use the app's Leads → Opt out control. List eligibility remains your responsibility; the app doesn't infer consent from an uploaded address.

## 6. Unattended sending (optional)

The browser-driven queue works without a paid cron plan. For sending after closing the dashboard, a scheduler must invoke GET /api/worker with Authorization: Bearer YOUR_CRON_SECRET. The endpoint processes up to three queued messages per invocation and respects global worker locking, campaign pause state, suppressions, and the daily cap. NEVER put the cron secret in the query string.

Vercel Hobby cron is limited to once per day, which isn't suitable for a few-hundred-message queue using these small batches. On an appropriate Vercel plan, add this to vercel.json and redeploy:

```json
"crons": [{ "path": "/api/worker", "schedule": "* * * * *" }]
```

Vercel injects the CRON_SECRET Authorization header. Alternatively use an authorized external scheduler supporting a protected header. With three messages per minute, 300 invitations take about 100 minutes, subject to actual limits/errors. Browser processing is typically faster. Daily cap counts application attempts including self-tests, but cannot see sends you make elsewhere in Gmail; Google's own account limits still apply. Never raise it just to evade a provider limit.

## Reliability

- A transactional Postgres queue claim and global three-minute worker lease prevent two active workers claiming the same send. Each Vercel worker is capped at 120 seconds. Expired/interrupted sending records are changed to uncertain when the next worker obtains the lease; no automatic resend.
- A stable Message-ID accompanies each recipient, but Gmail messages.send has no idempotency guarantee. Network timeouts and acceptance-save failures go to review, not retry. There is no exactly-once claim for email delivery.
- Content/test versioning and campaign start run under row locks. No anonymous/authenticated execution access is granted to privileged database functions.
- SMTP/app passwords/FileMaker are not used. Google credentials are not in Supabase or browser storage.
- The administrator session uses Supabase Auth with sessionStorage; closing the tab clears local session persistence. Signed-out users can't access campaign APIs. This single-admin starter does not include a separate MFA management flow; configure additional authentication controls if needed.
- Unsubscribe requires confirmation POST and writes to Postgres transactionally. A scanner merely fetching GET doesn't suppress a contact. This is not RFC 8058 one-click unsubscribe.
- Tracking-event writes are best effort: if an event insert fails, its link/pixel still works and a sanitized error is logged. No durable outage queue is provided. If the database lookup fails, the click/opt-out returns an unavailable response; unsubscribe never claims success without a committed suppression.
- Open/click figures are DISTINCT recipients with raw image/link signals, not verified human engagement. Privacy features and scanners can create signals; blocked images can hide them. Plain-text opens don't produce image signals.
- Gmail API acceptance is not delivered/inbox status. No automatic bounce/complaint collection is included; monitor the sending inbox and suppress bounced addresses.
- Keep APP_URL and TRACKING_SECRET stable, and preserve recipient records for as long as emailed links need to work. Signatures carry a random recipient UUID, no email address; no IP/user-agent data is stored. Backups contain lead data and campaign content.

## Validation

Run npm test. Tests cover CSV parsing/export safety, normalization, MIME/signatures, administrator checks, database request behavior, OAuth/Gmail failures, suppressed recipients, queue locks, and uncertain-send behavior with mocked external services. They do NOT run your SQL in live Postgres or authenticate against your accounts. After applying the migration, verify the self-test/start/pause/opt-out/follow-up flows in your actual Supabase/Vercel projects. Browser visual QA was not available in the build environment; a self-contained interactive design preview is included for review.

Official documentation:
https://developers.google.com/workspace/gmail/api/guides/sending
https://developers.google.com/identity/protocols/oauth2
https://supabase.com/docs/guides/database/postgres/row-level-security
https://supabase.com/docs/guides/auth
https://vercel.com/docs/cron-jobs/manage-cron-jobs
