'use client';

// Shared CRM state backed by Supabase. Every screen reads from here; every
// write goes to Postgres (row level security decides what's allowed) and is
// applied locally first so the UI stays instant. Realtime changes from other
// people trigger a reload, so everyone sees the same data.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import {
  DEFAULT_SETTINGS, fromCents, guessTaskType, toCents,
  type Contact, type CostKey, type CrewMember, type Job, type Profile, type Service, type Settings, type Task, type TaskType
} from '@/lib/crm';
import {
  DEFAULT_COMPANY, fillTemplate, templateVars, toAgreement, toCompany, toInvoice,
  type Agreement, type Company, type Invoice, type InvoiceKind, type Line, type Template
} from '@/lib/docs';

type Row = Record<string, any>;

export type DealDraft = {
  client: string;
  title: string;
  clientType: string;
  value: string;
  ownerId: string;
  emergency: boolean;
  services: string[]; // service names
};

type JobPatch = Partial<Pick<Job, 'title' | 'site' | 'stage' | 'status' | 'billing' | 'value' | 'emergency' | 'start' | 'end' | 'ownerId'>>;

type Crm = {
  ready: boolean;
  me: Profile;
  profiles: Profile[];
  crew: CrewMember[];
  services: Service[];
  jobs: Job[];
  tasks: Task[];
  settings: Settings;
  error: string;
  clearError: () => void;
  // jobs
  updateJob: (id: string, patch: JobPatch) => void;
  setCost: (id: string, key: CostKey, dollars: number) => void;
  setServices: (id: string, names: string[]) => Promise<void>;
  toggleCrew: (id: string, crewId: string) => void;
  saveContact: (id: string, c: Omit<Contact, 'id'>) => Promise<void>;
  createDeal: (d: DealDraft) => Promise<string | null>;
  deleteJob: (id: string) => Promise<void>;
  // tasks
  addTask: (t: { title: string; jobId: string | null; assigneeId: string | null; due: string; type?: TaskType }) => void;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
  // team
  addCrew: (name: string, role: string) => void;
  removeCrew: (id: string) => void;
  updateProfile: (id: string, patch: Partial<Pick<Profile, 'name' | 'role' | 'quoPhone' | 'active'>>) => void;
  // documents
  company: Company;
  invoices: Invoice[];
  agreements: Agreement[];
  templates: Template[];
  createInvoice: (jobId: string, kind: InvoiceKind) => Promise<string | null>;
  updateInvoice: (id: string, patch: Partial<Pick<Invoice, 'status' | 'issueDate' | 'dueDate' | 'lines' | 'taxRate' | 'notes' | 'billTo' | 'paidVia'>>) => Promise<boolean>;
  deleteInvoice: (id: string) => Promise<boolean>;
  createAgreement: (jobId: string) => Promise<string | null>;
  updateAgreement: (id: string, patch: Partial<Pick<Agreement, 'status' | 'title' | 'body' | 'priceCents'>>) => Promise<boolean>;
  deleteAgreement: (id: string) => Promise<boolean>;
  saveCompany: (patch: Partial<Company>) => void;
  saveTemplate: (id: string, body: string) => void;
  // ui
  newDeal: boolean;
  setNewDeal: (open: boolean) => void;
};

const Ctx = createContext<Crm | null>(null);

export const useCrm = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCrm outside CrmProvider');
  return c;
};

const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] ?? null : x ?? null);

const toProfile = (r: Row): Profile => ({ id: r.id, name: r.name || r.email, role: r.role, email: r.email, quoPhone: r.quo_phone || '', active: r.active });

const toJob = (r: Row): Job => {
  const client = one<Row>(r.client);
  const contact = one<Row>(r.contact);
  const c = one<Row>(r.costs) || {};
  return {
    id: r.id,
    clientId: r.client_id,
    client: client?.name || '',
    clientType: client?.type || 'Commercial',
    contact: contact ? { id: contact.id, name: contact.name || '', email: contact.email || '', phone: contact.phone || '' } : null,
    ownerId: r.owner_id,
    title: r.title,
    site: r.site || '',
    stage: r.stage,
    status: r.status,
    billing: r.billing,
    value: fromCents(r.value_cents),
    emergency: !!r.emergency,
    start: r.start_date || '',
    end: r.end_date || '',
    source: r.source || '',
    costs: {
      labour: fromCents(c.labour_cents),
      equipment: fromCents(c.equipment_cents),
      disposal: fromCents(c.disposal_cents),
      hauling: fromCents(c.hauling_cents),
      permits: fromCents(c.permits_cents)
    },
    serviceIds: (r.job_services || []).map((x: Row) => x.service_id),
    crewIds: (r.job_crew || []).map((x: Row) => x.crew_member_id),
    createdAt: r.created_at
  };
};

const toTask = (r: Row): Task => ({ id: r.id, jobId: r.job_id, assigneeId: r.assignee_id, title: r.title, type: r.type, due: r.due, done: r.done });

const JOB_COLUMNS: Record<keyof JobPatch, string> = {
  title: 'title', site: 'site', stage: 'stage', status: 'status', billing: 'billing', value: 'value_cents',
  emergency: 'emergency', start: 'start_date', end: 'end_date', ownerId: 'owner_id'
};

export function CrmProvider({ me: initialMe, children }: { me: Profile; children: React.ReactNode }) {
  const sb = supabase();
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([initialMe]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [services, setServicesList] = useState<Service[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState('');
  const [newDeal, setNewDeal] = useState(false);
  const [company, setCompany] = useState<Company>(DEFAULT_COMPANY);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const load = useCallback(async () => {
    const [p, c, s, j, t, st, inv, ag, tp] = await Promise.all([
      sb.from('profiles').select('id,name,role,email,quo_phone,active').order('name'),
      sb.from('crew_members').select('id,name,role').eq('active', true).order('name'),
      sb.from('services').select('id,name,grp,is_custom,sort').order('sort').order('name'),
      sb.from('jobs').select('*, client:clients(id,name,type), contact:contacts(id,name,email,phone), costs:job_costs(*), job_services(service_id), job_crew(crew_member_id)').order('created_at'),
      sb.from('tasks').select('*').order('due'),
      sb.from('app_settings').select('*').maybeSingle(),
      sb.from('invoices').select('*').order('created_at', { ascending: false }),
      // Signature images stay on the server; the CRM only needs the status.
      sb.from('agreements').select('id,number,job_id,status,title,body,price_cents,sign_token,sent_at,viewed_at,signed_at,signer_name,signer_title').order('created_at', { ascending: false }),
      sb.from('agreement_templates').select('*').order('name')
    ]);
    const failed = [p, c, s, j, t, st, inv, ag, tp].find(x => x.error);
    if (failed?.error) { setError(failed.error.message); return; }
    setProfiles((p.data || []).map(toProfile));
    setCrew((c.data || []) as CrewMember[]);
    setServicesList((s.data || []).map((r: Row) => ({ id: r.id, name: r.name, grp: r.grp, isCustom: r.is_custom })));
    setJobs((j.data || []).map(toJob));
    setTasks((t.data || []).map(toTask));
    if (st.data) {
      setSettings({ marginTarget: st.data.margin_target, minJob: fromCents(st.data.min_job_cents), stages: st.data.stages, showLost: st.data.show_lost });
      setCompany(toCompany(st.data));
    }
    setInvoices((inv.data || []).map(toInvoice));
    setAgreements((ag.data || []).map(toAgreement));
    setTemplates((tp.data || []).map((r: Row) => ({ id: r.id, name: r.name, body: r.body, isDefault: r.is_default })));
    setReady(true);
  }, [sb]);

  // Reload on any change in the shared tables, coalescing bursts.
  const reloadT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadSoon = useCallback(() => {
    if (reloadT.current) clearTimeout(reloadT.current);
    reloadT.current = setTimeout(load, 400);
  }, [load]);

  useEffect(() => {
    load();
    const ch = sb.channel('crm').on('postgres_changes', { event: '*', schema: 'public' }, reloadSoon).subscribe();
    const onFocus = () => reloadSoon();
    window.addEventListener('focus', onFocus);
    return () => { sb.removeChannel(ch); window.removeEventListener('focus', onFocus); };
  }, [sb, load, reloadSoon]);

  // Runs a write; on failure shows the message and reloads to undo the optimistic change.
  const run = useCallback(async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) { setError(error.message); load(); return false; }
    return true;
  }, [load]);

  const patchJobLocal = (id: string, f: (j: Job) => Job) => setJobs(js => js.map(j => (j.id === id ? f(j) : j)));

  const updateJob: Crm['updateJob'] = (id, patch) => {
    const job = jobs.find(j => j.id === id);
    const local = { ...patch };
    if (patch.stage === 'Won' && job?.stage !== 'Won') local.status = 'Scheduled';
    patchJobLocal(id, j => ({ ...j, ...local }));
    const row: Row = {};
    for (const [key, v] of Object.entries(patch) as [keyof JobPatch, unknown][]) {
      row[JOB_COLUMNS[key]] = key === 'value' ? toCents(v as number) : (key === 'start' || key === 'end') && !v ? null : v;
    }
    run(sb.from('jobs').update(row).eq('id', id));
  };

  const setCost: Crm['setCost'] = (id, key, dollars) => {
    patchJobLocal(id, j => ({ ...j, costs: { ...j.costs, [key]: dollars } }));
    run(sb.from('job_costs').update({ [key + '_cents']: toCents(dollars) }).eq('job_id', id));
  };

  const ensureServices = async (names: string[]) => {
    const have = new Map(services.map(s => [s.name.toLowerCase(), s]));
    if (names.some(n => !have.has(n.toLowerCase()))) {
      const { data, error } = await sb.rpc('ensure_services', { p_names: names });
      if (error) setError(error.message);
      (data || []).forEach((r: Row) => have.set(r.name.toLowerCase(), { id: r.id, name: r.name, grp: r.grp, isCustom: r.is_custom }));
      setServicesList([...have.values()]);
    }
    return names.map(n => have.get(n.toLowerCase())?.id).filter((x): x is string => !!x);
  };

  const setServices: Crm['setServices'] = async (id, names) => {
    const ids = await ensureServices(names);
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    patchJobLocal(id, j => ({ ...j, serviceIds: ids }));
    const add = ids.filter(x => !job.serviceIds.includes(x));
    const del = job.serviceIds.filter(x => !ids.includes(x));
    if (add.length) await run(sb.from('job_services').insert(add.map(service_id => ({ job_id: id, service_id }))));
    if (del.length) await run(sb.from('job_services').delete().eq('job_id', id).in('service_id', del));
  };

  const toggleCrew: Crm['toggleCrew'] = (id, crewId) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const on = job.crewIds.includes(crewId);
    patchJobLocal(id, j => ({ ...j, crewIds: on ? j.crewIds.filter(x => x !== crewId) : [...j.crewIds, crewId] }));
    run(on
      ? sb.from('job_crew').delete().eq('job_id', id).eq('crew_member_id', crewId)
      : sb.from('job_crew').insert({ job_id: id, crew_member_id: crewId }));
  };

  const saveContact: Crm['saveContact'] = async (id, c) => {
    const job = jobs.find(j => j.id === id);
    if (!job) return;
    const row = { name: c.name.trim(), email: c.email.trim() || null, phone: c.phone.trim() || null };
    if (job.contact) {
      patchJobLocal(id, j => ({ ...j, contact: { ...j.contact!, ...c } }));
      await run(sb.from('contacts').update(row).eq('id', job.contact.id));
    } else {
      const ins = await sb.from('contacts').insert({ ...row, client_id: job.clientId }).select('id').single();
      if (ins.error) { setError(ins.error.message); return; }
      patchJobLocal(id, j => ({ ...j, contact: { id: ins.data.id, ...c } }));
      await run(sb.from('jobs').update({ contact_id: ins.data.id }).eq('id', id));
    }
  };

  const createDeal: Crm['createDeal'] = async d => {
    const { data, error } = await sb.rpc('create_deal', {
      p_client: d.client.trim(),
      p_client_type: d.clientType,
      p_title: d.title.trim(),
      p_value_cents: toCents(+d.value),
      p_owner_id: d.ownerId || null,
      p_emergency: d.emergency,
      p_services: d.services
    });
    if (error) { setError(error.message); return null; }
    await load();
    return data as string;
  };

  const deleteJob: Crm['deleteJob'] = async id => {
    setJobs(js => js.filter(j => j.id !== id));
    setTasks(ts => ts.filter(t => t.jobId !== id));
    const { error } = await sb.from('jobs').delete().eq('id', id);
    if (error) {
      setError(/invoices_job_id_fkey|agreements_job_id_fkey/.test(error.message)
        ? 'This deal has invoices or agreements, so it can’t be deleted. Move it to Lost instead.'
        : error.message);
      load();
    }
  };

  // ── Documents ──────────────────────────────────────────────────────────

  const jobById = (id: string) => jobs.find(j => j.id === id);
  const svcNames = (j: Job) => j.serviceIds.map(id => services.find(x => x.id === id)?.name).filter((x): x is string => !!x);
  const pct = (cents: number, p: number) => Math.round((cents * p) / 100);

  const createInvoice: Crm['createInvoice'] = async (jobId, kind) => {
    const j = jobById(jobId);
    if (!j) return null;
    const value = toCents(j.value);
    const earlier = invoices.filter(x => x.jobId === jobId && x.status !== 'Void' && x.kind !== 'Final');
    const lines: Line[] =
      kind === 'Deposit' ? [{ description: `Deposit (${company.depositPct}%) — ${j.title}`, qty: 1, unit_cents: pct(value, company.depositPct) }]
      : kind === 'Progress' ? [{ description: `Progress billing — ${j.title}`, qty: 1, unit_cents: 0 }]
      : [
          { description: `${j.title}${svcNames(j).length ? ' — ' + svcNames(j).join(', ') : ''}`, qty: 1, unit_cents: value },
          ...earlier.map(x => ({ description: `Less: ${x.kind.toLowerCase()} invoice ${x.number}`, qty: 1, unit_cents: -x.subtotalCents }))
        ];
    const issue = new Date();
    const due = new Date(issue); due.setDate(due.getDate() + company.paymentDays);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const { data, error } = await sb.from('invoices').insert({
      job_id: jobId, kind, lines, tax_rate: company.taxRate, tax_label: company.taxLabel,
      issue_date: iso(issue), due_date: iso(due), created_by: initialMe.id,
      bill_to: { client: j.client, contact: j.contact?.name || '', email: j.contact?.email || '', phone: j.contact?.phone || '', site: j.site }
    }).select('*').single();
    if (error) { setError(error.message); return null; }
    setInvoices(xs => [toInvoice(data), ...xs]);
    return data.id as string;
  };

  const updateInvoice: Crm['updateInvoice'] = async (id, patch) => {
    const row: Row = {};
    if ('status' in patch) row.status = patch.status;
    if ('issueDate' in patch) row.issue_date = patch.issueDate;
    if ('dueDate' in patch) row.due_date = patch.dueDate;
    if ('lines' in patch) row.lines = patch.lines;
    if ('taxRate' in patch) row.tax_rate = patch.taxRate;
    if ('notes' in patch) row.notes = patch.notes;
    if ('billTo' in patch) row.bill_to = patch.billTo;
    if ('paidVia' in patch) row.paid_via = patch.paidVia;
    const { data, error } = await sb.from('invoices').update(row).eq('id', id).select('*').single();
    if (error) { setError(error.message); load(); return false; }
    setInvoices(xs => xs.map(x => (x.id === id ? toInvoice(data) : x)));
    if ('status' in patch) reloadSoon(); // job billing changes with it
    return true;
  };

  const deleteInvoice: Crm['deleteInvoice'] = async id => {
    const ok = await run(sb.from('invoices').delete().eq('id', id));
    if (ok) setInvoices(xs => xs.filter(x => x.id !== id));
    return ok;
  };

  const createAgreement: Crm['createAgreement'] = async jobId => {
    const j = jobById(jobId);
    const tpl = templates.find(t => t.isDefault) || templates[0];
    if (!j) return null;
    if (!tpl) { setError('There’s no agreement template yet. Add one under Team.'); return null; }
    const body = fillTemplate(tpl.body, templateVars({
      company, client: j.client, contact: j.contact?.name || '', email: j.contact?.email || '', site: j.site, title: j.title,
      services: svcNames(j), priceCents: toCents(j.value), start: j.start, end: j.end, emergency: j.emergency, date: new Date().toISOString().slice(0, 10)
    }));
    const { data, error } = await sb.from('agreements').insert({
      job_id: jobId, template_id: tpl.id, body, price_cents: toCents(j.value), created_by: initialMe.id
    }).select('id,number,job_id,status,title,body,price_cents,sign_token,sent_at,viewed_at,signed_at,signer_name,signer_title').single();
    if (error) { setError(error.message); return null; }
    setAgreements(xs => [toAgreement(data), ...xs]);
    return data.id as string;
  };

  const updateAgreement: Crm['updateAgreement'] = async (id, patch) => {
    const row: Row = {};
    if ('status' in patch) row.status = patch.status;
    if ('title' in patch) row.title = patch.title;
    if ('body' in patch) row.body = patch.body;
    if ('priceCents' in patch) row.price_cents = patch.priceCents;
    setAgreements(xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x)));
    return run(sb.from('agreements').update(row).eq('id', id));
  };

  const deleteAgreement: Crm['deleteAgreement'] = async id => {
    const ok = await run(sb.from('agreements').delete().eq('id', id));
    if (ok) setAgreements(xs => xs.filter(x => x.id !== id));
    return ok;
  };

  const COMPANY_COLUMNS: Record<keyof Company, string> = {
    name: 'company_name', address: 'company_address', email: 'company_email', phone: 'company_phone', hstNumber: 'hst_number',
    taxRate: 'tax_rate', taxLabel: 'tax_label', paymentDays: 'payment_days', depositPct: 'deposit_pct', etransferEmail: 'etransfer_email', footer: 'invoice_footer'
  };
  const saveCompany: Crm['saveCompany'] = patch => {
    setCompany(c => ({ ...c, ...patch }));
    const row: Row = {};
    for (const [key, v] of Object.entries(patch)) row[COMPANY_COLUMNS[key as keyof Company]] = v;
    run(sb.from('app_settings').update(row).eq('id', 1));
  };

  const saveTemplate: Crm['saveTemplate'] = (id, body) => {
    setTemplates(ts => ts.map(t => (t.id === id ? { ...t, body } : t)));
    run(sb.from('agreement_templates').update({ body, updated_at: new Date().toISOString() }).eq('id', id));
  };

  const addTask: Crm['addTask'] = t => {
    const id = crypto.randomUUID();
    const task: Task = { id, title: t.title.trim(), jobId: t.jobId || null, assigneeId: t.assigneeId || null, due: t.due, done: false, type: t.type || guessTaskType(t.title) };
    setTasks(ts => [...ts, task]);
    run(sb.from('tasks').insert({ id, title: task.title, job_id: task.jobId, assignee_id: task.assigneeId, due: task.due, type: task.type }));
  };

  const toggleTask: Crm['toggleTask'] = id => {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    setTasks(ts => ts.map(x => (x.id === id ? { ...x, done: !x.done } : x)));
    run(sb.from('tasks').update({ done: !t.done }).eq('id', id));
  };

  const deleteTask: Crm['deleteTask'] = id => {
    setTasks(ts => ts.filter(x => x.id !== id));
    run(sb.from('tasks').delete().eq('id', id));
  };

  const addCrew: Crm['addCrew'] = (name, role) => {
    const id = crypto.randomUUID();
    setCrew(cs => [...cs, { id, name: name.trim(), role }].sort((a, b) => a.name.localeCompare(b.name)));
    run(sb.from('crew_members').insert({ id, name: name.trim(), role }));
  };

  const removeCrew: Crm['removeCrew'] = id => {
    setCrew(cs => cs.filter(c => c.id !== id));
    // Soft delete keeps past jobs' crew history intact.
    run(sb.from('crew_members').update({ active: false }).eq('id', id));
  };

  const updateProfile: Crm['updateProfile'] = (id, patch) => {
    setProfiles(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
    const row: Row = {};
    if ('name' in patch) row.name = patch.name;
    if ('role' in patch) row.role = patch.role;
    if ('quoPhone' in patch) row.quo_phone = patch.quoPhone || null;
    if ('active' in patch) row.active = patch.active;
    run(sb.from('profiles').update(row).eq('id', id));
  };

  const me = profiles.find(p => p.id === initialMe.id) || initialMe;

  const value: Crm = {
    ready, me, profiles, crew, services, jobs, tasks, settings, error, clearError: () => setError(''),
    updateJob, setCost, setServices, toggleCrew, saveContact, createDeal, deleteJob,
    addTask, toggleTask, deleteTask, addCrew, removeCrew, updateProfile,
    company, invoices, agreements, templates, createInvoice, updateInvoice, deleteInvoice,
    createAgreement, updateAgreement, deleteAgreement, saveCompany, saveTemplate,
    newDeal, setNewDeal
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Lookup helpers derived from the store.
export function useLookups() {
  const { profiles, services, crew } = useCrm();
  return useMemo(() => {
    const profileName = new Map(profiles.map(p => [p.id, p.name]));
    const serviceName = new Map(services.map(s => [s.id, s.name]));
    const crewById = new Map(crew.map(c => [c.id, c]));
    return {
      ownerName: (id: string | null) => (id && profileName.get(id)) || 'Unassigned',
      serviceNames: (j: Job) => j.serviceIds.map(id => serviceName.get(id)).filter((x): x is string => !!x),
      crewOf: (j: Job) => j.crewIds.map(id => crewById.get(id)).filter((x): x is CrewMember => !!x)
    };
  }, [profiles, services, crew]);
}
