-- Wastely CRM — the in-app assistant: custom job fields and an undoable
-- change log. The assistant acts with the signed-in person's own session,
-- so row level security applies to everything it does.

-- ── Custom job fields ───────────────────────────────────────────────────
-- [{ "id": "f_bin_size", "label": "Bin size", "type": "text" | "number" | "date" }]
alter table app_settings add column job_fields jsonb not null default '[]' check (jsonb_typeof(job_fields) = 'array');
alter table jobs add column extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object');

-- ── Change log ──────────────────────────────────────────────────────────
-- One row per change the assistant makes. `undo` holds the operations that
-- reverse it ([{table, op, match, values}]), replayed newest first.
create table ai_actions (
  id         uuid primary key default gen_random_uuid(),
  turn_id    uuid not null,
  user_id    uuid not null default auth.uid() references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  prompt     text not null default '',
  tool       text not null,
  summary    text not null,
  input      jsonb not null default '{}',
  undo       jsonb not null default '[]' check (jsonb_typeof(undo) = 'array'),
  undone_at  timestamptz
);
create index ai_actions_turn_idx on ai_actions (turn_id);
create index ai_actions_recent_idx on ai_actions (created_at desc);

alter table ai_actions enable row level security;

-- The whole team can see what the assistant changed, and who asked.
create policy "ai_actions: members read" on ai_actions for select to authenticated using (is_member());
create policy "ai_actions: write own" on ai_actions for insert to authenticated
  with check (is_member() and user_id = auth.uid());
-- Only marking your own changes as undone.
create policy "ai_actions: undo own" on ai_actions for update to authenticated
  using (is_member() and user_id = auth.uid()) with check (is_member() and user_id = auth.uid());
revoke update on ai_actions from authenticated;
grant update (undone_at) on ai_actions to authenticated;

-- ── Feature requests filed from the assistant ───────────────────────────
create table feature_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  title       text not null,
  description text not null,
  issue_url   text,
  issue_number int
);
alter table feature_requests enable row level security;
create policy "feature_requests: members read" on feature_requests for select to authenticated using (is_member());
create policy "feature_requests: leadership files" on feature_requests for insert to authenticated
  with check (is_leadership() and user_id = auth.uid());
create policy "feature_requests: leadership updates" on feature_requests for update to authenticated
  using (is_leadership()) with check (is_leadership());

alter publication supabase_realtime add table ai_actions;
