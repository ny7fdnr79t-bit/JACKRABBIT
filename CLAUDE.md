# Wastely CRM: project memory for Claude Code

Read this before changing anything. It holds what the people who built this CRM decided and why, so each build starts where the last one stopped. **ROADMAP.md** is the plan; **README.md** is the setup guide for humans.

## The business
Wastely does large one-off waste jobs in Ontario: estate and facility cleanouts, hazardous and regulated disposal, abatement (asbestos, mould), strip-outs, demolition-style clearing. Clients are developers, realtors, property managers and commercial/industrial businesses. Jobs start at $5,000 and can run to hundreds of thousands. Users are a small team: account managers, dispatch, billing, leadership, plus field crew who are *not* app users. The owner is not a developer; explain things in plain language in PR descriptions.

## Stack and layout
Next.js 16 App Router + TypeScript (strict), Supabase (Postgres, Auth, Realtime), Vercel, Nocturne design system (dark).
- In Next.js 16, middleware is `src/proxy.ts`, and route `params`/`searchParams` are Promises.
- `src/app/(app)/*`: signed-in screens. `src/app/(public)/*`: client-facing `/sign/<token>` and `/pay/<token>` pages (light theme, no login). `src/app/api/*`: PDFs, Stripe webhook, assistant, builds, cron.
- `src/lib/leads.ts` + `src/app/api/forms/route.ts`: the Leads inbox. Website forms POST here (text/plain JSON `{ form, page, fields }`), and the team logs calls and texts by hand. Both are stored in `web_submissions`.
- `src/lib/store.tsx`: the client data store. It loads everything for the team, applies writes optimistically, and reloads on Supabase Realtime changes. Screens read from `useCrm()`.
- `src/lib/crm.ts`: domain types and constants (stages, statuses, billing, money/date helpers). `src/lib/docs.ts`: invoices and agreements (types, template filling, the agreement text format).
- `src/lib/assistant/*`: the in-CRM AI (prompt + tools). `src/lib/builds.server.ts`: Builds (GitHub issue → Claude Code → PR → Vercel preview → Publish). `src/lib/review.server.ts`: the weekly self-review.
- `supabase/migrations/*.sql`: the whole schema, applied in filename order. `tests/db.test.mjs`: database tests (PGlite).
- `design/`: the original HTML prototype and handoff. It's the reference for look and behaviour; don't edit it. `mac-app/`: Electron wrapper.

## Rules (keep these unless the request is explicitly about changing one)
1. **Money is integer cents in the database.** The UI works in dollars; convert with `toCents`/`fromCents`. Invoice totals and tax are computed by Postgres triggers, never by the client.
2. **Security lives in Postgres row level security.** Every table has RLS. Only active members (`is_member()`) can read or write; settings, roles, builds and usage logs are Leadership-only (`is_leadership()`). Any new table needs RLS policies and tests. Never bypass RLS for staff actions. The service-role client (`src/lib/supabase/admin.ts`) is only for token-addressed client pages, webhooks and cron, and always filters by the token or id.
3. **Schema changes go in a new migration file** named `YYYYMMDDHHMMSS_what.sql`. Never edit an existing migration; they've already been run in production. Say in the PR that it must be run in the Supabase SQL Editor before publishing. Add checks for it in `tests/db.test.mjs`.
4. **Business rules are enforced in the database:** minimum job value on new deals; at least one service; Won → status Scheduled; job billing follows its invoices; sent documents are locked, signed agreements are immutable, and only drafts can be deleted; a job with documents can't be deleted (move it to Lost).
5. **Design:** use the Nocturne tokens and classes in `src/app/globals.css` (`.btn`, `.btn-primary` is an *outline*, `.tag`, `.card`, `.seg`, `.table`, `.input`, the fading `.rule-*` dividers). Inter 400/500 (600 only on client documents). Phosphor icons (`@phosphor-icons/react`). Match the prototype in `design/Wastely CRM.dc.html`. Must work at phone width.
6. **Writing in the UI:** short, plain, specific. Canadian English and `en-CA` formatting. Errors say what happened and what to do.
7. **The assistant acts as the signed-in person.** Its tools use that person's Supabase session, record reverse steps in `ai_actions`, and never send anything to clients. New tools follow the pattern in `src/lib/assistant/tools.ts` (validate input, `record()` an undo).
8. **Nothing goes live without a person.** Builds are published by Leadership only, after a successful preview. Don't add auto-publishing, and don't weaken sign-in, RLS, Stripe or signing code unless the request is specifically about it. If you do touch them, call it out at the top of the PR.
9. **Claude API:** model `claude-opus-5-5` through `@anthropic-ai/sdk` with `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, and handle `stop_reason: 'refusal'`. Conversation history is append-only (thinking blocks are bound to it). Don't use `budget_tokens`, forced `tool_choice` or prefill; they're rejected on this model.
10. **Secrets only on the server:** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `STRIPE_*`, `CRON_SECRET`. Only `NEXT_PUBLIC_*` reaches the browser.

## Before you finish any change
- Run `npm run check` (typecheck → database tests → production build). All three must pass.
- If you completed a **ROADMAP.md** item, tick it, and add a line under "Done" with the date and PR number. If you learned something future builds need (a gotcha, a decision), add it to "Decisions and gotchas" below. Keep this file short and true; fix anything here that's no longer true.
- Write the PR description for the owner: what changed, how to try it in the preview, and any manual step (migration, env var, Supabase or Vercel setting).

## Environments
- **Preview CRM:** branch `crm-nextjs`, at `https://jackrabbit-git-crm-nextjs-evan-3484.vercel.app`, behind Vercel login. Builds branch from and merge into `crm-nextjs` (`GITHUB_BASE_BRANCH`, plus `base_branch`/`ref` in `.github/workflows/claude.yml`) until go-live.
- **Live site:** `main` at `https://jackrabbit-psi.vercel.app` still serves the **old static prototype**. Its `/api/forms` receives the wastely.ca website forms (Upstash Redis). Don't break it before the Web leads item replaces it.
- **Supabase project "Jackrabbit"** (Canada). Migrations are run by hand in the SQL Editor. Auth uses an email code (custom template with `{{ .Token }}` and a `token_hash` link to `/auth/callback`); Google/Microsoft buttons appear only when enabled in Supabase.
- **GitHub:** `ny7fdnr79t-bit/JACKRABBIT`. Requests are issues labelled `claude`; the workflow on `main` runs Claude Code. The website is a separate repo, `ny7fdnr79t-bit/Wastely` (GitHub Pages), which builds here can't change.

## Decisions and gotchas
- The first person to sign in becomes Leadership. `@wastely.ca` sign-ins activate automatically (`allowed_domains`); others wait on Team.
- Supabase's built-in email only reaches the project owner and a few per hour. Staff need custom SMTP or Google/Microsoft sign-in (see ROADMAP).
- Vercel previews are behind Vercel Authentication, so client links (`/sign`, `/pay`) only work for clients on production.
- Vercel only runs crons (the Monday self-review) on production. Before go-live, use **Review now** on Builds.
- Built-in PDF fonts (Helvetica) only cover WinAnsi; `src/lib/pdf.tsx` swaps the few characters they lack. Hyphenation is off.
- Stripe card fees are ~3%; jobs are large, so Canadian pre-authorized debit (ACSS) should be offered.
- The agreement template in `20261017000000_documents.sql` is a drafted starting point that needs a lawyer's review. The owner has an existing "WASTELY SERVICE AGREEMENT" PDF that may replace it.
- Realtime reload refetches everything (fine at this team size). Revisit if the data grows past a few thousand jobs.
