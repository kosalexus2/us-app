import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Bell, Check, X } from 'lucide-react';
import { post, useResource } from '../api';
import { Avatar, Sheet, useToast } from './ui';
import type { User } from './ui';
import { fmtDate } from '../util';
import { haptic } from '../tg';

type Proposal = {
  id: number; from: User | null; kind: 'new' | 'change';
  old_title: string | null; old_date: string | null; old_time: string | null;
  title: string; date: string; time: string | null; note: string | null;
};
type InboxData = { count: number; proposals: Proposal[] };

const when = (d: string, t: string | null) => `${fmtDate(d)}${t ? `, ${t}` : ''}`;

/** Колокольчик в шапке: предложения от пары и друзей, которые ждут вашего ответа. */
export function InboxButton() {
  const { data, reload } = useResource<InboxData>('/inbox', 10000);
  const [open, setOpen] = useState(false);
  const count = data?.count || 0;

  return (
    <>
      <button className="icon-btn bell" onClick={() => { haptic.tap(); setOpen(true); }} aria-label="Предложения">
        <Bell size={17} />
        {count > 0 && <span className="badge-dot">{count}</span>}
      </button>
      {open && createPortal(
        <InboxSheet data={data} reload={reload} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

function InboxSheet({ data, reload, onClose }: { data: InboxData | null; reload: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();

  const answer = async (p: Proposal, action: 'accept' | 'decline') => {
    setBusy(p.id);
    try {
      await post(`/proposals/${p.id}/${action}`);
      haptic.ok();
      toast(action === 'accept' ? 'Принято' : 'Отклонено');
      reload();
    } catch {
      toast('Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title="Предложения" onClose={onClose}>
      {!data || data.proposals.length === 0 ? (
        <p className="hint" style={{ margin: '14px 0 8px' }}>Пока ничего. Здесь появятся встречи, которые предложат вам пара или друзья.</p>
      ) : (
        <div className="stack" style={{ marginTop: 14 }}>
          {data.proposals.map((p) => (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar user={p.from || undefined} />
                <div className="grow" style={{ fontSize: 13, color: 'var(--label-2)' }}>
                  {p.from?.first_name || 'Кто-то'} {p.kind === 'change' ? 'предлагает замену' : 'предлагает встречу'}
                </div>
              </div>

              {p.kind === 'change' && p.old_title && (
                <div className="swap">
                  <div className="was">
                    <b>{p.old_title}</b>
                    <span>{when(p.old_date!, p.old_time)}</span>
                  </div>
                  <ArrowRight size={16} />
                </div>
              )}

              <h3 style={{ fontSize: 17, fontWeight: 700, marginTop: p.kind === 'change' ? 6 : 10 }}>{p.title}</h3>
              <div style={{ color: 'var(--label-2)', fontSize: 14, marginTop: 2 }}>{when(p.date, p.time)}</div>
              {p.note && <p style={{ marginTop: 8, fontSize: 14 }}>{p.note}</p>}

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="btn primary sm grow" disabled={busy === p.id} onClick={() => answer(p, 'accept')}>
                  <Check size={16} /> Принять
                </button>
                <button className="btn soft sm" disabled={busy === p.id} onClick={() => answer(p, 'decline')}>
                  <X size={16} /> Нет
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
