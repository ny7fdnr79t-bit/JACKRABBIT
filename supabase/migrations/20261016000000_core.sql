-- Wastely CRM — core schema.
-- Money is stored in cents. Every table is readable and writable by active
-- team members only (see is_member()); nothing is exposed to anonymous users.

create extension if not exists citext;

-- ── Team ────────────────────────────────────────────────────────────────

-- Email domains whose Google / Microsoft sign-ins become active members
-- automatically. Anyone else lands on "access pending" until Leadership
-- activates them.
create table allowed_domains (
  domain citext primary key
);
insert into allowed_domains (domain) values ('wastely.ca');

create table profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null default '',
  role          text not null default 'Account manager'
                check (role in ('Account manager', 'Dispatch', 'Billing', 'Leadership', 'Field')),
  email         citext not null,
  quo_phone     text,            -- E.164
  quo_user_id   text,
  signature     text not null default '',
  mail_provider text check (mail_provider in ('google', 'microsoft')),
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Field staff. They are not app users.
create table crew_members (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text not null check (role in ('Foreman', 'Operator', 'Driver', 'Labourer')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create function is_leadership() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'Leadership');
$$;

-- Creates a profile for every new auth user. The very first user becomes
-- Leadership so someone can activate the rest.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean := not exists (select 1 from profiles);
  domain_ok  boolean := exists (
    select 1 from allowed_domains where domain = split_part(new.email, '@', 2)::citext
  );
begin
  insert into profiles (id, name, email, role, active, mail_provider)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    case when first_user then 'Leadership' else 'Account manager' end,
    first_user or domain_ok,
    case new.raw_app_meta_data ->> 'provider' when 'google' then 'google' when 'azure' then 'microsoft' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Settings ────────────────────────────────────────────────────────────

create table app_settings (
  id             int primary key default 1 check (id = 1),
  margin_target  int not null default 30 check (margin_target between 1 and 99),
  min_job_cents  bigint not null default 500000,
  stages         text[] not null default array['Lead', 'Site visit', 'Quoted', 'Negotiation', 'Won', 'Lost'],
  show_lost      boolean not null default false,
  callback_task  boolean not null default true
);
insert into app_settings default values;

-- ── Clients and contacts ────────────────────────────────────────────────

create table clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null default 'Commercial'
             check (type in ('Developer', 'Realtor', 'Commercial', 'Industrial', 'Property manager', 'Private owner')),
  created_at timestamptz not null default now()
);
create unique index clients_name_key on clients (lower(name));

create table contacts (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete cascade,
  name           text not null default '',
  title          text not null default '',
  email          citext,
  phone          text,            -- E.164
  quo_contact_id text,
  created_at     timestamptz not null default now()
);
create index contacts_client_idx on contacts (client_id);
create index contacts_email_idx on contacts (email);
create index contacts_phone_idx on contacts (phone);

-- ── Services ────────────────────────────────────────────────────────────

create table services (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  grp        text not null default 'Custom',
  is_custom  boolean not null default false,
  sort       int not null default 1000,
  created_at timestamptz not null default now()
);
create unique index services_name_key on services (lower(name));

insert into services (name, grp, sort) values
  ('Estate Cleanout',                         'Cleanouts & Disposal',  10),
  ('Community Housing Turnover',              'Cleanouts & Disposal',  11),
  ('Bulk Waste & Load-Out',                   'Cleanouts & Disposal',  12),
  ('Warehouse & Facility Clear-Outs',         'Cleanouts & Disposal',  13),
  ('Recycling & Material Diversion',          'Cleanouts & Disposal',  14),
  ('Commercial Hazardous Waste',              'Hazardous & Regulated', 20),
  ('Oil, Fuel & Chemical Disposal',           'Hazardous & Regulated', 21),
  ('Lithium Battery Disposal',                'Hazardous & Regulated', 22),
  ('E-Waste & Regulated Electronics',         'Hazardous & Regulated', 23),
  ('Asbestos Removal',                        'Abatement',             30),
  ('Mould Removal',                           'Abatement',             31),
  ('Interior Strip-Out',                      'Clearing & Removal',    40),
  ('Industrial Dismantling & Decommissioning','Clearing & Removal',    41),
  ('Land Clearing & Site Prep',               'Clearing & Removal',    42);

-- ── Jobs ────────────────────────────────────────────────────────────────

create table jobs (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete restrict,
  contact_id  uuid references contacts (id) on delete set null,
  owner_id    uuid references profiles (id) on delete set null,
  title       text not null,
  site        text not null default '',
  stage       text not null default 'Lead',
  status      text check (status in ('Scheduled', 'On site', 'Completed')),   -- only when stage = Won
  billing     text not null default 'Not invoiced'
              check (billing in ('Not invoiced', 'Deposit invoiced', 'Progress invoiced', 'Invoiced in full', 'Paid')),
  value_cents bigint not null default 0 check (value_cents >= 0),
  emergency   boolean not null default false,
  start_date  date,
  end_date    date,
  source      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index jobs_stage_idx on jobs (stage);
create index jobs_client_idx on jobs (client_id);

create table job_costs (
  job_id          uuid primary key references jobs (id) on delete cascade,
  labour_cents    bigint not null default 0 check (labour_cents >= 0),
  equipment_cents bigint not null default 0 check (equipment_cents >= 0),
  disposal_cents  bigint not null default 0 check (disposal_cents >= 0),
  hauling_cents   bigint not null default 0 check (hauling_cents >= 0),
  permits_cents   bigint not null default 0 check (permits_cents >= 0)
);

create table job_services (
  job_id     uuid not null references jobs (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  primary key (job_id, service_id)
);

create table job_crew (
  job_id         uuid not null references jobs (id) on delete cascade,
  crew_member_id uuid not null references crew_members (id) on delete cascade,
  primary key (job_id, crew_member_id)
);

-- Business rules that hold no matter which client writes the row.
create function jobs_rules() returns trigger
language plpgsql as $$
declare
  min_cents bigint := (select min_job_cents from app_settings where id = 1);
begin
  if tg_op = 'INSERT' and new.value_cents < min_cents then
    raise exception 'Jobs start at $%.', to_char(min_cents / 100, 'FM999,999,999')
      using errcode = 'check_violation';
  end if;
  -- Moving a deal to Won schedules it.
  if new.stage = 'Won' and (tg_op = 'INSERT' or old.stage is distinct from 'Won') then
    new.status := coalesce(case when tg_op = 'INSERT' then new.status end, 'Scheduled');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_rules
  before insert or update on jobs
  for each row execute function jobs_rules();

create function jobs_add_costs() returns trigger
language plpgsql as $$
begin
  insert into job_costs (job_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger jobs_add_costs
  after insert on jobs
  for each row execute function jobs_add_costs();

-- ── Tasks ───────────────────────────────────────────────────────────────

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs (id) on delete cascade,
  assignee_id uuid references profiles (id) on delete set null,
  title       text not null,
  type        text not null default 'Task' check (type in ('Call', 'Visit', 'Dispatch', 'Invoice', 'Quote', 'Task')),
  due         date not null default current_date,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index tasks_due_idx on tasks (due) where not done;
create index tasks_job_idx on tasks (job_id);

-- ── Communication (filled by the Quo and mail integrations later) ───────

create table communications (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid references jobs (id) on delete set null,
  contact_id    uuid references contacts (id) on delete set null,
  user_id       uuid references profiles (id) on delete set null,
  kind          text not null check (kind in ('email', 'sms', 'call')),
  direction     text not null check (direction in ('in', 'out')),
  at            timestamptz not null default now(),
  subject       text,
  body          text,
  duration_sec  int,
  recording_url text,
  transcript    jsonb,           -- [{speaker, text, ts}]
  summary       text,
  external_id   text,
  thread_ref    text
);
create index communications_job_idx on communications (job_id, at);
create unique index communications_external_key on communications (kind, external_id) where external_id is not null;

create table read_markers (
  user_id      uuid not null references profiles (id) on delete cascade,
  job_id       uuid not null references jobs (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (user_id, job_id)
);

create table web_submissions (
  id     uuid primary key default gen_random_uuid(),
  form   text not null,
  page   text not null default '',
  at     timestamptz not null default now(),
  fields jsonb not null,
  status text not null default 'new' check (status in ('new', 'converted', 'archived')),
  job_id uuid references jobs (id) on delete set null
);
create index web_submissions_status_idx on web_submissions (status, at desc);

create table integrations (
  provider text primary key check (provider in ('email', 'quo')),
  settings jsonb not null default '{}'
);

-- ── create_deal: one atomic call for the New deal dialog ────────────────

create function create_deal(
  p_client      text,
  p_client_type text,
  p_title       text,
  p_value_cents bigint,
  p_owner_id    uuid,
  p_emergency   boolean,
  p_services    text[],
  p_source      text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_client uuid;
  v_job    uuid;
  v_name   text;
begin
  if coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'Pick at least one service.' using errcode = 'check_violation';
  end if;

  select id into v_client from clients where lower(name) = lower(trim(p_client));
  if v_client is null then
    insert into clients (name, type) values (trim(p_client), p_client_type) returning id into v_client;
  end if;

  insert into jobs (client_id, owner_id, title, value_cents, emergency, source)
  values (v_client, p_owner_id, trim(p_title), p_value_cents, p_emergency, p_source)
  returning id into v_job;

  foreach v_name in array p_services loop
    insert into services (name, is_custom) values (trim(v_name), true)
      on conflict ((lower(name))) do nothing;
    insert into job_services (job_id, service_id)
      select v_job, id from services where lower(name) = lower(trim(v_name))
      on conflict do nothing;
  end loop;

  return v_job;
end;
$$;

-- Returns the services with these names, creating custom ones as needed.
create function ensure_services(p_names text[]) returns setof services
language plpgsql security invoker set search_path = public as $$
declare v_name text;
begin
  foreach v_name in array p_names loop
    if trim(v_name) <> '' then
      insert into services (name, is_custom) values (trim(v_name), true)
        on conflict ((lower(name))) do nothing;
    end if;
  end loop;
  return query select * from services where lower(name) in (select lower(trim(n)) from unnest(p_names) n);
end;
$$;

-- ── Row level security ──────────────────────────────────────────────────

alter table allowed_domains enable row level security;
alter table profiles        enable row level security;
alter table crew_members    enable row level security;
alter table app_settings    enable row level security;
alter table clients         enable row level security;
alter table contacts        enable row level security;
alter table services        enable row level security;
alter table jobs            enable row level security;
alter table job_costs       enable row level security;
alter table job_services    enable row level security;
alter table job_crew        enable row level security;
alter table tasks           enable row level security;
alter table communications  enable row level security;
alter table read_markers    enable row level security;
alter table web_submissions enable row level security;
alter table integrations    enable row level security;

-- Everyone can see their own profile (so the app can show "access pending").
create policy "profiles: read own or as member" on profiles for select to authenticated
  using (id = auth.uid() or is_member());
create policy "profiles: update own" on profiles for update to authenticated
  using (id = auth.uid() and is_member())
  with check (id = auth.uid() and active and role = my_role());
create policy "profiles: leadership manages" on profiles for update to authenticated
  using (is_leadership()) with check (is_leadership());

create policy "allowed_domains: leadership" on allowed_domains for all to authenticated
  using (is_leadership()) with check (is_leadership());
create policy "app_settings: members read" on app_settings for select to authenticated using (is_member());
create policy "app_settings: leadership writes" on app_settings for update to authenticated
  using (is_leadership()) with check (is_leadership());
create policy "integrations: members read" on integrations for select to authenticated using (is_member());
create policy "integrations: leadership writes" on integrations for all to authenticated
  using (is_leadership()) with check (is_leadership());

-- Shared working data: any active member can read and write.
do $$
declare t text;
begin
  foreach t in array array['crew_members', 'clients', 'contacts', 'services', 'jobs', 'job_costs',
                           'job_services', 'job_crew', 'tasks', 'communications', 'web_submissions'] loop
    execute format('create policy "%1$s: members" on %1$I for all to authenticated using (is_member()) with check (is_member())', t);
  end loop;
end;
$$;

create policy "read_markers: own" on read_markers for all to authenticated
  using (user_id = auth.uid() and is_member()) with check (user_id = auth.uid() and is_member());

-- ── Realtime ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table
  profiles, crew_members, app_settings, clients, contacts, services,
  jobs, job_costs, job_services, job_crew, tasks, communications, web_submissions;
