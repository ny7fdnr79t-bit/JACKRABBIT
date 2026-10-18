'use client';

import { useRef, useState } from 'react';
import { Plus, Siren } from '@phosphor-icons/react';
import { useCrm, useLookups } from '@/lib/store';
import { costed, initials, k, marginColor, marginOf, PROTECTED_STAGES, STAGE_MARK, sum, svcLabel } from '@/lib/crm';
import { Loading } from '@/components/ui';
import { useOpenJob } from '@/lib/useOpenJob';

export default function Pipeline() {
  const { ready, jobs, settings, updateJob, setNewDeal } = useCrm();
  const { ownerName, serviceNames } = useLookups();
  const openJob = useOpenJob();
  const [hot, setHot] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const open = jobs.filter(j => !PROTECTED_STAGES.includes(j.stage));
  const stages = settings.showLost ? settings.stages : settings.stages.filter(s => s !== 'Lost');

  const drop = (stage: string) => {
    const id = dragId.current;
    dragId.current = null;
    setHot(null);
    setDragging(null);
    const j = jobs.find(x => x.id === id);
    if (j && j.stage !== stage) updateJob(j.id, { stage });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div><div className="meta">{open.length} open deals · {k(sum(open, j => j.value))}</div><h3>Pipeline</h3></div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <span className="meta">Drag cards between stages</span>
          <button className="btn btn-primary" onClick={() => setNewDeal(true)}><Plus />New deal</button>
        </div>
      </header>
      {!ready ? <Loading /> : (
        <div className="board">
          {stages.map(st => {
            const items = jobs.filter(j => j.stage === st);
            return (
              <div key={st} className={'col' + (hot === st ? ' hot' : '')}
                onDragOver={e => e.preventDefault()}
                onDragEnter={() => hot !== st && setHot(st)}
                onDrop={e => { e.preventDefault(); drop(st); }}>
                <div className="col-head">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{st}</span><span className="meta">{items.length}</span>
                  </div>
                  <span className="num" style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{k(sum(items, j => j.value))}</span>
                </div>
                <div className="col-mark" style={{ background: STAGE_MARK[st] || 'var(--color-neutral-600)' }} />
                {items.map(j => {
                  const owner = ownerName(j.ownerId);
                  return (
                    <div key={j.id} className={'card elev-sm deal' + (dragging === j.id ? ' dragging' : '')} draggable role="button" tabIndex={0}
                      onDragStart={e => { dragId.current = j.id; setDragging(j.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', j.id); }}
                      onDragEnd={() => { setHot(null); setDragging(null); }}
                      onClick={() => openJob(j.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openJob(j.id); } }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                        <div className="kicker">{svcLabel(serviceNames(j))}</div>
                        {j.emergency && <span className="tag tag-outline tag-sm"><Siren />24/7</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{j.client}</div>
                      <div style={{ fontSize: 13, color: 'var(--color-neutral-400)', lineHeight: 1.35 }}>{j.title}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                        <span className="num" style={{ fontSize: 15 }}>{k(j.value)}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: marginColor(j, settings.marginTarget) }}>{costed(j) ? marginOf(j) + '% margin' : 'Not costed'}</span>
                          <span className="avatar-sm" title={owner}>{initials(owner)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
