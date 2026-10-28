import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CLIENT_TYPES, BILLING, STATUS, TASK_TYPES, PROTECTED_STAGES, COSTS } from '@/lib/crm';
import { draftInvoiceLines, fillTemplate, templateVars, toCompany, type InvoiceKind } from '@/lib/docs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ── Undo ────────────────────────────────────────────────────────────────

// Tables the assistant may change, and therefore the only ones an undo may touch.
export const UNDO_TABLES = ['jobs', 'job_costs', 'job_services', 'job_crew', 'contacts', 'tasks', 'invoices', 'agreements', 'services', 'app_settings'] as const;
export type UndoOp = {
  table: (typeof UNDO_TABLES)[number];
  op: 'update' | 'delete' | 'insert';
  match?: Row;            // column = value
  matchIn?: [string, unknown[]]; // column in (...)
  values?: Row | Row[];
};

export async function applyUndo(sb: SupabaseClient, ops: UndoOp[]) {
  for (const o of ops) {
    if (!UNDO_TABLES.includes(o.table)) throw new Error('Undo can’t change ' + o.table + '.');
    let q: any;
    if (o.op === 'insert') q = sb.from(o.table).insert(o.values as Row | Row[]);
    else {
      q = o.op === 'update' ? sb.from(o.table).update(o.values as Row) : sb.from(o.table).delete();
      if (o.match) q = q.match(o.match);
      if (o.matchIn) q = q.in(o.matchIn[0], o.matchIn[1]);
      if (!o.match && !o.matchIn) throw new Error('Undo step without a filter.');
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
}

// ── Context passed to every tool ────────────────────────────────────────

export type Me = { id: string; name: string; role: string };
export type ToolCtx = {
  sb: SupabaseClient;
  me: Me;
  turnId: string;
  prompt: string;
  changes: string[];          // human-readable list shown under the reply
  nav: { screen?: string; jobId?: string } | null;
};

class ToolError extends Error {}
const fail = (msg: string): never => { throw new ToolError(msg); };
const eq = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const cents = (dollars: unknown) => Math.round((Number(dollars) || 0) * 100);
const dollars = (c: unknown) => Math.round(Number(c) || 0) / 100;
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);
const clean = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) fail(error.message);
  return data;
}

const leadershipOnly = (ctx: ToolCtx, what: string) => {
  if (ctx.me.role !== 'Leadership') fail(`Only Leadership can ${what}. ${ctx.me.name} is ${ctx.me.role}.`);
};

async function record(ctx: ToolCtx, tool: string, summary: string, input: unknown, undo: UndoOp[]) {
  ctx.changes.push(summary);
  await must(ctx.sb.from('ai_actions').insert({ turn_id: ctx.turnId, user_id: ctx.me.id, prompt: ctx.prompt.slice(0, 2000), tool, summary, input, undo }));
}

// ── Lookups ─────────────────────────────────────────────────────────────

const settings = async (sb: SupabaseClient) => must(sb.from('app_settings').select('*').eq('id', 1).single()) as Promise<Row>;

async function people(sb: SupabaseClient) {
  return (await must(sb.from('profiles').select('id,name,email,role').eq('active', true))) as Row[];
}

async function personId(sb: SupabaseClient, who: unknown) {
  if (!who) return null;
  const ps = await people(sb);
  const p = ps.find(x => eq(x.name, who) || eq(x.email, who)) || ps.filter(x => eq(String(x.name).split(' ')[0], who))[0];
  if (!p) fail(`No team member called “${who}”. Team: ${ps.map(x => x.name).join(', ')}.`);
  return p!.id as string;
}

const JOB_SELECT = '*, client:clients(id,name,type), contact:contacts(id,name,email,phone), costs:job_costs(*), job_services(service:services(id,name)), job_crew(crew:crew_members(id,name,role))';
const one = (x: any) => (Array.isArray(x) ? x[0] : x) ?? null;

async function loadJob(sb: SupabaseClient, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail('Use a job_id from search_jobs.');
  const j = await must(sb.from('jobs').select(JOB_SELECT).eq('id', id).maybeSingle());
  if (!j) fail('No deal with that id. Search again.');
  return j as Row;
}

function jobView(j: Row, owners: Map<string, string>, target: number, fieldsDef: Row[]) {
  const c = one(j.costs) || {};
  const cost = COSTS.reduce((a, [k]) => a + Number(c[k + '_cents'] || 0), 0);
  const value = Number(j.value_cents);
  const extra = j.extra || {};
  return {
    id: j.id, client: one(j.client)?.name, client_type: one(j.client)?.type, title: j.title, stage: j.stage, status: j.status,
    billing: j.billing, value: dollars(value), emergency: j.emergency, site: j.site, start: j.start_date, end: j.end_date,
    owner: owners.get(j.owner_id) || null, source: j.source || undefined,
    services: (j.job_services || []).map((s: Row) => one(s.service)?.name).filter(Boolean),
    crew: (j.job_crew || []).map((x: Row) => one(x.crew)?.name).filter(Boolean),
    contact: one(j.contact) ? { name: one(j.contact).name, email: one(j.contact).email, phone: one(j.contact).phone } : null,
    costs: Object.fromEntries(COSTS.map(([k]) => [k, dollars(c[k + '_cents'])])),
    operating_cost: dollars(cost),
    margin_pct: cost && value ? Math.round(((value - cost) / value) * 100) : null,
    below_margin_target: cost && value ? ((value - cost) / value) * 100 < target : null,
    fields: Object.fromEntries(fieldsDef.filter(f => extra[f.id] !== undefined && extra[f.id] !== '').map(f => [f.label, extra[f.id]]))
  };
}

// ── Tool definitions ────────────────────────────────────────────────────

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const obj = (properties: Row, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false });

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_jobs',
    description: 'Find deals and contracts (jobs). Returns compact rows with ids, stage, status, value, margin and owner. Call this before acting on a job to get its id. Leave filters empty to list everything.',
    input_schema: obj({
      query: str('Text to match against client, job title or site'),
      stage: str('Exact stage name, e.g. "Quoted" or "Won"'),
      status: { type: 'string', enum: [...STATUS], description: 'Won jobs only' },
      owner: str('Account manager name'),
      below_margin_target: { type: 'boolean', description: 'Only costed jobs under the margin target' }
    })
  },
  { name: 'get_job', description: 'Everything about one job: details, costs, services, crew, contact, custom fields, tasks, invoices and agreements.', input_schema: obj({ job_id: str('Job id') }, ['job_id']) },
  {
    name: 'list_tasks',
    description: 'List tasks, soonest first.',
    input_schema: obj({ assignee: str('Team member name'), due_by: str('YYYY-MM-DD; tasks due on or before'), include_done: { type: 'boolean' }, job_id: str('Only this job') })
  },
  { name: 'list_invoices', description: 'List invoices with number, job, kind, status, due date and total.', input_schema: obj({ status: { type: 'string', enum: ['Draft', 'Sent', 'Paid', 'Void'] }, job_id: str('Only this job') }) },
  { name: 'get_settings', description: 'Pipeline stages, margin target, minimum job value, services, custom job fields, team members, field crew and company details.', input_schema: obj({}) },
  {
    name: 'create_deal',
    description: 'Create a new deal in the first pipeline stage. Needs at least one service and a value of at least the minimum job value.',
    input_schema: obj({
      client: str('Client company or person'), client_type: { type: 'string', enum: [...CLIENT_TYPES] }, title: str('Short job description'),
      value: num('Estimated value in dollars'), owner: str('Account manager name; defaults to the person asking'),
      services: { type: 'array', items: { type: 'string' }, description: 'Service names; unknown names become custom services' },
      emergency: { type: 'boolean', description: 'Emergency 24/7 response' }
    }, ['client', 'client_type', 'title', 'value', 'services'])
  },
  {
    name: 'update_job',
    description: 'Change one job. Include only what changes. Money is in dollars. services and crew replace the whole list. fields sets custom job fields by label.',
    input_schema: obj({
      job_id: str('Job id'),
      changes: obj({
        title: { type: 'string' }, site: { type: 'string' }, stage: { type: 'string' }, status: { type: 'string', enum: [...STATUS] },
        billing: { type: 'string', enum: [...BILLING] }, value: { type: 'number' }, emergency: { type: 'boolean' },
        start: str('YYYY-MM-DD, or empty to clear'), end: str('YYYY-MM-DD, or empty to clear'), owner: str('Account manager name'),
        costs: obj(Object.fromEntries(COSTS.map(([k]) => [k, { type: 'number' }]))),
        services: { type: 'array', items: { type: 'string' } }, crew: { type: 'array', items: { type: 'string' }, description: 'Crew member names' },
        contact: obj({ name: { type: 'string' }, email: { type: 'string' }, phone: str('E.164, e.g. +14165550100') }),
        fields: { type: 'object', description: 'Custom field label → value', additionalProperties: { type: 'string' } }
      })
    }, ['job_id', 'changes'])
  },
  {
    name: 'add_task',
    description: 'Add a task.',
    input_schema: obj({ title: { type: 'string' }, job_id: str('Optional job id'), assignee: str('Team member; defaults to the job owner or the person asking'), due: str('YYYY-MM-DD; defaults to today'), type: { type: 'string', enum: [...TASK_TYPES] } }, ['title'])
  },
  {
    name: 'update_task',
    description: 'Complete, reopen, reschedule, reassign or rename a task.',
    input_schema: obj({ task_id: { type: 'string' }, done: { type: 'boolean' }, due: str('YYYY-MM-DD'), assignee: { type: 'string' }, title: { type: 'string' } }, ['task_id'])
  },
  {
    name: 'create_invoice',
    description: 'Create a DRAFT invoice for a job, pre-filled with standard lines. A person reviews and sends it from the invoice screen; you cannot send invoices.',
    input_schema: obj({ job_id: { type: 'string' }, kind: { type: 'string', enum: ['Deposit', 'Progress', 'Final'] } }, ['job_id', 'kind'])
  },
  {
    name: 'create_agreement',
    description: 'Create a DRAFT service agreement for a job from the template. A person reviews and sends it; you cannot send agreements.',
    input_schema: obj({ job_id: { type: 'string' } }, ['job_id'])
  },
  {
    name: 'edit_pipeline_stages',
    description: 'Add, rename or remove a pipeline stage (Leadership only). Won and Lost can’t be renamed or removed. Removing a stage moves its deals to move_to.',
    input_schema: obj({ action: { type: 'string', enum: ['add', 'rename', 'remove'] }, name: str('Stage to add, rename or remove'), new_name: str('For rename'), before: str('For add: insert before this stage (default: before Won)'), move_to: str('For remove: stage that receives its deals') }, ['action', 'name'])
  },
  {
    name: 'edit_job_fields',
    description: 'Add or remove a custom field shown on every job (Leadership only). Removing hides the field but keeps its values, so it can be re-added.',
    input_schema: obj({ action: { type: 'string', enum: ['add', 'remove'] }, label: { type: 'string' }, type: { type: 'string', enum: ['text', 'number', 'date'] } }, ['action', 'label'])
  },
  { name: 'add_service', description: 'Add a custom service to the service list.', input_schema: obj({ name: { type: 'string' } }, ['name']) },
  { name: 'set_margin_target', description: 'Set the margin target percentage (Leadership only).', input_schema: obj({ percent: { type: 'number' } }, ['percent']) },
  {
    name: 'request_feature',
    description: 'File a request to change the CRM app itself (new screens, buttons, layouts, reports, integrations) as a GitHub issue that Claude Code builds on a branch for review. Leadership only. Confirm the title and description with the person before calling.',
    input_schema: obj({ title: str('Short title'), description: str('What to build and why, written so a developer can build it without asking questions: who uses it, where it appears, what it does, and what done looks like') }, ['title', 'description'])
  },
  {
    name: 'open_in_crm',
    description: 'Show something in the CRM: switch screen and/or open a job panel.',
    input_schema: obj({ screen: { type: 'string', enum: ['overview', 'pipeline', 'contracts', 'tasks', 'agreements', 'invoices', 'team'] }, job_id: { type: 'string' } })
  }
];

// ── Tool implementations ────────────────────────────────────────────────

type Handler = (ctx: ToolCtx, input: Row) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async search_jobs({ sb }, i) {
    const [jobs, st, ps] = await Promise.all([must(sb.from('jobs').select(JOB_SELECT).order('created_at')), settings(sb), people(sb)]);
    const owners = new Map(ps.map(p => [p.id, p.name]));
    let rows = (jobs as Row[]).map(j => jobView(j, owners, st.margin_target, st.job_fields || []));
    const q = clean(i.query).toLowerCase();
    if (q) rows = rows.filter(r => [r.client, r.title, r.site].some(x => String(x || '').toLowerCase().includes(q)));
    if (i.stage) rows = rows.filter(r => eq(r.stage, i.stage));
    if (i.status) rows = rows.filter(r => r.status === i.status);
    if (i.owner) rows = rows.filter(r => eq(r.owner, i.owner) || eq(String(r.owner || '').split(' ')[0], i.owner));
    if (i.below_margin_target) rows = rows.filter(r => r.below_margin_target);
    return {
      count: rows.length,
      jobs: rows.slice(0, 60).map(r => ({ id: r.id, client: r.client, title: r.title, stage: r.stage, status: r.status, billing: r.billing, value: r.value, margin_pct: r.margin_pct, owner: r.owner, emergency: r.emergency, start: r.start, end: r.end, services: r.services })),
      note: rows.length > 60 ? 'Showing the first 60; narrow the search.' : undefined
    };
  },

  async get_job({ sb }, i) {
    const [j, st, ps] = await Promise.all([loadJob(sb, i.job_id), settings(sb), people(sb)]);
    const owners = new Map(ps.map(p => [p.id, p.name]));
    const [tasks, invoices, agreements] = await Promise.all([
      must(sb.from('tasks').select('id,title,type,due,done,assignee_id').eq('job_id', j.id).order('due')),
      must(sb.from('invoices').select('number,kind,status,total_cents,due_date').eq('job_id', j.id)),
      must(sb.from('agreements').select('number,status,signed_at,signer_name').eq('job_id', j.id))
    ]);
    return {
      ...jobView(j, owners, st.margin_target, st.job_fields || []),
      tasks: (tasks as Row[]).map(t => ({ id: t.id, title: t.title, type: t.type, due: t.due, done: t.done, assignee: owners.get(t.assignee_id) || null })),
      invoices: (invoices as Row[]).map(x => ({ number: x.number, kind: x.kind, status: x.status, total: dollars(x.total_cents), due: x.due_date })),
      agreements: (agreements as Row[]).map(x => ({ number: x.number, status: x.status, signed_at: x.signed_at, signer: x.signer_name }))
    };
  },

  async list_tasks({ sb }, i) {
    let q = sb.from('tasks').select('id,title,type,due,done,job_id,assignee_id').order('due').limit(200);
    if (!i.include_done) q = q.eq('done', false);
    if (isDate(i.due_by)) q = q.lte('due', i.due_by);
    if (i.job_id) q = q.eq('job_id', i.job_id);
    if (i.assignee) q = q.eq('assignee_id', await personId(sb, i.assignee));
    const [tasks, ps, jobs] = await Promise.all([must(q), people(sb), must(sb.from('jobs').select('id,title,client:clients(name)'))]);
    const owners = new Map(ps.map(p => [p.id, p.name]));
    const jobName = new Map((jobs as Row[]).map(j => [j.id, one(j.client)?.name + ' — ' + j.title]));
    return { today: today(), tasks: (tasks as Row[]).map(t => ({ id: t.id, title: t.title, type: t.type, due: t.due, done: t.done, overdue: !t.done && t.due < today(), job: jobName.get(t.job_id) || null, job_id: t.job_id, assignee: owners.get(t.assignee_id) || null })) };
  },

  async list_invoices({ sb }, i) {
    let q = sb.from('invoices').select('id,number,job_id,kind,status,issue_date,due_date,total_cents').order('created_at', { ascending: false }).limit(200);
    if (i.status) q = q.eq('status', i.status);
    if (i.job_id) q = q.eq('job_id', i.job_id);
    const rows = (await must(q)) as Row[];
    return { invoices: rows.map(x => ({ number: x.number, job_id: x.job_id, kind: x.kind, status: x.status, issued: x.issue_date, due: x.due_date, overdue: x.status === 'Sent' && x.due_date < today(), total_incl_tax: dollars(x.total_cents) })) };
  },

  async get_settings({ sb }) {
    const [st, svc, ps, crew] = await Promise.all([
      settings(sb), must(sb.from('services').select('name,grp,is_custom').order('sort')), people(sb), must(sb.from('crew_members').select('name,role').eq('active', true))
    ]);
    return {
      stages: st.stages, margin_target_pct: st.margin_target, min_job_value: dollars(st.min_job_cents), custom_job_fields: (st.job_fields || []).map((f: Row) => ({ label: f.label, type: f.type })),
      services: svc, team: ps.map(p => ({ name: p.name, role: p.role })), crew, company: toCompany(st), client_types: CLIENT_TYPES, statuses: STATUS, billing_states: BILLING
    };
  },

  async create_deal(ctx, i) {
    const { sb, me } = ctx;
    const services = (Array.isArray(i.services) ? i.services : []).map((s: unknown) => clean(s, 80)).filter(Boolean);
    const owner = i.owner ? await personId(sb, i.owner) : me.id;
    const { data, error } = await sb.rpc('create_deal', {
      p_client: clean(i.client, 120), p_client_type: CLIENT_TYPES.find(t => eq(t, i.client_type)) || 'Commercial', p_title: clean(i.title, 200),
      p_value_cents: cents(i.value), p_owner_id: owner, p_emergency: !!i.emergency, p_services: services, p_source: 'Assistant'
    });
    if (error) fail(error.message);
    await record(ctx, 'create_deal', `Created deal: ${clean(i.client)} — ${clean(i.title)} (${'$' + Number(i.value).toLocaleString('en-CA')})`, i,
      [{ table: 'jobs', op: 'delete', match: { id: data } }]);
    ctx.nav = { screen: 'pipeline', jobId: data as string };
    return { job_id: data };
  },

  async update_job(ctx, i) {
    const { sb } = ctx;
    const j = await loadJob(sb, i.job_id);
    const ch: Row = i.changes || {};
    const st = await settings(sb);
    const undo: UndoOp[] = [];
    const done: string[] = [];

    // Plain columns on jobs
    const patch: Row = {};
    const old: Row = {};
    const set = (col: string, v: unknown, label: string) => { patch[col] = v; old[col] = j[col]; done.push(label); };
    if ('title' in ch) set('title', clean(ch.title) || fail('Title can’t be empty.'), 'title');
    if ('site' in ch) set('site', clean(ch.site, 300), 'site');
    if ('stage' in ch) {
      const s = (st.stages as string[]).find(x => eq(x, ch.stage)) || fail(`No stage “${ch.stage}”. Stages: ${st.stages.join(', ')}.`);
      set('stage', s, 'stage → ' + s);
      if (s === 'Won' && j.stage !== 'Won') old.status = j.status; // the database schedules it
    }
    if ('status' in ch) {
      if ((patch.stage || j.stage) !== 'Won') fail('Status only applies to Won jobs.');
      set('status', STATUS.find(x => eq(x, ch.status)) || fail('Unknown status.'), 'status → ' + ch.status);
    }
    if ('billing' in ch) set('billing', BILLING.find(x => eq(x, ch.billing)) || fail('Unknown billing state.'), 'billing → ' + ch.billing);
    if ('value' in ch) { if (!(Number(ch.value) >= 0)) fail('Value must be a positive number.'); set('value_cents', cents(ch.value), 'value → $' + Number(ch.value).toLocaleString('en-CA')); }
    if ('emergency' in ch) set('emergency', !!ch.emergency, ch.emergency ? 'emergency 24/7 on' : 'emergency 24/7 off');
    for (const [k, col] of [['start', 'start_date'], ['end', 'end_date']] as const) {
      if (k in ch) { if (ch[k] && !isDate(ch[k])) fail(k + ' must be YYYY-MM-DD.'); set(col, ch[k] || null, k + ' date'); }
    }
    if ('owner' in ch) set('owner_id', await personId(sb, ch.owner), 'owner → ' + ch.owner);
    if (ch.fields && typeof ch.fields === 'object') {
      const defs = (st.job_fields || []) as Row[];
      const extra = { ...(j.extra || {}) };
      for (const [label, v] of Object.entries(ch.fields)) {
        const f = defs.find(d => eq(d.label, label)) || fail(`No custom field “${label}”. Add it first with edit_job_fields.`);
        extra[f!.id] = clean(v, 500);
      }
      set('extra', extra, 'custom fields');
    }

    // Costs
    if (ch.costs && typeof ch.costs === 'object') {
      const c = one(j.costs) || {};
      const cp: Row = {}, co: Row = {};
      for (const [k] of COSTS) if (k in ch.costs) { cp[k + '_cents'] = cents(ch.costs[k]); co[k + '_cents'] = c[k + '_cents'] ?? 0; }
      if (Object.keys(cp).length) {
        await must(sb.from('job_costs').update(cp).eq('job_id', j.id));
        undo.push({ table: 'job_costs', op: 'update', match: { job_id: j.id }, values: co });
        done.push('costs');
      }
    }

    // Services (replace the list)
    if (Array.isArray(ch.services)) {
      const names = ch.services.map((s: unknown) => clean(s, 80)).filter(Boolean);
      if (!names.length) fail('A job needs at least one service.');
      const svc = (await must(sb.rpc('ensure_services', { p_names: names }))) as Row[];
      const before = (j.job_services || []).map((s: Row) => one(s.service)?.id).filter(Boolean);
      await must(sb.from('job_services').delete().eq('job_id', j.id));
      await must(sb.from('job_services').insert(svc.map(s => ({ job_id: j.id, service_id: s.id }))));
      undo.push({ table: 'job_services', op: 'delete', match: { job_id: j.id } });
      if (before.length) undo.push({ table: 'job_services', op: 'insert', values: before.map((id: string) => ({ job_id: j.id, service_id: id })) });
      done.push('services');
    }

    // Crew (replace the list)
    if (Array.isArray(ch.crew)) {
      const all = (await must(sb.from('crew_members').select('id,name').eq('active', true))) as Row[];
      const ids = ch.crew.map((n: unknown) => (all.find(c => eq(c.name, n)) || fail(`No crew member “${n}”. Crew: ${all.map(c => c.name).join(', ') || 'none yet'}.`))!.id);
      const before = (j.job_crew || []).map((x: Row) => one(x.crew)?.id).filter(Boolean);
      await must(sb.from('job_crew').delete().eq('job_id', j.id));
      if (ids.length) await must(sb.from('job_crew').insert(ids.map((id: string) => ({ job_id: j.id, crew_member_id: id }))));
      undo.push({ table: 'job_crew', op: 'delete', match: { job_id: j.id } });
      if (before.length) undo.push({ table: 'job_crew', op: 'insert', values: before.map((id: string) => ({ job_id: j.id, crew_member_id: id })) });
      done.push('crew');
    }

    // Contact
    if (ch.contact && typeof ch.contact === 'object') {
      const c = one(j.contact);
      const vals: Row = {};
      for (const k of ['name', 'email', 'phone']) if (k in ch.contact) vals[k] = clean(ch.contact[k], 200) || (k === 'name' ? '' : null);
      if (c) {
        await must(sb.from('contacts').update(vals).eq('id', c.id));
        undo.push({ table: 'contacts', op: 'update', match: { id: c.id }, values: Object.fromEntries(Object.keys(vals).map(k => [k, c[k]])) });
      } else {
        const ins = (await must(sb.from('contacts').insert({ name: '', ...vals, client_id: j.client_id }).select('id').single())) as Row;
        patch.contact_id = ins.id; old.contact_id = null;
        undo.push({ table: 'contacts', op: 'delete', match: { id: ins.id } });
      }
      done.push('contact');
    }

    if (Object.keys(patch).length) {
      await must(sb.from('jobs').update(patch).eq('id', j.id));
      // Restore job columns first, then the rows that hang off it.
      undo.unshift({ table: 'jobs', op: 'update', match: { id: j.id }, values: old });
    }
    if (!done.length) fail('Nothing to change.');
    await record(ctx, 'update_job', `Updated ${one(j.client)?.name} — ${j.title}: ${done.join(', ')}`, i, undo);
    return { ok: true, changed: done };
  },

  async add_task(ctx, i) {
    const { sb, me } = ctx;
    const title = clean(i.title) || fail('Title can’t be empty.');
    let jobId: string | null = null, owner: string | null = null;
    if (i.job_id) { const j = await loadJob(sb, i.job_id); jobId = j.id; owner = j.owner_id; }
    const assignee = i.assignee ? await personId(sb, i.assignee) : owner || me.id;
    const due = isDate(i.due) ? i.due : today();
    const type = TASK_TYPES.find(t => t === i.type) || 'Task';
    const t = (await must(sb.from('tasks').insert({ title, job_id: jobId, assignee_id: assignee, due, type }).select('id').single())) as Row;
    await record(ctx, 'add_task', `Added task “${title}” due ${due}`, i, [{ table: 'tasks', op: 'delete', match: { id: t.id } }]);
    return { task_id: t.id };
  },

  async update_task(ctx, i) {
    const { sb } = ctx;
    const t = (await must(sb.from('tasks').select('*').eq('id', i.task_id).maybeSingle())) as Row | null;
    if (!t) fail('No task with that id.');
    const patch: Row = {}, old: Row = {};
    if ('done' in i) { patch.done = !!i.done; old.done = t!.done; }
    if ('due' in i) { if (!isDate(i.due)) fail('due must be YYYY-MM-DD.'); patch.due = i.due; old.due = t!.due; }
    if ('title' in i) { patch.title = clean(i.title) || fail('Title can’t be empty.'); old.title = t!.title; }
    if ('assignee' in i) { patch.assignee_id = await personId(sb, i.assignee); old.assignee_id = t!.assignee_id; }
    if (!Object.keys(patch).length) fail('Nothing to change.');
    await must(sb.from('tasks').update(patch).eq('id', t!.id));
    const what = 'done' in patch ? (patch.done ? 'Completed' : 'Reopened') : 'Updated';
    await record(ctx, 'update_task', `${what} task “${t!.title}”`, i, [{ table: 'tasks', op: 'update', match: { id: t!.id }, values: old }]);
    return { ok: true };
  },

  async create_invoice(ctx, i) {
    const { sb, me } = ctx;
    const j = await loadJob(sb, i.job_id);
    const kind = (['Deposit', 'Progress', 'Final'] as InvoiceKind[]).find(k => k === i.kind) || fail('kind must be Deposit, Progress or Final.');
    const st = await settings(sb);
    const co = toCompany(st);
    const earlier = ((await must(sb.from('invoices').select('kind,number,subtotal_cents,status').eq('job_id', j.id))) as Row[])
      .filter(x => x.status !== 'Void').map(x => ({ kind: x.kind, number: x.number, subtotalCents: Number(x.subtotal_cents) }));
    const services = (j.job_services || []).map((s: Row) => one(s.service)?.name).filter(Boolean);
    const issue = today();
    const due = new Date(); due.setDate(due.getDate() + co.paymentDays);
    const c = one(j.contact);
    const inv = (await must(sb.from('invoices').insert({
      job_id: j.id, kind: kind!, lines: draftInvoiceLines(kind!, { title: j.title, services, valueCents: Number(j.value_cents) }, co.depositPct, earlier),
      tax_rate: co.taxRate, tax_label: co.taxLabel, issue_date: issue, due_date: due.toISOString().slice(0, 10), created_by: me.id,
      bill_to: { client: one(j.client)?.name, contact: c?.name || '', email: c?.email || '', phone: c?.phone || '', site: j.site }
    }).select('id,number,total_cents').single())) as Row;
    await record(ctx, 'create_invoice', `Drafted ${kind!.toLowerCase()} invoice ${inv.number} for ${one(j.client)?.name} (${'$' + dollars(inv.total_cents).toLocaleString('en-CA')} incl. tax)`, i,
      [{ table: 'invoices', op: 'delete', match: { id: inv.id } }]);
    return { invoice_number: inv.number, total_incl_tax: dollars(inv.total_cents), link: '/invoices/' + inv.id, note: 'Draft only. Someone must review and send it.' };
  },

  async create_agreement(ctx, i) {
    const { sb, me } = ctx;
    const j = await loadJob(sb, i.job_id);
    const [st, tpl] = await Promise.all([settings(sb), must(sb.from('agreement_templates').select('id,body').order('is_default', { ascending: false }).limit(1).maybeSingle())]);
    if (!tpl) fail('There’s no agreement template yet.');
    const c = one(j.contact);
    const body = fillTemplate((tpl as Row).body, templateVars({
      company: toCompany(st), client: one(j.client)?.name, contact: c?.name || '', email: c?.email || '', site: j.site, title: j.title,
      services: (j.job_services || []).map((s: Row) => one(s.service)?.name).filter(Boolean), priceCents: Number(j.value_cents),
      start: j.start_date || '', end: j.end_date || '', emergency: j.emergency, date: today()
    }));
    const ag = (await must(sb.from('agreements').insert({ job_id: j.id, template_id: (tpl as Row).id, body, price_cents: j.value_cents, created_by: me.id }).select('id,number').single())) as Row;
    await record(ctx, 'create_agreement', `Drafted agreement ${ag.number} for ${one(j.client)?.name}`, i, [{ table: 'agreements', op: 'delete', match: { id: ag.id } }]);
    return { agreement_number: ag.number, link: '/agreements/' + ag.id, note: 'Draft only. Someone must review and send it.' };
  },

  async edit_pipeline_stages(ctx, i) {
    leadershipOnly(ctx, 'change pipeline stages');
    const { sb } = ctx;
    const st = await settings(sb);
    const stages = [...(st.stages as string[])];
    const name = clean(i.name, 40) || fail('Give a stage name.');
    const undo: UndoOp[] = [{ table: 'app_settings', op: 'update', match: { id: 1 }, values: { stages: st.stages } }];
    let summary = '';
    if (i.action === 'add') {
      if (stages.some(s => eq(s, name))) fail('That stage already exists.');
      let at = i.before ? stages.findIndex(s => eq(s, i.before)) : -1;
      if (at < 0) at = stages.indexOf('Won');
      stages.splice(at < 0 ? stages.length : at, 0, name);
      summary = `Added stage “${name}”`;
    } else {
      const from = stages.find(s => eq(s, name)) || fail(`No stage “${name}”. Stages: ${stages.join(', ')}.`);
      if (PROTECTED_STAGES.includes(from!)) fail('Won and Lost can’t be renamed or removed.');
      const moved = ((await must(sb.from('jobs').select('id').eq('stage', from!))) as Row[]).map(r => r.id);
      let to: string;
      if (i.action === 'rename') {
        to = clean(i.new_name, 40) || fail('Give the new name.');
        if (stages.some(s => eq(s, to))) fail('A stage with that name exists.');
        stages[stages.indexOf(from!)] = to;
        summary = `Renamed stage “${from}” to “${to}”`;
      } else {
        stages.splice(stages.indexOf(from!), 1);
        to = stages.find(s => eq(s, i.move_to)) || (moved.length ? fail(`Say which stage gets its ${moved.length} deal(s) (move_to).`) : stages[0]);
        summary = `Removed stage “${from}”` + (moved.length ? `, moved ${moved.length} deal(s) to ${to}` : '');
      }
      if (moved.length) {
        await must(sb.from('jobs').update({ stage: to }).in('id', moved));
        undo.push({ table: 'jobs', op: 'update', matchIn: ['id', moved], values: { stage: from } });
      }
    }
    await must(sb.from('app_settings').update({ stages }).eq('id', 1).select('id').single());
    // Settings go back first, then the deals.
    await record(ctx, 'edit_pipeline_stages', summary, i, undo);
    return { stages };
  },

  async edit_job_fields(ctx, i) {
    leadershipOnly(ctx, 'change job fields');
    const { sb } = ctx;
    const st = await settings(sb);
    const fields = [...((st.job_fields || []) as Row[])];
    const label = clean(i.label, 40) || fail('Give a label.');
    if (i.action === 'add') {
      if (fields.some(f => eq(f.label, label))) fail('That field already exists.');
      const id = 'f_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Math.random().toString(36).slice(2, 6);
      fields.push({ id, label, type: ['number', 'date'].includes(i.type) ? i.type : 'text' });
    } else {
      const at = fields.findIndex(f => eq(f.label, label));
      if (at < 0) fail(`No field “${label}”.`);
      fields.splice(at, 1);
    }
    await must(sb.from('app_settings').update({ job_fields: fields }).eq('id', 1).select('id').single());
    await record(ctx, 'edit_job_fields', (i.action === 'add' ? 'Added' : 'Removed') + ` job field “${label}”`, i,
      [{ table: 'app_settings', op: 'update', match: { id: 1 }, values: { job_fields: st.job_fields || [] } }]);
    return { fields: fields.map(f => f.label) };
  },

  async add_service(ctx, i) {
    const name = clean(i.name, 80) || fail('Give a name.');
    const existing = (await must(ctx.sb.from('services').select('id').ilike('name', name).maybeSingle())) as Row | null;
    if (existing) fail('That service already exists.');
    const s = (await must(ctx.sb.from('services').insert({ name, is_custom: true }).select('id').single())) as Row;
    await record(ctx, 'add_service', `Added service “${name}”`, i, [{ table: 'services', op: 'delete', match: { id: s.id } }]);
    return { ok: true };
  },

  async set_margin_target(ctx, i) {
    leadershipOnly(ctx, 'change the margin target');
    const pct = Math.round(Number(i.percent));
    if (!(pct >= 1 && pct <= 99)) fail('Use a percentage between 1 and 99.');
    const st = await settings(ctx.sb);
    await must(ctx.sb.from('app_settings').update({ margin_target: pct }).eq('id', 1).select('id').single());
    await record(ctx, 'set_margin_target', `Margin target set to ${pct}% (was ${st.margin_target}%)`, i,
      [{ table: 'app_settings', op: 'update', match: { id: 1 }, values: { margin_target: st.margin_target } }]);
    return { ok: true };
  },

  async request_feature(ctx, i) {
    const { sb, me } = ctx;
    leadershipOnly(ctx, 'file app change requests');
    const title = clean(i.title, 120) || fail('Give a title.');
    const description = clean(i.description, 6000) || fail('Describe the change.');
    const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO || 'ny7fdnr79t-bit/JACKRABBIT';
    if (!token) fail('Feature requests aren’t connected yet (GITHUB_TOKEN isn’t set on the server). Note the request and add it later.');
    const body = `${description}\n\n---\nRequested from the CRM by **${me.name}** (${me.role}) on ${today()}.\n\nBuild this on a new branch from \`${process.env.GITHUB_BASE_BRANCH || 'crm-nextjs'}\` and open a pull request. Follow README.md; keep the Nocturne design, run \`npm run typecheck\` and \`npm run build\`, and add a Supabase migration for any schema change.`;
    const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: [process.env.GITHUB_REQUEST_LABEL || 'claude'] })
    });
    const issue = await r.json().catch(() => ({}));
    if (!r.ok) fail('GitHub didn’t accept the request: ' + (issue.message || r.status));
    await must(sb.from('feature_requests').insert({ user_id: me.id, title, description, issue_url: issue.html_url, issue_number: issue.number }));
    ctx.changes.push(`Filed app change request #${issue.number}: ${title}`);
    return { issue_number: issue.number, url: issue.html_url, next: 'Claude Code builds it on a branch and opens a pull request with a preview link. Nothing goes live until someone merges it.' };
  },

  async open_in_crm(ctx, i) {
    ctx.nav = { screen: i.screen || undefined, jobId: i.job_id || undefined };
    return { ok: true };
  }
};

export async function runTool(ctx: ToolCtx, name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  const h = handlers[name];
  if (!h) return { content: 'Unknown tool.', isError: true };
  try {
    const out = await h(ctx, (input && typeof input === 'object' ? input : {}) as Row);
    return { content: JSON.stringify(out), isError: false };
  } catch (e) {
    // Database errors include row-level-security refusals: report them to the model as-is.
    return { content: e instanceof Error ? e.message : 'Something went wrong.', isError: true };
  }
}
