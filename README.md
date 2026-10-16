# Wastely CRM

Internal CRM for Wastely: deals from lead to won, contracts with operating costs and margin, crews on site, and tasks — on one shared database instead of per-browser storage.

Next.js (App Router) + TypeScript, Supabase (Postgres, Auth, Realtime), Nocturne design tokens. The design reference and handoff notes live in [`design/`](design/HANDOFF.md).

## Status

| Phase | State |
| --- | --- |
| Data model, auth, Overview / Pipeline / Contracts / Tasks, job panel, New deal, Team (profiles + crew) | **Built** |
| Web leads (`/api/forms` port, Supabase-backed) | Next |
| AI assistant (`/api/ai` port, server-side actions + audit log) | Later |
| Quo texts/calls, Gmail / Microsoft 365 email, Inbox | Later |
| Stripe invoices | Later |

## Set up

### 1. Supabase
1. Create a project at supabase.com (region: Canada if available).
2. Run the migration: open **SQL Editor**, paste [`supabase/migrations/20261016000000_core.sql`](supabase/migrations/20261016000000_core.sql) and run it. (Or `supabase link` + `supabase db push` with the CLI.)
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
The existing JACKRABBIT project is set to Framework Preset **Other** for the old static prototype. Before deploying this branch:
- Settings → Build & Deployment → Framework Preset: **Next.js** (build command and output dir: defaults).
- Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Keep `CRM_KEY`, `ANTHROPIC_API_KEY` and the Upstash vars — the Web leads and AI phases reuse them.

Until `/api/forms` is ported, merging this to `main` stops the website-form endpoint the live site posts to. Deploy it as a preview first, or merge after the Web leads phase.

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
src/proxy.ts          session refresh + redirect to /login
supabase/migrations/  schema, RLS, triggers, create_deal / ensure_services
design/               prototype, handoff, old Vercel API functions (reference only)
mac-app/              Electron wrapper; set CRM_URL in main.js to the deployed URL
```
