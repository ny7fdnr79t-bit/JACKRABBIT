-- Wastely CRM — app changes built from inside the CRM.
-- A feature request is filed as a GitHub issue; Claude Code builds it on a
-- branch and pull request; Vercel makes a preview; Leadership publishes it
-- (merges the pull request) from the CRM. Live status comes from GitHub; these
-- columns record what the CRM itself did and who did it.

alter table feature_requests
  add column kind          text not null default 'feature' check (kind in ('feature', 'rollback')),
  add column pr_number     int,
  add column status        text not null default 'building'
                           check (status in ('building', 'ready', 'published', 'discarded', 'failed')),
  add column published_at  timestamptz,
  add column published_by  uuid references profiles (id) on delete set null,
  add column discarded_at  timestamptz,
  add column updated_at    timestamptz not null default now();

-- Revision requests and decisions, newest last.
create table build_events (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references feature_requests (id) on delete cascade,
  user_id    uuid not null default auth.uid() references profiles (id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null check (kind in ('requested', 'feedback', 'published', 'discarded', 'rollback')),
  note       text not null default ''
);
create index build_events_request_idx on build_events (request_id, at);

alter table build_events enable row level security;
create policy "build_events: members read" on build_events for select to authenticated using (is_member());
create policy "build_events: leadership writes" on build_events for insert to authenticated
  with check (is_leadership() and user_id = auth.uid());

alter publication supabase_realtime add table feature_requests, build_events;
