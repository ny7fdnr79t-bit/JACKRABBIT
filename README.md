# Wastely CRM

Internal CRM for Wastely: deals from lead to won, contracts with operating costs and margin, crews on site, and tasks — on one shared database instead of per-browser storage.

Next.js (App Router) + TypeScript, Supabase (Postgres, Auth, Realtime), Nocturne design tokens. The design reference and handoff notes live in [`design/`](design/HANDOFF.md).

## Status

| Phase | State |
| --- | --- |
| Data model, auth, Overview / Pipeline / Contracts / Tasks, job panel, New deal, Team (profiles + crew) | **Built** |
| Web leads (`/api/forms` intake from wastely.ca, Web leads screen, Create deal) | **Built** |
| AI assistant (`/api/ai` port, server-side actions + audit log) | Later |
| Gmail: connect under Team, threads on each deal, send and reply | **Built** (needs Google keys) |
| Quo texts/calls, Inbox | Later |
| Invoices (deposit / progress / final, PDF, Stripe card payments) and client agreements (template, online signature, PDF) | **Built** |

## Set up

### 1. Supabase
1. Create a project at supabase.com (region: Canada if available).
2. Apply everything in [`supabase/migrations/`](supabase/migrations/) in filename order (`supabase link` + `supabase db push`, or paste each into **SQL Editor**). The database records which ones are applied in `supabase_migrations.schema_migrations`, so `db push` only runs new ones. Every table has row level security on, and an event trigger switches it on for any new table.
3. **Authentication → Providers**
   - **Google**: enable, add the client ID/secret from a Google Cloud OAuth client (Web). Authorised redirect URI: `https://<project>.supabase.co/auth/v1/callback`.
   - **Azure (Microsoft 365)**: enable, add the app registration's client ID/secret and tenant URL. Same redirect URI.
   - **Email**: leave on for magic links (handy for testing).
4. **Authentication → URL configuration**: Site URL = your deploy URL; add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` to Redirect URLs.

### 2. Run it locally
```bash
cp .env.example .env.local   # fill in the Supabase URL and anon key
npm install
npm run dev
```

### 3. Vercel
The existing JACKRABBIT project is set to Framework Preset **Other** for the old static prototype. `vercel.json` sets `"framework": "nextjs"`, which overrides that for this branch. Also:
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), and for card payments `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Gmail (see below). `ANTHROPIC_API_KEY` for the AI assistant later.


### 4. Stripe (card payments on invoices)
1. In Stripe, use **test mode** first. Copy the secret key into `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**: `https://<your-domain>/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Settings → Payment methods**: cards are on by default. Consider turning on **Canadian pre-authorized debit (ACSS)**. On a $200k job, card fees run about 3% (~$6,000), and bank debit is much cheaper. Checkout offers whatever you enable there.
4. Pay a test invoice with card `4242 4242 4242 4242`; it should flip to **Paid** on its own, and the job's billing follows.

Without Stripe keys, invoices still work and show e-transfer and cheque instructions only.

## Web leads (wastely.ca forms)

- `POST /api/forms` takes `{ form, page, fields }` as JSON (sent as `text/plain` to skip the CORS preflight) or a normal form post. It accepts browsers on `https://wastely.ca`, `https://www.wastely.ca`, `https://ny7fdnr79t-bit.github.io` and this app (add more with `FORMS_ALLOWED_ORIGINS`, comma-separated). It caps bodies at 32 KB, ignores anything with a filled `_gotcha` field, drops keys starting with `_`, and allows 10 submissions a minute / 60 a day per sender (by a keyed hash of the IP).
- Submissions land in `web_submissions` and show under **Web leads** straight away (realtime). The sidebar counts new ones.
- **Create deal** opens New deal pre-filled from the lead (client, job title, client type, value from the indicative price, services, Urgent → Emergency). Saving runs `convert_web_submission`, which creates the job, its site and contact, a "Call back" task for today (if `app_settings.callback_task`), and marks the lead converted, all in one transaction.
- Careers submissions can only be archived. Archived leads can be moved back to New or deleted (for spam).

### Website change
Every form on wastely.ca sends through `window.wsSubmit.send(d, to)` in `transition.js`. Add this inside that file, just above `function send(d, to) {`:

```js
  // Copy each submission into the Wastely CRM (Web leads). Never blocks the form.
  function toCrm(d, to) {
    try {
      var p = location.pathname.toLowerCase();
      var form = (to && to !== 'go@wastely.ca') || p.indexOf('career') >= 0 ? 'Careers' : p.indexOf('contact') >= 0 ? 'Contact' : 'Quote request';
      fetch('https://jackrabbit-psi.vercel.app/api/forms', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ form: form, page: location.href, fields: d })
      }).catch(function () {});
    } catch (e) {}
  }
```

and make `toCrm(d, to);` the first line inside `send`.

## Gmail

- **Team → Integrations → Connect Gmail** opens Google's consent screen in a new tab (the Mac app sends it to the default browser, because Google blocks sign-in inside app windows). Approve it and the mailbox is connected for the whole team: each person uses their own connection if they have one, otherwise the first connected mailbox.
- The refresh token is stored encrypted in Supabase Vault (`google_token_save` / `google_token_get`, service role only). Access tokens are fetched as needed and never reach the browser.
- Each deal's panel lists recent threads with the contact's email (live from Gmail), opens them as plain text with quoted text folded away, and sends new emails or replies in the same thread from the connected mailbox (with the sender's profile signature). Sent emails are logged in `communications`.
- Scopes: `gmail.readonly`, `gmail.send`, and `calendar.events` (used in the Calendar step, so nobody has to reconnect).

### Google Cloud setup (one time)
1. console.cloud.google.com, signed in as the Workspace account → new project "Wastely CRM".
2. APIs & Services → Library → enable **Gmail API** and **Google Calendar API**.
3. OAuth consent screen (Google Auth Platform → Branding/Audience): app name "Wastely CRM", **Internal** audience (Workspace users only, no review, tokens don't expire after 7 days).
4. Clients → Create client → **Web application**, authorised redirect URI `https://jackrabbit-psi.vercel.app/api/google/callback`.
5. Put the client ID and secret in Vercel as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Production), then redeploy.

## Invoices and agreements

- From a deal's panel: **+ Agreement**, **+ Deposit invoice**, **+ Progress**, **+ Final**. Each opens an editor.
- The agreement is filled from the deal and the template under **Team → Agreement template** (a starting draft, so have a lawyer review it). Edit freely while it's a draft.
- **Mark sent and copy link** locks the document and copies the client's private link (`/sign/…` or `/pay/…`), which you paste into your email. Sending email from the CRM comes with the email integration.
- Clients sign by drawing a signature. The signed PDF records name, email, time, IP, and a SHA-256 fingerprint of the exact text signed. Signed agreements can't be changed; sent ones can only be voided.
- Invoice totals and HST are computed in Postgres. Job **billing** updates automatically: Deposit/Progress/Invoiced in full when sent, **Paid** once the final invoice and all others are paid.
- Only drafts can be deleted. A deal with documents can't be deleted, so move it to Lost.
- Company name, address, HST number, tax rate, deposit %, payment terms and e-transfer email live under **Team → Company details**.

## Access

- Sign-in is email only: enter your email, get a 6-digit code, type it in (works inside the Mac app). The email also has a link, which signs you in to whichever browser opens it.
- Public sign-ups are off in Supabase Auth. **Leadership adds people under Team → Give access**; the server creates the account and activates it.
- Leadership can **Deactivate** someone under Team to cut their access.
- Every table has row level security: only active members can read or write. Leadership alone can change roles, activate people, and edit settings.
- Auth emails go through custom SMTP (Supabase → Authentication → Emails → SMTP Settings). Supabase's built-in sender only delivers to members of the Supabase team.

## Business rules (enforced in Postgres)

- New deals need at least one service and a value of at least `app_settings.min_job_cents` (default $5,000). Existing jobs can drop below it; they show a warning.
- Moving a deal to **Won** sets its status to **Scheduled**.
- Margin target (default 30%) lives in `app_settings.margin_target`; jobs below it are flagged.
- Client names are matched case-insensitively, so the same client isn't created twice. Custom services are saved and reusable.

## Layout

```
src/app/(app)/        signed-in screens: overview, pipeline, contracts, tasks, web leads, team
src/app/login/        sign-in (email + 6-digit code)
src/app/auth/         email-link confirm, callback and sign-out
src/components/       AppShell (sidebar), JobDrawer, NewDealDialog, shared UI
src/lib/crm.ts        domain types, constants, money/date helpers
src/lib/store.tsx     Supabase-backed state, optimistic writes, realtime reload
src/lib/docs.ts       invoice/agreement types, template filling, agreement text format
src/lib/pdf.tsx       PDF rendering (react-pdf) for invoices and agreements
src/app/(public)/     client pages: /sign/<token>, /pay/<token>
src/app/api/          website form intake, health check, PDF downloads, Stripe webhook
src/proxy.ts          session refresh + redirect to /login
supabase/migrations/  schema, RLS, triggers, create_deal / ensure_services
design/               prototype, handoff, old Vercel API functions (reference only)
mac-app/              Electron wrapper; set CRM_URL in main.js to the deployed URL
```
