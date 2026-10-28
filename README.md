# Wastely CRM

Internal CRM for Wastely: deals from lead to won, contracts with operating costs and margin, crews on site, and tasks — on one shared database instead of per-browser storage.

Next.js (App Router) + TypeScript, Supabase (Postgres, Auth, Realtime), Nocturne design tokens. The design reference and handoff notes live in [`design/`](design/HANDOFF.md).

## Status

| Phase | State |
| --- | --- |
| Data model, auth, Overview / Pipeline / Contracts / Tasks, job panel, New deal, Team (profiles + crew) | **Built** |
| Web leads (`/api/forms` port, Supabase-backed) | Next |
| AI assistant: chat in the CRM that reads and changes data and settings (with Undo and a change log), and files app change requests that Claude Code builds | **Built** |
| Quo texts/calls, Gmail / Microsoft 365 email, Inbox | Later |
| Invoices (deposit / progress / final, PDF, Stripe card payments) and client agreements (template, online signature, PDF) | **Built** |

## Set up

### 1. Supabase
1. Create a project at supabase.com (region: Canada if available).
2. Run the migrations in order: open **SQL Editor**, paste [`20261016000000_core.sql`](supabase/migrations/20261016000000_core.sql) and run it, then the same for [`20261017000000_documents.sql`](supabase/migrations/20261017000000_documents.sql) and [`20261028000000_assistant.sql`](supabase/migrations/20261028000000_assistant.sql). (Or `supabase link` + `supabase db push` with the CLI.)
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
- Keep `CRM_KEY`, `ANTHROPIC_API_KEY` and the Upstash vars — the Web leads and AI phases reuse them.

Until `/api/forms` is ported, merging this to `main` stops the website-form endpoint the live site posts to. Deploy it as a preview first, or merge after the Web leads phase.

### 4. Stripe (card payments on invoices)
1. In Stripe, use **test mode** first. Copy the secret key into `STRIPE_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**: `https://<your-domain>/api/stripe/webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. **Settings → Payment methods**: cards are on by default. Consider turning on **Canadian pre-authorized debit (ACSS)**. On a $200k job, card fees run about 3% (~$6,000), and bank debit is much cheaper. Checkout offers whatever you enable there.
4. Pay a test invoice with card `4242 4242 4242 4242`; it should flip to **Paid** on its own, and the job's billing follows.

Without Stripe keys, invoices still work and show e-transfer and cheque instructions only.

## AI assistant

**Ask AI** in the sidebar (or ⌘J) opens a chat panel. It uses Claude Opus 5.5 (`claude-opus-5-5`) through `/api/ai`, with Anthropic's server-side refusal fallback turned on (`fallbacks: "default"`).

- **What it can do:** answer questions about deals, tasks and invoices; create deals and tasks; update jobs (stage, status, value, dates, owner, costs, services, crew, contact, custom fields); draft invoices and agreements; and, for Leadership, add, rename or remove pipeline stages, add custom job fields, add services and set the margin target.
- **What it can't do:** delete deals, send emails, invoices or agreements, or take payments.
- **Safety:** the tools run with the signed-in person's own Supabase session, so row level security limits it exactly like that person. Every change is written to `ai_actions` with the steps to reverse it, and each reply has an **Undo** button.
- **Setup:** add `ANTHROPIC_API_KEY` to Vercel (server only).

### App change requests

When someone asks for something the assistant's tools can't do (a new screen, button or report), it offers to file an **app change request**. That's Leadership only, and it's filed only after the person confirms the wording. The request becomes a GitHub issue labelled `claude`. The [Claude GitHub Action](.github/workflows/claude.yml) then builds it on a new branch and opens a pull request, which Vercel gives a preview link. Nothing goes live until someone reviews and merges it.

Setup, once:
1. In Vercel, add `GITHUB_TOKEN`: a fine-grained GitHub token for this repo only, with **Issues: Read and write**.
2. In GitHub → repo **Settings → Secrets and variables → Actions**, add `ANTHROPIC_API_KEY`.
3. Install the Claude GitHub app: run `claude` in a terminal, then `/install-github-app`.
4. Copy `.github/workflows/claude.yml` onto `main`. GitHub only runs issue workflows from the default branch.

## Invoices and agreements

- From a deal's panel: **+ Agreement**, **+ Deposit invoice**, **+ Progress**, **+ Final**. Each opens an editor.
- The agreement is filled from the deal and the template under **Team → Agreement template** (a starting draft, so have a lawyer review it). Edit freely while it's a draft.
- **Mark sent and copy link** locks the document and copies the client's private link (`/sign/…` or `/pay/…`), which you paste into your email. Sending email from the CRM comes with the email integration.
- Clients sign by drawing a signature. The signed PDF records name, email, time, IP, and a SHA-256 fingerprint of the exact text signed. Signed agreements can't be changed; sent ones can only be voided.
- Invoice totals and HST are computed in Postgres. Job **billing** updates automatically: Deposit/Progress/Invoiced in full when sent, **Paid** once the final invoice and all others are paid.
- Only drafts can be deleted. A deal with documents can't be deleted, so move it to Lost.
- Company name, address, HST number, tax rate, deposit %, payment terms and e-transfer email live under **Team → Company details**.

## Access

- The **first person to sign in** becomes an active **Leadership** profile.
- Anyone signing in with an `@wastely.ca` address is activated automatically (edit `allowed_domains` to change).
- Anyone else sees “Access pending” until Leadership clicks **Activate** under Team.
- Every table has row level security: only active members can read or write. Leadership alone can change roles, activate people, and edit settings.

## Business rules (enforced in Postgres)

- New deals need at least one service and a value of at least `app_settings.min_job_cents` (default $5,000). Existing jobs can drop below it; they show a warning.
- Moving a deal to **Won** sets its status to **Scheduled**.
- Margin target (default 30%) lives in `app_settings.margin_target`; jobs below it are flagged.
- Client names are matched case-insensitively, so the same client isn't created twice. Custom services are saved and reusable.

## Layout

```
src/app/(app)/        signed-in screens: overview, pipeline, contracts, tasks, team
src/app/login/        sign-in (Google, Microsoft, email link)
src/app/auth/         OAuth callback and sign-out
src/components/       AppShell (sidebar), JobDrawer, NewDealDialog, shared UI
src/lib/crm.ts        domain types, constants, money/date helpers
src/lib/store.tsx     Supabase-backed state, optimistic writes, realtime reload
src/lib/docs.ts       invoice/agreement types, template filling, agreement text format
src/lib/pdf.tsx       PDF rendering (react-pdf) for invoices and agreements
src/app/(public)/     client pages: /sign/<token>, /pay/<token>
src/app/api/          PDF downloads, Stripe webhook, assistant (/api/ai, /api/ai/undo)
src/lib/assistant/    assistant instructions and tools (each tool records its own undo)
src/components/AiPanel.tsx  the chat panel
src/proxy.ts          session refresh + redirect to /login
supabase/migrations/  schema, RLS, triggers, create_deal / ensure_services
design/               prototype, handoff, old Vercel API functions (reference only)
mac-app/              Electron wrapper; set CRM_URL in main.js to the deployed URL
```
