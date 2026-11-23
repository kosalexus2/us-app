import { useState } from 'react';
import { Cake, Check, Plus, Receipt, Trash2 } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Sheet, useToast } from './ui';
import { haptic } from '../tg';
import { fmtDate } from '../util';

type P = { id: number; name: string; first_name: string; photo_url: string | null };
const money = (c: number) => (c / 100).toFixed(2);

/** Отношения: оценка за 7 и 30 дней, график настроения, ближайшие юбилеи. */
export function RelationshipPanel() {
  const { data } = useResource<{
    days: { day: string; me: number | null; partner: number | null; avg: number | null }[];
    avg7: number | null; avg30: number | null; dates: number; has_partner?: boolean;
    anniversaries: { label: string; in_days: number }[];
  }>('/relationship', 30000);
  if (!data) return null;
  const last = data.days.slice(-30);
  const has = last.some((d) => d.avg != null);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 17, fontWeight: 600 }}>Температура отношений</h3>
      {has ? (
        <>
          <div className="rel-nums">
            <div><b>{data.avg7 ?? '—'}</b><span>за неделю</span></div>
            <div><b>{data.avg30 ?? '—'}</b><span>за 30 дней</span></div>
            <div><b>{data.dates}</b><span>мест вместе</span></div>
          </div>
          <div className="rel-bars" aria-label="Оценка по дням">
            {last.map((d) => (
              <i key={d.day} title={fmtDate(d.day)} style={{ height: d.avg ? 6 + (d.avg / 5) * 34 : 4, opacity: d.avg ? 1 : 0.25 }} />
            ))}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>Среднее двоих. Оценка партнёра видна после вашей.</p>
        </>
      ) : <p className="hint" style={{ marginTop: 6 }}>Отмечайте настроение каждый день: здесь появится тренд за неделю и месяц.</p>}
      {data.anniversaries.map((a) => (
        <div className="rel-ann" key={a.label}><span>🎉 {a.label}</span><b>{a.in_days === 0 ? 'сегодня' : `через ${a.in_days} дн.`}</b></div>
      ))}
    </div>
  );
}

/** Личное: привычки с серией дней. */
export function Habits() {
  const { data, reload } = useResource<{ id: number; title: string; icon: string | null; streak: number; done: boolean }[]>('/habits', 20000);
  const [add, setAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('💧');
  const toggle = async (id: number) => { haptic.ok(); await post(`/habits/${id}/toggle`, {}); reload(); };
  const save = async () => { if (!title.trim()) return; await post('/habits', { title, icon }); setTitle(''); setAdd(false); reload(); };
  return (
    <>
      <div className="sec-head"><h2>Привычки</h2><button className="link" onClick={() => setAdd(true)}>+ Новая</button></div>
      {data && data.length > 0 ? (
        <div className="habits">
          {data.map((h) => (
            <button key={h.id} className={`habit ${h.done ? 'on' : ''}`} onClick={() => toggle(h.id)} onContextMenu={async (e) => { e.preventDefault(); if (window.confirm(`Удалить привычку «${h.title}»?`)) { await del(`/habits/${h.id}`); reload(); } }}>
              <span className="hi">{h.done ? <Check size={18} /> : h.icon || '•'}</span>
              <b>{h.title}</b>
              <span>{h.streak ? `${h.streak} дн. подряд` : 'начать'}</span>
            </button>
          ))}
        </div>
      ) : <div className="card" style={{ textAlign: 'center', color: 'var(--label-2)' }}>Добавьте привычку: вода, чтение, сон. Нажатие отмечает день, долгое нажатие удаляет.</div>}
      {add && (
        <Sheet title="Новая привычка" onClose={() => setAdd(false)}>
          <label className="label">Название</label>
          <input className="input" value={title} maxLength={40} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="Выпить воды" />
          <label className="label">Значок</label>
          <div className="chips">{['💧', '📖', '🧘', '🏃', '😴', '🥗', '💊', '✍️'].map((e) => <button key={e} className={`chip ${icon === e ? 'on' : ''}`} onClick={() => setIcon(e)}>{e}</button>)}</div>
          <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title.trim()} onClick={save}>Добавить</button>
        </Sheet>
      )}
    </>
  );
}

/** Друзья: давно не виделись, дни рождения, вход в общие расходы. */
export function FriendsExtra({ onMeet }: { onMeet: () => void }) {
  const { data } = useResource<{ lost: (P & { days: number; met: boolean })[]; birthdays: (P & { date: string; in_days: number })[] }>('/friends/extra', 60000);
  const { data: ex } = useResource<{ owed_to_me: number; i_owe: number }>('/expenses', 15000);
  const [open, setOpen] = useState(false);
  return (
    <>
      {data && data.lost.length > 0 && (
        <>
          <div className="sec-head"><h2>Давно не виделись</h2></div>
          <div className="stack">
            {data.lost.map((u) => (
              <div className="card meet" key={u.id}>
                <Avatar user={u} />
                <span className="grow"><b>{u.first_name}</b><span className="sub">{u.met ? `${u.days} дн. без встречи` : 'ещё не встречались в приложении'}</span></span>
                <button className="btn soft sm" onClick={onMeet}>Найти время</button>
              </div>
            ))}
          </div>
        </>
      )}
      {data && data.birthdays.length > 0 && (
        <>
          <div className="sec-head"><h2>Дни рождения</h2></div>
          <div className="stack">
            {data.birthdays.map((u) => (
              <div className="card meet" key={u.id}>
                <span className="round-ic"><Cake size={18} /></span>
                <span className="grow"><b>{u.first_name}</b><span className="sub">{fmtDate(u.date)}</span></span>
                <span className="badge">{u.in_days === 0 ? 'сегодня' : `через ${u.in_days} дн.`}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="sec-head"><h2>Общие расходы</h2></div>
      <button className="card meet" onClick={() => setOpen(true)}>
        <span className="round-ic"><Receipt size={18} /></span>
        <span className="grow"><b>Кто кому должен</b>
          <span className="sub">{ex && (ex.owed_to_me || ex.i_owe) ? `Вам должны ${money(ex.owed_to_me)} · вы должны ${money(ex.i_owe)}` : 'Делите чеки с друзьями и партнёром'}</span></span>
      </button>
      {open && <ExpensesSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ExpensesSheet({ onClose }: { onClose: () => void }) {
  const { boot } = useApp();
  const toast = useToast();
  type Ex = { owed_to_me: number; i_owe: number; people: (P & { amount: number })[]; recent: { id: number; title: string; amount: number; day: string; paid_by: P; mine: boolean }[] };
  const { data, reload } = useResource<Ex>('/expenses', 8000);
  const { data: fr } = useResource<{ friends: P[] }>('/friends/status', 60000);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<number>(boot.me.id);
  const [split, setSplit] = useState<number[]>([]);
  const people: P[] = [...(boot.partner ? [boot.partner as unknown as P] : []), ...(fr?.friends ?? [])];
  const save = async () => {
    try {
      await post('/expenses', { title, amount: Number(amount.replace(',', '.')), paid_by: payer, split });
      haptic.ok(); toast('Расход добавлен'); setAdding(false); setTitle(''); setAmount(''); setSplit([]); reload();
    } catch { toast('Проверьте сумму и участников'); }
  };
  const toggle = (id: number) => setSplit((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet title="Общие расходы" onClose={onClose}>
      {data && (
        <div className="rel-nums">
          <div><b className="pos">+{money(data.owed_to_me)}</b><span>вам должны</span></div>
          <div><b className="neg">−{money(data.i_owe)}</b><span>вы должны</span></div>
        </div>
      )}
      {data?.people.map((p) => (
        <div className="card meet" key={p.id} style={{ marginTop: 10 }}>
          <Avatar user={p} />
          <span className="grow"><b>{p.first_name}</b><span className="sub">{p.amount > 0 ? `должен(на) вам ${money(p.amount)}` : `вы должны ${money(-p.amount)}`}</span></span>
          {p.amount > 0 && <button className="btn ghost sm" onClick={async () => { await post('/expenses/remind', { user_id: p.id }); toast('Напомнил'); }}>Напомнить</button>}
          <button className="btn soft sm" onClick={async () => { await post('/expenses/settle', { user_id: p.id }); toast('Рассчитались'); reload(); }}>Рассчитались</button>
        </div>
      ))}
      {!adding ? (
        <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><Plus size={18} /> Добавить расход</button>
      ) : (
        <div style={{ marginTop: 12 }}>
          <label className="label">Что оплатили</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ужин в кафе" />
          <label className="label">Сумма</label>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="84.00" />
          <label className="label">Кто платил</label>
          <div className="chips">
            {[boot.me as unknown as P, ...people].map((p) => <button key={p.id} className={`chip ${payer === p.id ? 'on' : ''}`} onClick={() => setPayer(p.id)}>{p.id === boot.me.id ? 'Я' : p.first_name}</button>)}
          </div>
          <label className="label">Делим с (поровну, вы входите всегда)</label>
          <div className="chips">
            {people.map((p) => <button key={p.id} className={`chip ${split.includes(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}>{p.first_name}</button>)}
          </div>
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={!title.trim() || !(Number(amount.replace(',', '.')) > 0) || !split.length} onClick={save}>Сохранить</button>
        </div>
      )}
      {data && data.recent.length > 0 && (
        <>
          <p className="eyebrow">Последние</p>
          {data.recent.map((e) => (
            <div className="row-it" key={e.id} style={{ padding: '8px 0' }}>
              <span className="grow"><b>{e.title}</b><span className="sub">{fmtDate(e.day)} · платил(а) {e.paid_by?.first_name}</span></span>
              <b>{money(e.amount)}</b>
              {e.mine && <button className="icon-btn" aria-label="Удалить" onClick={async () => { await del(`/expenses/${e.id}`); reload(); }}><Trash2 size={15} /></button>}
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}

/** Ещё: день рождения и копия данных в чат. */
export function Safety() {
  const toast = useToast();
  const { data, reload } = useResource<{ my_birthday: string | null }>('/friends/extra', 120000);
  const [busy, setBusy] = useState(false);
  const bd = data?.my_birthday ? `2000-${data.my_birthday}` : '';
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 17, fontWeight: 600 }}>Данные и дата рождения</h3>
      <label className="label">Мой день рождения</label>
      <input className="input" type="date" value={bd} onChange={async (e) => { await patch('/me/birthday', { birthday: e.target.value }); reload(); toast('Сохранено'); }} />
      <p className="hint" style={{ marginTop: 6 }}>Друзья получат напоминание за неделю и в сам день.</p>
      <button className="btn neutral block" style={{ marginTop: 14 }} disabled={busy} onClick={async () => { setBusy(true); await post('/backup/send', {}); setBusy(false); toast('Копия отправлена вам в чат с ботом'); }}>Прислать копию данных в Telegram</button>
      <p className="hint" style={{ marginTop: 6 }}>Бот сам присылает такую копию каждое воскресенье. Файл остаётся у вас в Telegram.</p>
    </div>
  );
}
