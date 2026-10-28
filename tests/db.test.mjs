// Database tests: runs every migration in supabase/migrations against an
// in-memory Postgres (PGlite) with small stand-ins for Supabase's auth schema,
// roles and realtime publication, then checks business rules and row level
// security. Run with `npm run test:db`. Exits non-zero if anything fails.
//
// When you add a migration, add checks for it at the end of this file.

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
const db = new PGlite({ extensions: { citext } });

// Stand-ins for what Supabase provides.
await db.exec(`
  create role authenticated; create role anon; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create publication supabase_realtime;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  grant usage on schema public to authenticated, service_role;
  alter default privileges in schema public grant all on tables to authenticated, service_role;
  alter default privileges in schema public grant all on sequences to authenticated, service_role;
  alter default privileges in schema public grant execute on functions to authenticated, service_role;
`);
for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join(dir, f), 'utf8'));

const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec('reset role;'); } };
const asService = async fn => { await db.exec('set role service_role;'); try { return await fn(); } finally { await db.exec('reset role;'); } };
let failures = 0;
const ok = (label, cond, extra = '') => { if (!cond) failures++; console.log(cond ? 'ok  ' : 'FAIL', label, extra); };
const rejects = async (label, fn) => { try { await fn(); failures++; console.log('FAIL (no error):', label); } catch (e) { console.log('ok  ', label, '→', e.message.slice(0, 80)); } };

// ── Core: profiles, access, deals ──────────────────────────────────────
console.log('\n# core');
const [boss] = await q(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('boss@gmail.com', '{"full_name":"Pat Boss"}', '{"provider":"google"}') returning id`);
const [am] = await q(`insert into auth.users (email, raw_app_meta_data) values ('sam@wastely.ca', '{"provider":"azure"}') returning id`);
const [out] = await q(`insert into auth.users (email) values ('rando@gmail.com') returning id`);
const profs = await q('select email, role, active, mail_provider from profiles order by created_at');
ok('first user becomes active Leadership', profs[0].role === 'Leadership' && profs[0].active);
ok('@wastely.ca user is activated automatically', profs[1].active && profs[1].mail_provider === 'microsoft');
ok('other domains wait for approval', !profs[2].active);
ok('14 standard services seeded', (await q('select count(*)::int n from services'))[0].n === 14);
ok('pending user sees no jobs', (await as(out.id, () => q('select * from jobs'))).length === 0);
ok('pending user sees only their own profile', (await as(out.id, () => q('select * from profiles'))).length === 1);
await rejects('pending user cannot create a deal', () => as(out.id, () => q(`select create_deal('X','Commercial','t',600000,null,false,array['Mould Removal'])`)));
await rejects('deal below the minimum is blocked', () => as(am.id, () => q(`select create_deal('Acme','Commercial','Small',400000,$1,false,array['Mould Removal'])`, [am.id])));
await rejects('deal without services is blocked', () => as(am.id, () => q(`select create_deal('Acme','Commercial','None',600000,$1,false,array[]::text[])`, [am.id])));
const [{ create_deal: job }] = await as(am.id, () => q(`select create_deal('Acme Developments','Developer','Warehouse strip',800000,$1,true,array['Interior Strip-Out','Hoarding cleanup'])`, [am.id]));
const [{ create_deal: job2 }] = await as(am.id, () => q(`select create_deal('ACME developments','Developer','Second job',600000,$1,false,array['mould removal'])`, [am.id]));
ok('clients are matched case-insensitively', (await q('select count(*)::int n from clients'))[0].n === 1);
ok('unknown service becomes a custom service', (await q(`select is_custom from services where name='Hoarding cleanup'`))[0]?.is_custom === true);
ok('job_costs row created with the job', (await q('select count(*)::int n from job_costs where job_id=$1', [job]))[0].n === 1);
await as(am.id, () => q(`update jobs set stage='Won' where id=$1`, [job]));
ok('moving to Won schedules the job', (await q('select status from jobs where id=$1', [job]))[0].status === 'Scheduled');
await as(am.id, () => q(`update jobs set status='On site' where id=$1`, [job]));
await as(am.id, () => q(`update jobs set title='Renamed' where id=$1`, [job]));
ok('status kept on later edits', (await q('select status from jobs where id=$1', [job]))[0].status === 'On site');
await as(am.id, () => q(`update jobs set value_cents=100 where id=$1`, [job2]));
ok('an existing job may drop below the minimum', Number((await q('select value_cents from jobs where id=$1', [job2]))[0].value_cents) === 100);
await as(am.id, () => q(`update profiles set role='Leadership' where id=$1`, [am.id])).catch(() => {});
ok('members cannot promote themselves', (await q('select role from profiles where id=$1', [am.id]))[0].role === 'Account manager');
await as(am.id, () => q(`update profiles set active=true where id=$1`, [out.id]));
ok('members cannot activate others', !(await q('select active from profiles where id=$1', [out.id]))[0].active);
await as(boss.id, () => q(`update profiles set active=true where id=$1`, [out.id]));
ok('Leadership activates people', (await q('select active from profiles where id=$1', [out.id]))[0].active);
await as(am.id, () => q(`insert into tasks (title, job_id, assignee_id, type) values ('Call back', $1, $2, 'Call')`, [job2, am.id]));
await as(am.id, () => q(`delete from jobs where id=$1`, [job2]));
ok('deleting a job deletes its tasks', (await q('select count(*)::int n from tasks'))[0].n === 0);

// ── Documents: invoices, billing sync, agreements ───────────────────────
console.log('\n# documents');
ok('agreement template seeded', (await as(am.id, () => q('select count(*)::int n from agreement_templates where is_default')))[0].n === 1);
const [inv] = await as(am.id, () => q(`insert into invoices (job_id, kind, lines, tax_rate) values ($1,'Deposit','[{"description":"Deposit","qty":1,"unit_cents":300000},{"description":"Bins","qty":2.5,"unit_cents":10001}]',13) returning *`, [job]));
ok('invoice numbered', inv.number === 'INV-1001', inv.number);
ok('totals and HST computed in Postgres', Number(inv.subtotal_cents) === 325003 && Number(inv.tax_cents) === 42250 && Number(inv.total_cents) === 367253);
await as(am.id, () => q(`update invoices set status='Sent' where id=$1`, [inv.id]));
ok('sent deposit → Deposit invoiced', (await q('select billing from jobs where id=$1', [job]))[0].billing === 'Deposit invoiced');
await rejects('sent invoice lines are locked', () => as(am.id, () => q(`update invoices set lines='[]' where id=$1`, [inv.id])));
await rejects('sent invoice cannot be deleted', () => as(am.id, () => q(`delete from invoices where id=$1`, [inv.id])));
const [fin] = await as(am.id, () => q(`insert into invoices (job_id, kind, lines) values ($1,'Final','[{"description":"Balance","qty":1,"unit_cents":700000}]') returning id`, [job]));
await as(am.id, () => q(`update invoices set status='Sent' where id=$1`, [fin.id]));
ok('final sent → Invoiced in full', (await q('select billing from jobs where id=$1', [job]))[0].billing === 'Invoiced in full');
await as(am.id, () => q(`update invoices set status='Paid', paid_via='E-transfer' where id=$1`, [inv.id]));
await asService(() => q(`update invoices set status='Paid', paid_via='Stripe' where id=$1`, [fin.id]));
ok('all paid → Paid', (await q('select billing from jobs where id=$1', [job]))[0].billing === 'Paid');
await rejects('a paid invoice cannot be reopened', () => as(am.id, () => q(`update invoices set status='Sent' where id=$1`, [fin.id])));
await rejects('a job with invoices cannot be deleted', () => as(am.id, () => q(`delete from jobs where id=$1`, [job])));
const [ag] = await as(am.id, () => q(`insert into agreements (job_id, body, price_cents) values ($1,'Body v1',1000000) returning id, number, status`, [job]));
ok('agreement starts as a numbered draft', ag.number === 'AGR-1001' && ag.status === 'Draft');
await rejects('members cannot write signature fields', () => as(am.id, () => q(`update agreements set signature='data:x' where id=$1`, [ag.id])));
await rejects('members cannot mark an agreement signed', () => as(am.id, () => q(`update agreements set status='Signed' where id=$1`, [ag.id])));
await as(am.id, () => q(`update agreements set status='Sent' where id=$1`, [ag.id]));
await rejects('sent agreement wording is locked', () => as(am.id, () => q(`update agreements set body='v2' where id=$1`, [ag.id])));
await asService(() => q(`update agreements set status='Signed', signer_name='Jo', signature='data:image/png;base64,AA', body_sha256='abc', signed_at=now() where id=$1`, [ag.id]));
ok('the server signs on the client’s behalf', (await q('select status from agreements where id=$1', [ag.id]))[0].status === 'Signed');
await rejects('a signed agreement cannot be voided', () => as(am.id, () => q(`update agreements set status='Void' where id=$1`, [ag.id])));

// ── Assistant: custom fields, change log ────────────────────────────────
console.log('\n# assistant');
const turn = '11111111-1111-1111-1111-111111111111';
await as(am.id, () => q(`update jobs set extra = '{"f_bin":"20 yd"}' where id=$1`, [job]));
ok('members can set custom field values', (await q(`select extra->>'f_bin' v from jobs where id=$1`, [job]))[0].v === '20 yd');
await as(am.id, () => q(`insert into ai_actions (turn_id, user_id, tool, summary, undo) values ($1,$2,'add_task','x','[]')`, [turn, am.id]));
await rejects('cannot log an action as someone else', () => as(am.id, () => q(`insert into ai_actions (turn_id, user_id, tool, summary) values ($1,$2,'t','x')`, [turn, boss.id])));
await rejects('cannot rewrite undo steps', () => as(am.id, () => q(`update ai_actions set undo='[]' where turn_id=$1`, [turn])));
await as(am.id, () => q(`update app_settings set job_fields='[{"id":"f","label":"x","type":"text"}]'`));
ok('members cannot change settings', JSON.stringify((await q('select job_fields from app_settings'))[0].job_fields) === '[]');

// ── Builds and self-review ──────────────────────────────────────────────
console.log('\n# builds and self-review');
await rejects('members cannot request app changes', () => as(am.id, () => q(`insert into feature_requests (user_id, title, description) values ($1,'t','d')`, [am.id])));
await as(boss.id, () => q(`insert into feature_requests (user_id, title, description) values ($1,'t','d')`, [boss.id]));
const [fr] = await q('select id, status, kind from feature_requests');
ok('a request starts as a building feature', fr.status === 'building' && fr.kind === 'feature');
await as(am.id, () => q(`update feature_requests set status='published' where id=$1`, [fr.id]));
ok('members cannot mark a build published', (await q('select status from feature_requests where id=$1', [fr.id]))[0].status === 'building');
await rejects('unknown build status rejected', () => as(boss.id, () => q(`update feature_requests set status='live' where id=$1`, [fr.id])));
await q(`insert into feature_requests (user_id, kind, status, title, description, reason, impact, effort) values (null,'suggestion','suggested','From the review','d','asked 6x','high','small')`);
ok('the scheduled review can store suggestions', (await q(`select count(*)::int n from feature_requests where status='suggested'`))[0].n === 1);
await as(am.id, () => q(`insert into assistant_log (prompt, outcome) values ('export contracts','ok')`));
await as(am.id, () => q(`insert into app_events (kind, screen) values ('view','pipeline')`));
ok('members cannot read usage logs', (await as(am.id, () => q('select count(*)::int n from assistant_log')))[0].n === 0);
ok('Leadership reads usage logs', (await as(boss.id, () => q('select count(*)::int n from assistant_log')))[0].n === 1);
await q(`insert into app_events (user_id, kind, at) values ($1,'view', now() - interval '100 days')`, [am.id]);
await q('select prune_signals()');
ok('signals older than 90 days are pruned', (await q('select count(*)::int n from app_events'))[0].n === 1);

// ── Leads ─────────────────────────────────────────────────────────────
console.log('\n# leads');
await asService(() => q(`insert into web_submissions (form, page, fields, created_by) values ('Quote request','https://wastely.ca','{"name":"Jordan"}', null)`));
ok('the website endpoint can store a lead', (await q(`select count(*)::int n from web_submissions where form='Quote request'`))[0].n === 1);
await as(am.id, () => q(`insert into web_submissions (form, fields) values ('Phone call','{"Name":"Pat"}')`));
ok('a member logs a call, recorded as theirs', (await q(`select created_by from web_submissions where form='Phone call'`))[0].created_by === am.id);
ok('members see leads', (await as(am.id, () => q('select count(*)::int n from web_submissions')))[0].n === 2);
ok('pending people see no leads', (await as('00000000-0000-0000-0000-000000000000', () => q('select count(*)::int n from web_submissions')))[0].n === 0);
await rejects('a converted lead must point at a deal', () => as(am.id, () => q(`update web_submissions set status='converted' where form='Phone call'`)));
await as(am.id, () => q(`update web_submissions set status='converted', job_id=$1 where form='Phone call'`, [job]));
ok('a lead converts with its deal', (await q(`select status from web_submissions where form='Phone call'`))[0].status === 'converted');
await rejects('fields must be an object', () => as(am.id, () => q(`insert into web_submissions (form, fields) values ('Other','[]')`)));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll database checks passed.');
process.exit(failures ? 1 : 0);
