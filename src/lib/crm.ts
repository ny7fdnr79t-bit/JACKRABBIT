// Domain types, constants and pure helpers shared by every screen.
// Amounts in the UI are whole dollars; the database stores cents.

export const CLIENT_TYPES = ['Developer', 'Realtor', 'Commercial', 'Industrial', 'Property manager', 'Private owner'] as const;
export const STATUS = ['Scheduled', 'On site', 'Completed'] as const;
export const BILLING = ['Not invoiced', 'Deposit invoiced', 'Progress invoiced', 'Invoiced in full', 'Paid'] as const;
export const USER_ROLES = ['Account manager', 'Dispatch', 'Billing', 'Leadership', 'Field'] as const;
export const CREW_ROLES = ['Foreman', 'Operator', 'Driver', 'Labourer'] as const;
export const TASK_TYPES = ['Call', 'Visit', 'Dispatch', 'Invoice', 'Quote', 'Task'] as const;
export const PROTECTED_STAGES = ['Won', 'Lost'];
export const SERVICE_GROUPS = ['Cleanouts & Disposal', 'Hazardous & Regulated', 'Abatement', 'Clearing & Removal'];
export const COSTS = [
  ['labour', 'Labour'],
  ['equipment', 'Equipment rental'],
  ['disposal', 'Disposal & tipping'],
  ['hauling', 'Hauling'],
  ['permits', 'Permits & fees']
] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];
export type Status = (typeof STATUS)[number];
export type Billing = (typeof BILLING)[number];
export type TaskType = (typeof TASK_TYPES)[number];
export type CostKey = (typeof COSTS)[number][0];
export type Costs = Record<CostKey, number>;

export type Profile = { id: string; name: string; role: string; email: string; quoPhone: string; active: boolean };
export type CrewMember = { id: string; name: string; role: string };
export type Service = { id: string; name: string; grp: string; isCustom: boolean };
export type Contact = { id: string; name: string; email: string; phone: string };
export type Job = {
  id: string;
  clientId: string;
  client: string;
  clientType: ClientType;
  contact: Contact | null;
  ownerId: string | null;
  title: string;
  site: string;
  stage: string;
  status: Status | null;
  billing: Billing;
  value: number;
  emergency: boolean;
  start: string;
  end: string;
  source: string;
  costs: Costs;
  extra: Record<string, string>;
  serviceIds: string[];
  crewIds: string[];
  createdAt: string;
};
export type Task = { id: string; jobId: string | null; assigneeId: string | null; title: string; type: TaskType; due: string; done: boolean };
export type JobField = { id: string; label: string; type: 'text' | 'number' | 'date' };
export type Settings = { marginTarget: number; minJob: number; stages: string[]; showLost: boolean; jobFields: JobField[] };

export const DEFAULT_SETTINGS: Settings = {
  marginTarget: 30,
  minJob: 5000,
  stages: ['Lead', 'Site visit', 'Quoted', 'Negotiation', 'Won', 'Lost'],
  showLost: false,
  jobFields: []
};

export const STAGE_MARK: Record<string, string> = {
  Lead: 'var(--color-neutral-700)',
  'Site visit': 'var(--color-neutral-600)',
  Quoted: 'var(--color-accent-700)',
  Negotiation: 'var(--color-accent-600)',
  Won: 'var(--color-accent)',
  Lost: 'var(--color-neutral-800)'
};
export const STATUS_TAG: Record<Status, string> = { Scheduled: 'tag-neutral', 'On site': 'tag-accent', Completed: 'tag-outline' };
export const BILLING_TAG: Record<Billing, string> = {
  'Not invoiced': 'tag-neutral',
  'Deposit invoiced': 'tag-accent-2',
  'Progress invoiced': 'tag-accent-2',
  'Invoiced in full': 'tag-accent',
  Paid: 'tag-outline'
};

// ── Dates (local calendar days as YYYY-MM-DD) ──────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const today = () => isoDay(new Date());
const dt = (d: string) => new Date(d + 'T00:00:00');
export const fmtD = (d: string) => (d ? dt(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—');
export const days = (a: string, b: string) => Math.round((dt(b).getTime() - dt(a).getTime()) / 86400000);
export const addDays = (d: string, n: number) => { const x = dt(d); x.setDate(x.getDate() + n); return isoDay(x); };
export const todayLong = () => new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });

// ── Money ──────────────────────────────────────────────────────────────
export const money = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-CA');
export const k = (n: number) =>
  n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1000 ? '$' + Math.round(n / 1000) + 'k' : '$' + Math.round(n);
export const toCents = (dollars: number) => Math.round((Number(dollars) || 0) * 100);
export const fromCents = (cents: number | string | null) => (Number(cents) || 0) / 100;

export const costOf = (j: Job) => COSTS.reduce((a, [key]) => a + (j.costs[key] || 0), 0);
export const costed = (j: Job) => costOf(j) > 0;
export const marginOf = (j: Job) => (j.value ? Math.round(((j.value - costOf(j)) / j.value) * 100) : 0);
export const marginColor = (j: Job, target: number) =>
  !costed(j) ? 'var(--color-neutral-500)' : marginOf(j) < target ? 'var(--color-accent-300)' : 'var(--color-neutral-200)';
export const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((x, y) => x + f(y), 0);

// ── Labels ─────────────────────────────────────────────────────────────
export const initials = (n: string) => n.split(/\s+/).filter(Boolean).map(p => p[0]).join('').slice(0, 3).toUpperCase();
export const svcLabel = (names: string[]) => (!names.length ? 'No services' : names[0] + (names.length > 1 ? ' +' + (names.length - 1) : ''));
export const guessTaskType = (title: string): TaskType =>
  /invoice|payment/i.test(title) ? 'Invoice' : /call/i.test(title) ? 'Call' : /visit|walk/i.test(title) ? 'Visit' : /quote/i.test(title) ? 'Quote' : 'Task';
