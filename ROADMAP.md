# Wastely CRM roadmap

The plan, in order. The weekly self-review reads this file and suggests the **first unticked item whose "Needs first" items are done**, alongside ideas from how the CRM is used. A person in Leadership chooses **Build it** and publishes after trying the preview. The build that finishes an item ticks it here (`[x]`) and records it under **Done**.

Items marked **Needs a person** include steps only the owner can do (accounts, keys, settings). The build prepares everything else and lists those steps in its pull request.

---

### 1. [ ] web-leads: Website form submissions in the CRM
**Why:** Leads from wastely.ca land in an old Redis store behind the prototype. This blocks go-live, because the live site still depends on it.
**Build:**
- `POST /api/forms` route handler that accepts what the website sends today: `Content-Type: text/plain`, body JSON `{ form: 'Quote request' | 'Contact' | 'Careers', page, fields }`, where `fields` keys differ by form (see `design/HANDOFF.md` → Website forms, and `pick()`/`mapService()`/`parseRange()` in `design/Wastely CRM.dc.html`). Store rows in `web_submissions` (already in the schema) with the service-role client. Keep CORS for `https://wastely.ca`, `https://www.wastely.ca` and `*.github.io`, the `_gotcha` honeypot, a ~32 KB body cap and per-IP rate limiting (about 10 a minute). Always reply 200 quickly.
- **Web leads** screen (sidebar item already reserved): New / Converted / Archived / All, cards as in the prototype. **Create deal** through `create_deal` with `source = 'Website · <form>'`, value = the midpoint of the `$X – $Y` range in `confirmed` or the minimum, urgent requests set `emergency`, and a "Call back" task for today. Careers can only be archived.
- An assistant tool to list and convert web leads.
**Done when:** a test POST shaped like the website's appears on Web leads within seconds and converts into a deal. `npm run check` passes.
**Needs a person:** nothing before publishing. Once the CRM is live on `main` (item 3), the website's existing URL keeps working unchanged.
**Owner to decide:** the website's contact form enforces a **$2,500** minimum, but the CRM's minimum job value is **$5,000**. Pick one and align both (the CRM value is `app_settings.min_job_cents`).

### 2. [ ] staff-sign-in: Let the team sign in
**Why:** Supabase's built-in email only reaches the owner, so staff can't get sign-in codes.
**Build:** a "Sign in with Google" / "Sign in with Microsoft" setup guide on Team (Leadership only), with exact steps and the redirect URL to paste; check that `/auth/callback` handles both providers; show which methods are enabled.
**Needs a person:** EITHER connect custom SMTP in Supabase (Authentication → Emails → SMTP, e.g. Resend or Postmark with wastely.ca), OR create a Google Cloud OAuth client (Workspace) and/or an Azure app registration, then enable them in Supabase → Authentication → Providers.
**Done when:** a second `@wastely.ca` person can sign in and lands as an active member.

### 3. [ ] go-live: Make the new CRM the live site
**Needs first:** web-leads, staff-sign-in.
**Build:** a pull request that prepares `main` for the Next.js CRM, and a GO-LIVE checklist in it. The checklist covers:
- Vercel production env vars, all of them, ticked for Production
- the framework preset (vercel.json already sets nextjs)
- Supabase Site URL and redirect URLs for the production domain
- the Stripe webhook URL
- `GITHUB_BASE_BRANCH=main`, plus `base_branch`/`ref` in `.github/workflows/claude.yml` → `main`
- `CRON_SECRET` for Production
- the Mac app `SITES` in `mac-app/main.js` (rebuild)
- copying any old Redis web leads over (one-off script)

**Needs a person:** set the env vars, merge, and run the checklist. Keep Vercel's Instant Rollback ready.
**Done when:** jackrabbit-psi.vercel.app (or a custom domain such as crm.wastely.ca) serves the new CRM, website forms arrive in Web leads, and the Monday review runs.

### 4. [ ] stripe-live: Real card and bank payments
**Needs first:** go-live.
**Build:** confirm the payment page offers ACSS (pre-authorized debit) alongside cards. Show the payment method and any processing state on the invoice. Add a short "how clients pay" note under Team → Company details.
**Needs a person:** a Stripe account in live mode, ACSS enabled, live `STRIPE_SECRET_KEY` and webhook secret in Vercel production.
**Done when:** a real $1 test invoice is paid and flips to Paid.

### 5. [ ] email: Gmail / Microsoft 365 email on deals
**Needs first:** staff-sign-in.
**Build:** per-user mail connection (Google `gmail.send`/`gmail.readonly`; Microsoft Graph `Mail.Send`/`Mail.Read`) with tokens encrypted on the server. Log emails to and from known contacts into `communications` on the right job. Add the Inbox screen (threads per contact, composer) as in the prototype. Send invoice and agreement links by email from the CRM, and append the user's signature.
**Needs a person:** OAuth app consent and verification in Google Cloud / Azure.
**Done when:** an email sent from a deal arrives, and the client's reply shows up on that deal's timeline.

### 6. [ ] quo: Texts and calls through Quo (formerly OpenPhone)
**Needs first:** email (shares the Inbox).
**Build:** send texts with `POST /v1/messages`. Add a webhook at `/api/webhooks/quo` with signature verification, a fast 2xx, and processing afterwards, for `message.received`, `call.completed`, `call.recording.completed`, `call.transcript.completed` and `call.summary.completed`. Match the phone number to the contact and then the job, with an Unmatched bucket. Make "Call" open the Quo app (the API can't place calls). Show recordings, transcripts and summaries on the timeline when the plan includes them.
**Needs a person:** a new `QUO_API_KEY` (the one pasted during design must be revoked), the webhook signing key, and registering the webhook URLs in Quo.
**Done when:** an inbound text appears on the right deal without a refresh.

### 7. [ ] agreement-terms: Use Wastely's real agreement wording
**Build:** turn the owner's existing "WASTELY SERVICE AGREEMENT" into the agreement template, keeping the `{{placeholders}}` (see `PLACEHOLDERS` in `src/lib/docs.ts`). Add it as a migration that updates the default template.
**Needs a person:** provide the agreement text, and have a lawyer review it.
**Done when:** a new agreement uses the real wording and renders correctly in the PDF.

---

## Later ideas (not ordered)
- Field crew view: a phone-friendly page of today's site, crew and tasks.
- Job photos and documents on deals (Supabase Storage).
- Reporting: margin by service, client and owner; win rate by stage.
- Recurring clients and property records (several jobs per property).

## Done
- 2026-10-16: Core CRM (data model, auth, Overview, Pipeline, Contracts, Tasks, Team, job panel, New deal).
- 2026-10-17: Invoices (PDF, HST, Stripe payment page) and client agreements (template, online signing).
- 2026-10-28: In-CRM assistant with Undo; Builds (change the app from the CRM); email-code sign-in; Mac app 1.1.
- 2026-10-28: Weekly self-review that suggests builds; this roadmap and CLAUDE.md.
