-- Wastely CRM — the CRM suggests its own improvements.
-- A weekly review reads how the CRM is used (screens, errors, what people ask
-- the assistant) and proposes builds. Suggestions wait on the Builds screen
-- until someone in Leadership chooses Build it or Dismiss.

-- ── Signals ─────────────────────────────────────────────────────────────

-- Screen views and errors people hit, written by the app as it's used.
create table app_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid not null default auth.uid() references profiles (id) on delete cascade,
  kind    text not null check (kind in ('view', 'error')),
  screen  text not null default '' check (length(screen) <= 60),
  message text not null default '' check (length(message) <= 500)
);
create index app_events_at_idx on app_events (at desc);

-- Every question asked of the assistant and how it went.
create table assistant_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references profiles (id) on delete cascade,
  prompt      text not null check (length(prompt) <= 2000),
  tools       text[] not null default '{}',
  tool_errors text[] not null default '{}',
  outcome     text not null check (outcome in ('ok', 'error', 'refusal', 'limit')),
  reply       text not null default '' check (length(reply) <= 600)
);
create index assistant_log_at_idx on assistant_log (at desc);

alter table app_events    enable row level security;
alter table assistant_log enable row level security;

create policy "app_events: write own" on app_events for insert to authenticated with check (is_member() and user_id = auth.uid());
create policy "app_events: leadership reads" on app_events for select to authenticated using (is_leadership());
create policy "assistant_log: write own" on assistant_log for insert to authenticated with check (is_member() and user_id = auth.uid());
create policy "assistant_log: leadership reads" on assistant_log for select to authenticated using (is_leadership());

-- ── Suggestions live alongside requested builds ─────────────────────────

alter table feature_requests drop constraint feature_requests_status_check;
alter table feature_requests add constraint feature_requests_status_check
  check (status in ('suggested', 'dismissed', 'building', 'ready', 'published', 'discarded', 'failed'));
alter table feature_requests drop constraint feature_requests_kind_check;
alter table feature_requests add constraint feature_requests_kind_check
  check (kind in ('feature', 'rollback', 'suggestion'));
alter table feature_requests
  alter column user_id drop not null,       -- the scheduled review has no person behind it
  add column reason   text not null default '',  -- the evidence behind a suggestion
  add column impact   text check (impact in ('low', 'medium', 'high')),
  add column effort   text check (effort in ('small', 'medium', 'large'));

alter table build_events drop constraint build_events_kind_check;
alter table build_events add constraint build_events_kind_check
  check (kind in ('requested', 'feedback', 'published', 'discarded', 'rollback', 'suggested', 'approved', 'dismissed'));

-- One row per review, so the team can see when it last ran and what it cost.
create table self_reviews (
  id            uuid primary key default gen_random_uuid(),
  at            timestamptz not null default now(),
  triggered_by  uuid references profiles (id) on delete set null,
  suggestions   int not null default 0,
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  summary       text not null default ''
);
alter table self_reviews enable row level security;
create policy "self_reviews: members read" on self_reviews for select to authenticated using (is_member());
create policy "self_reviews: leadership writes" on self_reviews for insert to authenticated with check (is_leadership());

-- Keep the signal tables small: the review only looks at the last 30 days.
create function prune_signals() returns void language sql security definer set search_path = public as $$
  delete from app_events where at < now() - interval '90 days';
  delete from assistant_log where at < now() - interval '90 days';
$$;
