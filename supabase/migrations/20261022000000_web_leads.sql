-- Wastely CRM — website form leads.
-- wastely.ca posts to the app's /api/forms, which stores each submission
-- here with the service role (signed-out visitors can't touch this table).
-- ip_hash is a keyed hash of the sender's IP, used only for rate limiting.

alter table web_submissions add column if not exists ip_hash text;
create index if not exists web_submissions_ip_idx on web_submissions (ip_hash, at desc);

-- Turns a new submission into a deal in one transaction: the job (through
-- create_deal, so the usual rules apply), its site and contact, the
-- optional call-back task, and the submission's status and link.
create or replace function convert_web_submission(
  p_submission    uuid,
  p_client        text,
  p_client_type   text,
  p_title         text,
  p_value_cents   bigint,
  p_owner_id      uuid,
  p_emergency     boolean,
  p_services      text[],
  p_site          text,
  p_contact_name  text,
  p_contact_email text,
  p_contact_phone text,
  p_today         date
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_sub     web_submissions%rowtype;
  v_job     uuid;
  v_client  uuid;
  v_contact uuid;
  v_first   text;
begin
  select * into v_sub from web_submissions where id = p_submission for update;
  if not found then
    raise exception 'That web lead no longer exists.' using errcode = 'no_data_found';
  end if;
  if v_sub.status <> 'new' then
    raise exception 'That web lead was already converted or archived.' using errcode = 'check_violation';
  end if;

  v_job := create_deal(p_client, p_client_type, p_title, p_value_cents, p_owner_id, p_emergency, p_services,
                       'Website · ' || v_sub.form);
  select client_id into v_client from jobs where id = v_job;

  if nullif(trim(coalesce(p_site, '')), '') is not null then
    update jobs set site = trim(p_site) where id = v_job;
  end if;

  if coalesce(trim(p_contact_name), '') <> '' or coalesce(trim(p_contact_email), '') <> '' or coalesce(trim(p_contact_phone), '') <> '' then
    select id into v_contact from contacts
     where client_id = v_client
       and ((nullif(trim(p_contact_email), '') is not null and email = trim(p_contact_email)::citext)
         or (nullif(trim(p_contact_phone), '') is not null and phone = trim(p_contact_phone)))
     limit 1;
    if v_contact is null then
      insert into contacts (client_id, name, email, phone)
      values (v_client, coalesce(trim(p_contact_name), ''), nullif(trim(p_contact_email), ''), nullif(trim(p_contact_phone), ''))
      returning id into v_contact;
    end if;
    update jobs set contact_id = v_contact where id = v_job;
  end if;

  if (select callback_task from app_settings where id = 1) then
    v_first := split_part(coalesce(nullif(trim(p_contact_name), ''), trim(p_client)), ' ', 1);
    insert into tasks (job_id, assignee_id, title, type, due)
    values (v_job, p_owner_id, 'Call back ' || v_first || ' about website ' || lower(v_sub.form), 'Call', coalesce(p_today, current_date));
  end if;

  update web_submissions set status = 'converted', job_id = v_job where id = p_submission;
  return v_job;
end;
$$;

revoke execute on function convert_web_submission(uuid, text, text, text, bigint, uuid, boolean, text[], text, text, text, text, date) from public, anon;
grant execute on function convert_web_submission(uuid, text, text, text, bigint, uuid, boolean, text[], text, text, text, text, date) to authenticated, service_role;
