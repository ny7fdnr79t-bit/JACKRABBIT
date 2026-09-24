# Handoff: Wastely CRM

## Overview
An internal CRM for Wastely, a company that does one-off, large-scale waste jobs: cleanouts, hazardous and regulated disposal, abatement, and clearing/removal. Its clients are businesses, real estate developers, realtors and property managers. The people using the CRM are account managers, dispatch, billing and leadership.

The CRM tracks deals from lead to won, contracts with their operating costs and margin, who is working on each site, tasks, and all communication with each client contact (email through Gmail or Microsoft 365, and texts, calls, recordings and transcripts through **Quo**, formerly OpenPhone).

## About the design files
`Wastely CRM.dc.html` is a **design reference built in HTML**: a working prototype that shows the intended look and behaviour. It is not production code. It keeps all data in the browser's `localStorage` and only simulates sending email, sending texts and calling. Rebuild it in a real stack (suggested below) with a shared database and a server that owns the integrations.

Open it locally by serving the folder (for example `npx serve .`) and opening `Wastely CRM.dc.html`. The logic is one class at the bottom of the file: `renderVals()` holds all derived data, and the seed data lives in `seed0()`, `seedComms()` and `SEED_TEAM`. Use it as your reference for behaviour.

## Fidelity
**High fidelity.** Colours, type, spacing and states come from the Nocturne design system (`_ds/.../styles.css`). Recreate them exactly; the tokens are listed below.

## Suggested architecture
- **Frontend:** React (Next.js App Router) + TypeScript. Port the Nocturne CSS tokens and classes as-is (`.btn`, `.tag`, `.input`, `.seg`, `.card`, `.table`, `.dialog`).
- **Backend:** Next.js route handlers or a small Node service. Postgres (Supabase or Neon) with Prisma or Drizzle.
- **Auth:** Google Workspace / Microsoft 365 SSO (the same OAuth grant is used for mail). One login per profile.
- **Secrets:** `QUO_API_KEY`, `QUO_WEBHOOK_SIGNING_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `MS_CLIENT_ID/SECRET` live only on the server. **The Quo key must never reach the browser.** The key pasted into the design chat should be revoked and replaced.
- **Realtime:** Supabase Realtime, Pusher or SSE, so a new inbound text or call shows up in the Inbox without a refresh.
- **Background jobs:** a queue (e.g. Inngest or BullMQ) for webhook processing and mail sync.

## Data model
```
User          id, name, role(Account manager|Dispatch|Billing|Leadership|Field), email, quoPhone, quoUserId, signature, mailProvider, mailTokens(encrypted)
CrewMember    id, name, role(Foreman|Operator|Driver|Labourer)            -- field staff, not app users
Client        id, name, type(Developer|Realtor|Commercial|Industrial|Property manager)
Contact       id, clientId, name, title, email, phone(E.164), quoContactId
Job           id, clientId, contactId, ownerId(User), title, site,
              stage(Lead|Site visit|Quoted|Negotiation|Won|Lost),
              status(Scheduled|On site|Completed)   -- only when stage=Won
              billing(Not invoiced|Deposit invoiced|Progress invoiced|Invoiced in full|Paid),
              value(cents), emergency(bool), start(date), end(date), createdAt
JobService    jobId, serviceId            -- a job can combine any number of services
Service       id, name, group, isCustom   -- 14 standard + user-added custom
JobCost       jobId, labour, equipment, disposal, hauling, permits (cents)
JobCrew       jobId, crewMemberId
Task          id, jobId?, assigneeId(User), title, type(Call|Visit|Dispatch|Invoice|Quote|Task), due(date), done
Communication id, jobId, contactId, userId?, kind(email|sms|call), direction(in|out), at,
              subject?, body?, durationSec?, recordingUrl?, transcript(JSON [{speaker, text, ts}])?, summary?,
              externalId (Gmail/Graph message id or Quo message/call id), threadRef
ReadMarker    userId, jobId, lastReadAt
Integration   provider(email|quo), settings JSON (see Integrations)
```

### Services (seed exactly)
- **Cleanouts & Disposal:** Estate Cleanout, Community Housing Turnover, Bulk Waste & Load-Out, Warehouse & Facility Clear-Outs, Recycling & Material Diversion
- **Hazardous & Regulated:** Commercial Hazardous Waste, Oil, Fuel & Chemical Disposal, Lithium Battery Disposal, E-Waste & Regulated Electronics
- **Abatement:** Asbestos Removal, Mould Removal
- **Clearing & Removal:** Interior Strip-Out, Industrial Dismantling & Decommissioning, Land Clearing & Site Prep
- **Custom:** free-text services added by users, reusable across jobs

### Business rules
- Minimum job value is **$5,000**. Creating a deal below that is blocked; existing jobs below it show a warning.
- A deal needs at least one service.
- Emergency 24/7 is available on any job and is shown as a siren badge.
- Moving a deal to **Won** sets `status = Scheduled`.
- Margin = (value − sum of cost lines) / value. Jobs below the **margin target** (default 30%, configurable) are flagged with a warning icon and accent-300 text.
- Crew conflicts: in the crew picker, show "on site at {client}" for anyone assigned to another job whose status is `On site`.

## Integrations

### Quo (texts, calls, recordings, transcripts)
Check the current reference at quo.com/docs before building. The docs show requests to `https://api.openphone.com/v1/...` with the header `Authorization: <api-key>` (no "Bearer"). The API is rate limited, reported at about 10 req/s.

- **Send a text:** `POST /v1/messages` from the signed-in user's Quo number to the contact's number. Store the returned id as `externalId`.
- **Receive events:** register webhooks (`/v1/webhooks/messages`, `/v1/webhooks/calls`, `/v1/webhooks/call-transcripts`, `/v1/webhooks/call-summaries`) pointing at `/api/webhooks/quo`. Events used: `message.received`, `message.delivered`, `call.completed`, `call.recording.completed`, `call.transcript.completed`, `call.summary.completed`.
- **Verify signatures** on every webhook. Legacy v1 sends an `openphone-signature: hmac;1;<ts>;<sig>` header; the newer versioned API uses Standard Webhooks headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`). Reply 2xx within 10 s and do the work in a job queue.
- **Match to a job:** normalise the other party's number to E.164, find the Contact, then attach the event to that contact's most recent open or active Job. If there's no match, put it in an "Unmatched" bucket in the Inbox.
- **Calls:** the prototype's "Call via Quo" button opens an in-app call panel. As far as I can tell from the public docs, the Quo API reads calls but cannot place them. So the button should open the Quo app or dialer (`tel:` link, or Quo's desktop app), and the call record, recording, transcript and summary arrive afterwards through webhooks. Keep the call panel only if you add a softphone SDK later; otherwise replace it with a "Calling in Quo…" state and the notes field.
- **Recording and transcription settings** (record, announce, transcribe, summarize) are set in Quo's own workspace settings. In the CRM, show them read-only or link out. Keep the "announce recording" notice on (consent rules vary by province).
- Transcripts and summaries depend on the Quo plan (summaries were reported as Business/Scale only). Hide those UI parts if the data is missing.

### Website forms (wastely.ca, repo `ny7fdnr79t-bit/Wastely`, GitHub Pages)
The site is static. Today every form (`QuoteForm.dc.html`, `ServicePage.dc.html`, `Wastely.dc.html`, `Contact.dc.html`, `Careers.dc.html`) builds a flat object `d` in `onSubmit` and POSTs it to `https://formsubmit.co/ajax/go@wastely.ca`.

- **Site change:** load `website/crm-forms.js` on every page, then call `sendToCrm(d, '<form name>')` right after the FormSubmit fetch. Keep FormSubmit as the email copy. Add a hidden `_gotcha` honeypot input to each form.
- **Endpoint:** `POST /api/forms` with body `{ form, page, submittedAt, fields }`. It is public, so:
  - allow CORS only from `https://wastely.ca` and the `*.github.io` origin
  - reject the request if `_gotcha` is filled
  - rate-limit by IP (e.g. 10/min)
  - optionally verify a Cloudflare Turnstile token
  - cap body size at ~32 KB
- **Storage:** save the raw payload as `WebSubmission { id, form, page, at, fields JSON, status(new|converted|archived), jobId? }`. Notify through realtime, and optionally with a Quo text or an email to the on-call account manager when a submission is urgent.
- **Field keys differ by form.** The Quote form uses `name, phone, email, location, details, services, Property size, How full is it?, Access, When, confirmed`. Contact and Careers use label text such as `Name, Company, Email, Phone, Site location, Timeline, Project details`. Match keys case-insensitively (see `pick()` in the prototype).
- **Mapping services:** `services` is a comma-joined list. Exact CRM service names are matched first. The rest (Contact form labels like "Warehouse or facility clear-out") are matched on their first 8 normalised letters (`mapService()`). Anything unmatched becomes a custom service. "Urgent — needed now", or `When` containing "emergency", sets `emergency = true`.
- **Create deal:** makes a Job with:
  - client = Company or Name; type = Commercial if there's a company, otherwise Private owner
  - stage Lead, owner = the current user
  - value = the midpoint of the `$X – $Y` range in `confirmed`, or $5,000
  - `source = "Website · <form>"`
  - It also adds a "Call back" task for today when that setting is on.
- **Careers submissions** can only be archived. Route them to hiring rather than the pipeline.

### Email
- **Google Workspace:** OAuth with Gmail scopes (`gmail.send`, `gmail.readonly`). Use `users.watch` + Pub/Sub for new mail, and `users.messages.send` to send.
- **Microsoft 365:** OAuth with Graph (`Mail.Send`, `Mail.Read`). Use a subscription on `/me/messages` for new mail and `/me/sendMail` to send.
- **Log email to jobs:** only store messages where a from/to address matches a Contact's email. Keep `threadRef` so replies stay together.
- If "Add my signature" is on, append the profile signature when sending.

## Screens

**Global layout:** CSS grid `212px | minmax(0,1fr)`. The sidebar is sticky, full height, with background `linear-gradient(180deg, --color-surface, --color-bg)`. The main area's padding is `calc(22.4px*1.4)` top and `calc(22.4px*1.6)` left/right.

**Sidebar:**
- Logo: a 26px outlined accent square with the Phosphor `recycle` icon, then "Wastely" at 17/500.
- Nav buttons: 7×10 padding, 14px text, 17px icons. The active item has a 14% accent tint and `--color-accent-200` text. Counts: open deals, active contracts, open tasks, unread inbox.
- Bottom: current profile (32px outlined avatar, name, role), a profile switcher select, and a "Reset demo data" ghost button (prototype only).

1. **Overview**
   - Header: date and "Overview" (h3 25px), and a "New deal" button.
   - Four KPI cards (`.card.elev-sm`, 28px/500 value): Open pipeline, Active contracts, Margin on active work, Awaiting payment.
   - Two columns (`auto-fit minmax(380px,1fr)`):
     - "On site now": clickable rows with client, "Day X of Y", title · city, a 3px progress bar, and crew names.
     - "Pipeline by stage": horizontal bars, 8px, gradient from accent-700 to accent.
   - "Due in the next 7 days": the task list.

2. **Pipeline**
   - Kanban with `grid-auto-flow:column; grid-auto-columns:minmax(232px,1fr)` and horizontal scroll.
   - Columns: Lead → Won (Lost is hidden by default).
   - Column header shows name, count and total, with a 2px stage colour mark underneath.
   - Cards (`.card.elev-sm`) show:
     - services label (11px uppercase accent-300) and a "24/7" outline tag
     - client (14/500) and title (13px neutral-400)
     - value (15px), margin (or "Not costed") and an owner-initials avatar
   - Dragging a card into a column moves it to that stage. The target column gets an 8% accent tint and an inset accent-700 ring.

3. **Contracts**
   - Won jobs only.
   - A segmented filter: All, Scheduled, On site, Completed (with counts).
   - Four totals: Contract value, Operating cost, Gross profit, Blended margin.
   - A `.table` with columns: Contract (client + siren icon, then title · services), Status tag, Dates, Value, Op. cost, Margin (with a warning icon when low), Crew (count · foreman), Billing tag.
   - Clicking a row opens the job panel.

4. **Tasks**
   - Assignee filter and an add form: title, job, assignee, due date.
   - Groups: Overdue (accent-300 heading), Today, Upcoming, Done.
   - Each row: checkbox icon, type icon, title, job link, assignee, due date, delete button.

5. **Inbox**
   - Two columns: `minmax(240px,300px) | 1fr`.
   - Left: a search box and threads (one per job contact), each with an unread dot, contact, client, last-item snippet and time.
   - Right header: contact name (h4), client, email and phone, plus "Open job" and "Call via Quo".
   - The timeline is in time order:
     - Texts are bubbles: outbound on the right with an 18% accent tint, inbound on the left on `--color-surface`.
     - Emails are cards with subject, from/to line and body.
     - Calls are cards with direction, duration, a recording player, the summary (with a 2px accent-700 left rule) and a "Show transcript" toggle. The transcript lists speaker and line; team speakers are in accent-300.
   - Composer: an Email/Text segmented switch, a subject field for email, the body and a send button. It shows the from-address or number, and a disabled state with an explanation when the integration isn't connected.
   - The timeline auto-scrolls to the bottom. Its minimum height is 260px.

5b. **Web leads**
   - Header with a segmented filter: New, Converted, Archived, All.
   - One `.card` per submission with:
     - form type (11px uppercase accent-300 with icon), Urgent and status tags
     - name (18/500), company · location, email and phone
     - time, source page and indicative price on the right
     - mapped service tags (`.tag-accent`)
     - a two-column key/value grid of the remaining fields
   - Actions: Create deal (opens the new job), Archive, "Deal: {client}" once converted, and "Move back to New" once archived.

6. **Team**
   - Profiles tab: a grid of cards (avatar, name, "You" tag, role, email, Quo number, jobs and open-task count), with Edit and "Switch to this profile". The New/Edit profile dialog has name, role, work email, Quo number and signature. Renaming someone updates their jobs and tasks.
   - Integrations tab: two cards, Email and Quo. Each has a status tag, the provider segment (email only), toggles, the mailbox or number list, and Connect/Disconnect.

**Job panel:** a right-hand panel, `min(540px,100%)`, `--shadow-lg`, over a 55% neutral-900 backdrop. Its sections:
- client type, a 24/7 tag, client and title
- stage and owner; for won jobs also status, billing, start and end
- site, contact, contact email and phone
- Conversation: Email, Text and Call buttons, plus the last 3 items
- Services: a Standard/Emergency segment, chips grouped by category plus Custom, and an "Add a custom service" field
- Contract value, the 5 cost-line inputs, then operating cost, gross profit and margin
- Crew on site: toggle cards, for won jobs only
- Tasks, with a quick-add field
- Delete deal and Done buttons

**New deal dialog:** `min(720px,100%)`, scrollable. It has:
- client, job, client type, estimated value, owner
- a Response segment (Standard / Emergency 24/7)
- the grouped service chips, a custom-service field and the validation message

## Design tokens (Nocturne)
- **Colours:**
  - bg `#161826`, surface `#232532`, text `#e9e9ed`, accent `#9184d9`
  - divider: text at 16%
  - neutral 100–900: `#f3f5fe #e4e7f5 #cfd3e5 #b2b6ca #9397ab #75798c #595d6c #3f424d #292b31`
  - accent 100–900: `#f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741`
- **Type:** Inter 400/500 (headings never above 500). Sizes: h3 25, h4 20, h5 16, h6 13 uppercase 0.08em; body 15, UI 13–14, meta 11–12.
- **Spacing:** 2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4 px (`--space-1..8`).
- **Radius:** 4 / 8 / 14.
- **Shadows:**
  - sm `0 0 0 1px #3f424d`
  - md `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)`
  - lg `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`
- **Rules:** fade out 48px at each end, e.g. `linear-gradient(to right, transparent, var(--color-divider) 48px, var(--color-divider) calc(100% - 48px), transparent)`.
- **Buttons:** primary is an accent outline, never filled. Focus is a 2px accent outline with 2px offset. Use `color-scheme: dark`.

## Assets
- Icons: Phosphor, regular weight (`@phosphor-icons/web` or `@phosphor-icons/react`).
- No images.

## Files
- `Wastely CRM.dc.html`: the full prototype (template + logic class).
- `support.js`: the runtime needed to open the prototype locally.
- `_ds/nocturne-2644e86a-d30a-4bff-9abf-1b30323e10ad/styles.css`: the design tokens and component classes to port.
