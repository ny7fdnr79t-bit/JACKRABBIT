-- Wastely CRM — invoices and client agreements.
-- Clients reach documents only through an unguessable token, served by the
-- app's server code; nothing here is readable by anonymous users.

-- ── Company details printed on documents ────────────────────────────────

alter table app_settings
  add column company_name    text not null default 'Wastely',
  add column company_address text not null default '',
  add column company_email   text not null default 'go@wastely.ca',
  add column company_phone   text not null default '',
  add column hst_number      text not null default '',
  add column tax_rate        numeric(5,2) not null default 13.00 check (tax_rate between 0 and 30),
  add column tax_label       text not null default 'HST',
  add column payment_days    int not null default 15 check (payment_days between 0 and 120),
  add column deposit_pct     int not null default 30 check (deposit_pct between 0 and 100),
  add column etransfer_email text not null default '',
  add column invoice_footer  text not null default 'Thank you for choosing Wastely.';

create function random_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- ── Invoices ────────────────────────────────────────────────────────────

create sequence invoice_seq start 1001;

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique default ('INV-' || nextval('invoice_seq')),
  job_id            uuid not null references jobs (id) on delete restrict,
  kind              text not null check (kind in ('Deposit', 'Progress', 'Final')),
  status            text not null default 'Draft' check (status in ('Draft', 'Sent', 'Paid', 'Void')),
  issue_date        date not null default current_date,
  due_date          date not null default current_date + 15,
  -- [{ "description": text, "qty": number, "unit_cents": int }]
  lines             jsonb not null default '[]' check (jsonb_typeof(lines) = 'array'),
  tax_rate          numeric(5,2) not null default 13.00,
  tax_label         text not null default 'HST',
  subtotal_cents    bigint not null default 0,
  tax_cents         bigint not null default 0,
  total_cents       bigint not null default 0,
  notes             text not null default '',
  bill_to           jsonb not null default '{}',   -- client name, contact, email, site at time of issue
  pay_token         text not null unique default random_token(),
  stripe_session_id text,
  stripe_payment_id text,
  sent_at           timestamptz,
  paid_at           timestamptz,
  paid_via          text check (paid_via in ('Stripe', 'E-transfer', 'Cheque', 'Other')),
  created_by        uuid references profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index invoices_job_idx on invoices (job_id);
create index invoices_status_idx on invoices (status);

-- Totals are always computed here, and a sent invoice can't be edited.
create function invoices_rules() returns trigger
language plpgsql as $$
declare
  sub bigint;
begin
  if tg_op = 'UPDATE' and old.status <> 'Draft' then
    if new.lines is distinct from old.lines or new.tax_rate is distinct from old.tax_rate
       or new.kind is distinct from old.kind or new.job_id is distinct from old.job_id
       or new.issue_date is distinct from old.issue_date or new.bill_to is distinct from old.bill_to then
      raise exception 'Invoice % has been sent and can no longer be edited. Void it and make a new one.', old.number
        using errcode = 'check_violation';
    end if;
    if old.status in ('Paid', 'Void') and new.status is distinct from old.status then
      raise exception 'Invoice % is %.', old.number, lower(old.status) using errcode = 'check_violation';
    end if;
  end if;

  select coalesce(sum(round(coalesce((l ->> 'qty')::numeric, 1) * coalesce((l ->> 'unit_cents')::numeric, 0))), 0)
    into sub from jsonb_array_elements(new.lines) l;
  new.subtotal_cents := sub;
  new.tax_cents := round(sub * new.tax_rate / 100);
  new.total_cents := new.subtotal_cents + new.tax_cents;

  if new.status = 'Sent' and new.sent_at is null then new.sent_at := now(); end if;
  if new.status = 'Paid' and new.paid_at is null then new.paid_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger invoices_rules
  before insert or update on invoices
  for each row execute function invoices_rules();

-- Keeps jobs.billing in step with the job's invoices.
create function sync_job_billing(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  live int; unpaid int; has_final boolean; has_progress boolean; has_deposit boolean;
begin
  select count(*) filter (where status in ('Sent', 'Paid')),
         count(*) filter (where status = 'Sent'),
         bool_or(kind = 'Final' and status in ('Sent', 'Paid')),
         bool_or(kind = 'Progress' and status in ('Sent', 'Paid')),
         bool_or(kind = 'Deposit' and status in ('Sent', 'Paid'))
    into live, unpaid, has_final, has_progress, has_deposit
    from invoices where job_id = p_job;

  update jobs set billing = case
      when live = 0 then 'Not invoiced'
      when has_final and unpaid = 0 then 'Paid'
      when has_final then 'Invoiced in full'
      when has_progress then 'Progress invoiced'
      when has_deposit then 'Deposit invoiced'
      else billing end
  where id = p_job;
end;
$$;

create function invoices_sync_billing() returns trigger
language plpgsql as $$
begin
  perform sync_job_billing(coalesce(new.job_id, old.job_id));
  return null;
end;
$$;

create trigger invoices_sync_billing
  after insert or update of status or delete on invoices
  for each row execute function invoices_sync_billing();

-- ── Agreements (client contracts) ───────────────────────────────────────

create table agreement_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  body       text not null,      -- Markdown-ish text with {{placeholders}}
  is_default boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index agreement_templates_one_default on agreement_templates (is_default) where is_default;

create sequence agreement_seq start 1001;

create table agreements (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique default ('AGR-' || nextval('agreement_seq')),
  job_id           uuid not null references jobs (id) on delete restrict,
  template_id      uuid references agreement_templates (id) on delete set null,
  status           text not null default 'Draft' check (status in ('Draft', 'Sent', 'Signed', 'Void')),
  title            text not null default 'Service Agreement',
  body             text not null,
  price_cents      bigint not null default 0,
  sign_token       text not null unique default random_token(),
  sent_at          timestamptz,
  viewed_at        timestamptz,
  signed_at        timestamptz,
  signer_name      text,
  signer_title     text,
  signer_email     text,
  signer_ip        text,
  signer_agent     text,
  signature        text,          -- PNG data URL of the drawn signature
  body_sha256      text,          -- hash of exactly what was signed
  created_by       uuid references profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index agreements_job_idx on agreements (job_id);

create function agreements_rules() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.status <> 'Draft' then
    raise exception 'New agreements start as drafts.' using errcode = 'check_violation';
  end if;
  if new.status = 'Signed' and (new.signature is null or new.signer_name is null or new.body_sha256 is null) then
    raise exception 'An agreement is signed only by the client through its signing link.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'Signed' and (new.status <> 'Signed' or new.body is distinct from old.body
       or new.signer_name is distinct from old.signer_name or new.signature is distinct from old.signature
       or new.price_cents is distinct from old.price_cents) then
      raise exception 'Agreement % is signed and can''t be changed.', old.number using errcode = 'check_violation';
    end if;
    if old.status <> 'Draft' and (new.body is distinct from old.body or new.title is distinct from old.title
       or new.price_cents is distinct from old.price_cents) then
      raise exception 'Agreement % has been sent. Void it and make a new one to change the wording.', old.number
        using errcode = 'check_violation';
    end if;
    if old.status = 'Void' and new.status <> 'Void' then
      raise exception 'Agreement % is void.', old.number using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'Sent' and new.sent_at is null then new.sent_at := now(); end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger agreements_rules
  before insert or update on agreements
  for each row execute function agreements_rules();

-- Only drafts can be deleted; anything a client has seen is voided instead.
create function documents_delete_drafts_only() returns trigger
language plpgsql as $$
begin
  if old.status <> 'Draft' then
    raise exception '% is %, so it can''t be deleted. Void it instead.', old.number, lower(old.status)
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger invoices_delete_drafts_only before delete on invoices
  for each row execute function documents_delete_drafts_only();
create trigger agreements_delete_drafts_only before delete on agreements
  for each row execute function documents_delete_drafts_only();

-- ── Row level security ──────────────────────────────────────────────────

alter table invoices            enable row level security;
alter table agreements          enable row level security;
alter table agreement_templates enable row level security;

create policy "invoices: members" on invoices for all to authenticated
  using (is_member()) with check (is_member());
create policy "agreements: members" on agreements for all to authenticated
  using (is_member()) with check (is_member());
create policy "agreement_templates: members read" on agreement_templates for select to authenticated using (is_member());
create policy "agreement_templates: leadership writes" on agreement_templates for all to authenticated
  using (is_leadership()) with check (is_leadership());

-- Signature columns are written only by the app server (service role) when
-- the client signs; members can't insert or change them.
revoke insert, update on agreements from authenticated;
grant insert (job_id, template_id, title, body, price_cents, created_by) on agreements to authenticated;
grant update (template_id, status, title, body, price_cents) on agreements to authenticated;

alter publication supabase_realtime add table invoices, agreements;

-- ── Starting template ───────────────────────────────────────────────────
-- A first draft for Wastely to adapt. Have a lawyer review it before use.

insert into agreement_templates (name, is_default, body) values ('Standard service agreement', true, $tpl$
# Service Agreement

This agreement is made on {{agreement_date}} between **{{company_name}}** ("Wastely"){{company_address_line}} and **{{client_name}}** (the "Client"){{client_contact_line}}.

## 1. Scope of work

Wastely will provide the following services at **{{site}}**:

{{services_list}}

Job: {{job_title}}.

Work not listed above is not included unless both parties agree to it in writing (see section 8).

## 2. Schedule

Work is planned to start on {{start_date}} and finish on {{end_date}}. Dates may move because of weather, site access, permits, or conditions found on site. Wastely will tell the Client promptly about any delay.

{{emergency_clause}}

## 3. Price and payment

- Contract price: **{{price}}** plus {{tax_label}} ({{tax_rate}}%), for a total of **{{total}}**.
- A deposit of {{deposit_pct}}% (**{{deposit}}** plus {{tax_label}}) is due before work starts. The balance is invoiced as work progresses and on completion.
- Invoices are due within {{payment_days}} days. Payment can be made by card through the link on each invoice, or by e-transfer or cheque.
- Overdue amounts carry interest of 1.5% per month (18% per year) until paid.

## 4. Client responsibilities

The Client will:

- give Wastely safe, clear access to the site, including keys, parking, elevators and loading areas, during agreed hours;
- provide water and electricity where the work needs them;
- tell Wastely in writing, before work starts, about any known asbestos, mould, chemicals, fuel, batteries, sharps, biohazards or other hazardous materials;
- remove, or clearly mark, anything that must not be removed or disposed of;
- confirm that they own, or are authorised to dispose of, everything Wastely is asked to remove.

## 5. Hazardous and designated substances

Hazardous waste is handled, transported and disposed of at licensed facilities as required by Ontario law, including O. Reg. 347 (General – Waste Management). Asbestos work follows O. Reg. 278/05 (Designated Substance – Asbestos on Construction Projects). Waste manifests and disposal records are available on request.

If Wastely finds hazardous materials that were not disclosed or were not part of the scope, it may stop the affected work, secure the area and tell the Client. Further work on those materials needs a written change order.

## 6. Ownership of removed materials

Once removed from the site, materials become Wastely's responsibility to dispose of, recycle or donate, unless the Client has set specific items aside in writing before removal.

## 7. Safety and insurance

Wastely carries commercial general liability insurance and WSIB coverage, and follows the Occupational Health and Safety Act and its regulations. Certificates are available on request.

## 8. Changes to the work

Any change to the scope, schedule or price must be agreed in a written change order (email is enough) before the changed work is done.

## 9. Liability

Wastely is not responsible for conditions that existed before the work started, for concealed conditions, or for normal wear from the work. Wastely's total liability under this agreement is limited to the contract price. Neither party is liable for indirect or consequential losses.

## 10. Cancellation

Either party may cancel by written notice. If the Client cancels less than 48 hours before the planned start, or after work has started, the Client pays for work done, mobilisation, equipment and disposal costs already incurred. Any remaining deposit is refunded.

## 11. Completion

The work is complete when the scope above is done and the site is left broom-clean. Where abatement requires clearance testing, it is done by an independent party, and the work is complete once that test passes.

## 12. General

This agreement is governed by the laws of Ontario. It is the entire agreement between the parties for this work and replaces any earlier quotes or discussions. Electronic signatures are binding, as permitted by the Electronic Commerce Act, 2000.
$tpl$);
