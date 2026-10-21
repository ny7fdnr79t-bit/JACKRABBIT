-- Wastely CRM — tighten access.
-- Signed-out visitors (the anon key) can't call any of the CRM's functions,
-- every function runs with a fixed search_path, and any table created in
-- public from now on gets row level security switched on automatically.

alter function agreements_rules()             set search_path = public;
alter function documents_delete_drafts_only() set search_path = public;
alter function invoices_rules()               set search_path = public;
alter function invoices_sync_billing()        set search_path = public;
alter function jobs_add_costs()               set search_path = public;
alter function jobs_rules()                   set search_path = public;
alter function random_token()                 set search_path = public;

do $$
declare f text;
begin
  foreach f in array array[
    'is_member()', 'my_role()', 'is_leadership()', 'random_token()',
    'sync_job_billing(uuid)', 'ensure_services(text[])',
    'create_deal(text, text, text, bigint, uuid, boolean, text[], text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- Safety net: switch on row level security for any new table in public.
create or replace function rls_auto_enable() returns event_trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
           where object_type = 'table' and schema_name = 'public' loop
    execute format('alter table %s enable row level security', r.object_identity);
  end loop;
end;
$$;
revoke execute on function rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists rls_auto_enable;
create event trigger rls_auto_enable on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function rls_auto_enable();
