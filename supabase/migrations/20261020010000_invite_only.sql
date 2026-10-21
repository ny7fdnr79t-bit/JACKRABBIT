-- Wastely CRM — access by invitation only.
-- Public sign-ups are switched off in Supabase Auth, and Leadership adds
-- people from Team (the app's server creates the account). No email domain
-- activates an account on its own any more.
delete from allowed_domains;
