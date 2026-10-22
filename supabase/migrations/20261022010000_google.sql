-- Wastely CRM — Google (Gmail now, Calendar later).
-- One Google connection per profile. The refresh token lives encrypted in
-- Supabase Vault; only the app server (service role) can store or read it.
-- Team members can see who is connected and with which address.

create table google_accounts (
  profile_id      uuid primary key references profiles (id) on delete cascade,
  email           citext not null,
  scopes          text not null default '',
  token_secret_id uuid,            -- vault.secrets row holding the refresh token
  connected_at    timestamptz not null default now()
);

alter table google_accounts enable row level security;
create policy "google_accounts: members read" on google_accounts for select to authenticated using (is_member());
revoke insert, update, delete on google_accounts from anon, authenticated;

create function google_token_save(p_profile uuid, p_email text, p_scopes text, p_refresh text) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from google_accounts where profile_id = p_profile;
  if v_secret is null then
    v_secret := vault.create_secret(p_refresh, 'google_refresh_' || p_profile::text || '_' || extract(epoch from now())::bigint, 'Wastely CRM Google refresh token');
  else
    perform vault.update_secret(v_secret, p_refresh);
  end if;
  insert into google_accounts (profile_id, email, scopes, token_secret_id, connected_at)
  values (p_profile, p_email, p_scopes, v_secret, now())
  on conflict (profile_id) do update
    set email = excluded.email, scopes = excluded.scopes, token_secret_id = excluded.token_secret_id, connected_at = now();
  update profiles set mail_provider = 'google' where id = p_profile;
end;
$$;

create function google_token_get(p_profile uuid) returns text
language sql stable security definer set search_path = public, vault as $$
  select ds.decrypted_secret
    from google_accounts g join vault.decrypted_secrets ds on ds.id = g.token_secret_id
   where g.profile_id = p_profile;
$$;

create function google_disconnect(p_profile uuid) returns void
language plpgsql security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from google_accounts where profile_id = p_profile;
  delete from google_accounts where profile_id = p_profile;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
  update profiles set mail_provider = null where id = p_profile;
end;
$$;

revoke execute on function google_token_save(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function google_token_get(uuid) from public, anon, authenticated;
revoke execute on function google_disconnect(uuid) from public, anon, authenticated;
grant execute on function google_token_save(uuid, text, text, text) to service_role;
grant execute on function google_token_get(uuid) to service_role;
grant execute on function google_disconnect(uuid) to service_role;

alter publication supabase_realtime add table google_accounts;
