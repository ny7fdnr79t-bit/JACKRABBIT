// Lead parsing tests: the exact shapes wastely.ca sends to /api/forms.
// Run with `npm run test:leads` (Node 22.6+ runs the TypeScript source directly).
import { parseSubmission, leadView, dealFromLead, allowedOrigin, mapService } from '../src/lib/leads.ts';

let failures = 0;
const ok = (label, cond, extra = '') => { if (!cond) failures++; console.log(cond ? 'ok  ' : 'FAIL', label, extra); };
const SERVICES = ['Estate Cleanout', 'Community Housing Turnover', 'Bulk Waste & Load-Out', 'Warehouse & Facility Clear-Outs', 'Recycling & Material Diversion', 'Commercial Hazardous Waste', 'Oil, Fuel & Chemical Disposal', 'Lithium Battery Disposal', 'E-Waste & Regulated Electronics', 'Asbestos Removal', 'Mould Removal', 'Interior Strip-Out', 'Industrial Dismantling & Decommissioning', 'Land Clearing & Site Prep'];

// What transition.js on wastely.ca posts (text/plain JSON).
const quote = JSON.stringify({ form: 'Quote request', page: 'https://wastely.ca/quote', fields: {
  name: 'Jordan Lee', phone: '416-555-0100', email: 'jordan@example.com', location: '12 King St, Hamilton',
  details: 'Full estate cleanout of a 3-bed house. Some old paint cans.', services: 'Estate Cleanout, Urgent — needed now',
  'Property size': '3 bedroom', 'How full is it?': 'Very full', When: 'This week', confirmed: '$8,000 – $12,000', _gotcha: ''
} });
const p = parseSubmission(quote);
ok('website quote accepted', p.ok === true && p.form === 'Quote request');
ok('underscore fields dropped', p.ok === true && !('_gotcha' in p.fields));
ok('honeypot filled → treated as spam', parseSubmission(JSON.stringify({ form: 'Contact', fields: { Name: 'x', _gotcha: 'bot' } })).ok === 'spam');
ok('not JSON rejected', parseSubmission('hello').ok === false);
ok('missing fields rejected', parseSubmission('{"form":"x"}').ok === false);
ok('empty form rejected', parseSubmission('{"fields":{"Name":""}}').ok === false);
ok('oversized body rejected', parseSubmission('x'.repeat(40000)).ok === false);

const lead = { id: 'l1', form: 'Quote request', page: '', at: new Date().toISOString(), fields: p.ok === true ? p.fields : {}, status: 'new', jobId: null, createdBy: null };
const v = leadView(lead, SERVICES);
ok('name, phone, email read', v.name === 'Jordan Lee' && v.phone === '416-555-0100' && v.email === 'jordan@example.com');
ok('urgent picked up from services', v.urgent === true);
ok('services mapped, "Urgent" not a service', JSON.stringify(v.services) === JSON.stringify(['Estate Cleanout']), JSON.stringify(v.services));
ok('price range parsed', v.range?.[0] === 8000 && v.range?.[1] === 12000);
const d = dealFromLead(lead, SERVICES, 5000);
ok('deal: private owner named after the person', d.client === 'Jordan Lee' && d.clientType === 'Private owner');
ok('deal: value is the midpoint', d.value === '10000', d.value);
ok('deal: title from first sentence', d.title === 'Full estate cleanout of a 3-bed house', d.title);
ok('deal: source and contact carried', d.source === 'Website · Quote request' && d.contact.phone === '416-555-0100' && d.site === '12 King St, Hamilton');

// The contact form uses label-style keys.
const contact = { ...lead, form: 'Contact', fields: { Name: 'Sam Patel', Company: 'Maple Properties', Email: 's@maple.ca', Phone: '905-555-0199', 'Site location': 'Mississauga', Timeline: 'Emergency', 'Project details': 'Mould in two units', services: 'Mould removal, Something else' } };
const cv = leadView(contact, SERVICES);
ok('contact form: company and site read', cv.company === 'Maple Properties' && cv.location === 'Mississauga');
ok('contact form: emergency timeline is urgent', cv.urgent === true);
ok('"Mould removal" maps to the CRM service', cv.services.includes('Mould Removal'), JSON.stringify(cv.services));
const cd = dealFromLead(contact, SERVICES, 5000);
ok('company lead → Commercial client, minimum value', cd.client === 'Maple Properties' && cd.clientType === 'Commercial' && cd.value === '5000');
ok('fuzzy service match', mapService('Warehouse or facility clear-out', SERVICES) === 'Warehouse & Facility Clear-Outs');

// A logged call.
const call = { ...lead, form: 'Phone call', fields: { Name: 'Pat', Phone: '647-555-0123', Details: 'Asbestos tile in basement', 'Logged by': 'Evan' } };
const callDeal = dealFromLead(call, SERVICES, 5000);
ok('logged call keeps its source', callDeal.source === 'Phone call' && leadView(call, SERVICES).loggedBy === 'Evan');

ok('wastely.ca allowed', allowedOrigin('https://wastely.ca') && allowedOrigin('https://www.wastely.ca'));
ok('GitHub Pages allowed', allowedOrigin('https://ny7fdnr79t-bit.github.io'));
ok('other origins refused', !allowedOrigin('https://evil.example') && !allowedOrigin('https://wastely.ca.evil.com'));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll lead checks passed.');
process.exit(failures ? 1 : 0);
