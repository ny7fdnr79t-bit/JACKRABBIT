-- Wastely CRM — one Leads inbox: website form submissions plus calls and
-- texts the team logs by hand. Website rows are written by /api/forms with
-- the service role; logged rows by the member who logged them.

alter table web_submissions
  add column created_by uuid references profiles (id) on delete set null default auth.uid(),
  add column updated_at timestamptz not null default now();

-- Keep form names and field values bounded no matter who writes them.
alter table web_submissions add constraint web_submissions_form_len check (length(form) <= 60);
alter table web_submissions add constraint web_submissions_fields_obj check (jsonb_typeof(fields) = 'object');

-- A converted lead must point at its deal.
alter table web_submissions add constraint web_submissions_converted_job check (status <> 'converted' or job_id is not null);

create index web_submissions_at_idx on web_submissions (at desc);
