'use client';

import { useEffect, useState } from 'react';
import { FloppyDisk } from '@phosphor-icons/react';
import { useCrm } from '@/lib/store';
import { PLACEHOLDERS, type Company } from '@/lib/docs';
import { CommitInput } from '@/components/ui';

// Company details printed on invoices and agreements, and the agreement template.
export default function CompanySettings() {
  const { me, company, templates, saveCompany, saveTemplate } = useCrm();
  const lead = me.role === 'Leadership';
  const tpl = templates.find(t => t.isDefault) || templates[0];
  const [body, setBody] = useState(tpl?.body || '');
  useEffect(() => { if (tpl) setBody(tpl.body); }, [tpl?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = (key: keyof Company, label: string, extra: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> = {}) => (
    <div className="field"><label htmlFor={'co-' + key}>{label}</label>
      <CommitInput id={'co-' + key} disabled={!lead} value={String(company[key] ?? '')} {...extra}
        onCommit={v => saveCompany({ [key]: extra.type === 'number' ? Number(v) || 0 : v.trim() } as Partial<Company>)} /></div>
  );

  return (
    <>
      <section className="section">
        <div className="section-head"><h5>Company details on documents</h5><span className="meta">{lead ? 'Printed on every invoice and agreement.' : 'Leadership can change these.'}</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-4)', maxWidth: 980 }}>
          {text('name', 'Company name')}
          {text('address', 'Address')}
          {text('email', 'Email', { type: 'email' })}
          {text('phone', 'Phone', { type: 'tel' })}
          {text('hstNumber', 'HST / business number')}
          {text('taxRate', 'Tax rate (%)', { type: 'number', step: '0.01', min: 0 })}
          {text('depositPct', 'Deposit (% of price)', { type: 'number', min: 0, max: 100 })}
          {text('paymentDays', 'Payment due (days)', { type: 'number', min: 0 })}
          {text('etransferEmail', 'E-transfer email', { type: 'email' })}
          {text('footer', 'Invoice footer')}
        </div>
      </section>

      {tpl && (
        <section className="section" style={{ maxWidth: 980 }}>
          <div className="section-head">
            <h5>Agreement template</h5>
            {lead && <button className="btn btn-secondary" disabled={body === tpl.body} onClick={() => saveTemplate(tpl.id, body)}><FloppyDisk />{body === tpl.body ? 'Saved' : 'Save template'}</button>}
          </div>
          <div className="meta">
            A starting draft. Have a lawyer review it before you rely on it. New agreements copy this text and fill in the deal’s details; agreements already created don’t change.
            Placeholders: {PLACEHOLDERS.map(p => '{{' + p + '}}').join(', ')}.
          </div>
          <textarea className="input" aria-label="Agreement template" value={body} disabled={!lead} onChange={e => setBody(e.target.value)}
            style={{ minHeight: 360, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6 }} />
        </section>
      )}
    </>
  );
}
