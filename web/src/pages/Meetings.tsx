import { useState } from 'react';
import { CalendarPlus, Check, MapPin, Plus, Trash2, X } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Sheet, useToast } from '../components/ui';
import { fmtDate } from '../util';
import { haptic } from '../tg';
import type { FriendsStatus, Meeting, Rsvp } from '../types';

export const RSVP_LABEL: Record<Rsvp, string> = { yes: 'Иду', maybe: 'Может быть', no: 'Не иду' };
const VOTE_LABEL: Record<Rsvp, string> = { yes: 'подходит', maybe: 'могу', no: 'нет' };
const NEXT: Record<string, Rsvp | null> = { '': 'yes', yes: 'maybe', maybe: 'no', no: null };

const mapUrl = (place: string) => `https://yandex.by/maps/?text=${encodeURIComponent(place)}`;
const gcal = (m: Meeting) => {
  if (!m.date) return '';
  const d = m.date.replace(/-/g, '');
  const t = (m.time || '12:00').replace(':', '');
  const end = (m.time ? `${String((Number(m.time.slice(0, 2)) + 2) % 24).padStart(2, '0')}${m.time.slice(3)}` : '1400');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(m.title)}&dates=${d}T${t}00/${d}T${end}00&location=${encodeURIComponent(m.place || '')}`;
};

/** Создание встречи: точная дата или опрос из нескольких дат. */
export function NewMeetingSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { data: fr } = useResource<FriendsStatus>('/friends/status', 60000);
  const { boot } = useApp();
  const [mode, setMode] = useState<'date' | 'poll'>('date');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [opts, setOpts] = useState<{ date: string; time: string }[]>([{ date: '', time: '' }, { date: '', time: '' }]);
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [who, setWho] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const people = [...(boot.partner ? [{ id: boot.partner.id, first_name: boot.partner.first_name, photo_url: boot.partner.photo_url }] : []), ...(fr?.friends ?? [])];
  const ready = title.trim() && (mode === 'date' ? !!date : opts.filter((o) => o.date).length >= 2);
  const setOpt = (i: number, k: 'date' | 'time', v: string) => setOpts((a) => a.map((o, j) => (j === i ? { ...o, [k]: v } : o)));

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await post('/meetings', {
        title, place, note, invitees: who,
        ...(mode === 'date' ? { date, time } : { options: opts.filter((o) => o.date) }),
      });
      haptic.ok();
      toast(who.length ? 'Встреча создана, приглашения отправлены' : 'Встреча создана');
      onSaved();
    } catch {
      toast('Не получилось, проверьте дату');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Новая встреча" onClose={onClose}>
      <label className="label">Название</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Шашлыки на озере" autoFocus />

      <div className="seg" style={{ marginTop: 14 }}>
        <button className={mode === 'date' ? 'on' : ''} onClick={() => setMode('date')}>Точная дата</button>
        <button className={mode === 'poll' ? 'on' : ''} onClick={() => setMode('poll')}>Опрос дат</button>
      </div>

      {mode === 'date' ? (
        <div className="grid2">
          <div><label className="label">Дата</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="label">Время</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
      ) : (
        <>
          {opts.map((o, i) => (
            <div className="grid2" key={i}>
              <div><label className="label">Вариант {i + 1}</label><input className="input" type="date" value={o.date} onChange={(e) => setOpt(i, 'date', e.target.value)} /></div>
              <div><label className="label">Время</label><input className="input" type="time" value={o.time} onChange={(e) => setOpt(i, 'time', e.target.value)} /></div>
            </div>
          ))}
          {opts.length < 5 && (
            <button className="btn soft sm" style={{ marginTop: 10 }} onClick={() => setOpts((a) => [...a, { date: '', time: '' }])}><Plus size={15} /> Ещё дата</button>
          )}
        </>
      )}

      <label className="label">Место</label>
      <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Название или адрес" />

      <label className="label">Кого зовём</label>
      {people.length ? (
        <div className="chips">
          {people.map((p) => {
            const on = who.includes(p.id);
            return (
              <button key={p.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setWho((w) => (on ? w.filter((x) => x !== p.id) : [...w, p.id]))}>
                {on && <Check size={13} style={{ marginRight: 4, verticalAlign: -2 }} />}{p.first_name}
              </button>
            );
          })}
        </div>
      ) : <p className="hint">Сначала добавьте друзей кнопкой в верхней панели.</p>}

      <label className="label">Заметка</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что взять, как добраться (необязательно)" />
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!ready || busy} onClick={save}>Создать и отправить</button>
    </Sheet>
  );
}

/** Экран встречи: ответы, опрос дат, правки для автора. */
export function MeetingSheet({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { data: m, reload, setData } = useResource<Meeting>(`/meetings/${id}`, 5000);
  const { boot } = useApp();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: '', date: '', time: '', place: '' });

  if (!m) return <Sheet onClose={onClose}><div className="skeleton" style={{ height: 160 }} /></Sheet>;
  const meId = boot.me.id;

  const rsvp = async (r: Rsvp) => {
    haptic.tap();
    try { setData(await post(`/meetings/${id}/rsvp`, { rsvp: r })); onChanged(); } catch { toast('Не получилось'); }
  };
  const vote = async (optId: number, cur: Rsvp | undefined) => {
    haptic.tap();
    try { setData(await post(`/meetings/${id}/vote`, { option_id: optId, vote: NEXT[cur ?? '']  })); } catch { toast('Не получилось'); }
  };
  const best = [...m.options].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))[0];
  const finalize = async (optId: number) => {
    try { setData(await post(`/meetings/${id}/finalize`, { option_id: optId })); onChanged(); toast('Дата назначена, всем отправлено'); } catch { toast('Не получилось'); }
  };
  const save = async () => {
    try { setData(await patch(`/meetings/${id}`, f)); setEdit(false); onChanged(); toast('Сохранено, участникам отправлено'); } catch { toast('Проверьте дату'); }
  };
  const remove = async () => {
    if (!window.confirm(m.mine ? 'Отменить встречу для всех?' : 'Выйти из встречи?')) return;
    await del(`/meetings/${id}`); onChanged(); onClose();
  };

  return (
    <Sheet title={m.title} onClose={onClose}>
      <div className="mt-info">
        <div><b>{m.date ? `${fmtDate(m.date)}${m.time ? `, ${m.time}` : ''}` : 'Дата пока не выбрана'}</b></div>
        {m.place && <a className="mt-place" href={mapUrl(m.place)} target="_blank" rel="noreferrer"><MapPin size={15} /> {m.place} · Маршрут</a>}
        {m.note && <p className="hint" style={{ marginTop: 6 }}>{m.note}</p>}
      </div>

      {m.status === 'set' ? (
        <>
          <div className="rsvp-row">
            {(['yes', 'maybe', 'no'] as Rsvp[]).map((r) => (
              <button key={r} className={`rsvp ${r} ${m.my_rsvp === r ? 'on' : ''}`} onClick={() => rsvp(r)}>{RSVP_LABEL[r]}</button>
            ))}
          </div>
          <p className="mt-count"><b>{m.counts.yes}</b> идут · <b>{m.counts.maybe}</b> может быть · <b>{m.counts.no}</b> не идут</p>
        </>
      ) : (
        <>
          <p className="eyebrow">Когда удобно? Нажимайте на ячейку: подходит, могу, нет.</p>
          <div className="poll">
            <div className="poll-head" style={{ ["--n" as any]: m.options.length }}>
              <span />
              {m.options.map((o) => <span key={o.id}>{fmtDate(o.date)}{o.time ? <><br />{o.time}</> : null}</span>)}
            </div>
            {m.members.map((u) => (
              <div className="poll-row" key={u.id} style={{ ["--n" as any]: m.options.length }}>
                <span className="who"><Avatar user={u} /> {u.first_name}</span>
                {m.options.map((o) => {
                  const v = o.votes[u.id];
                  const mine = u.id === meId;
                  return <button key={o.id} disabled={!mine} className={`cell ${v || ''} ${mine ? 'mine' : ''}`} onClick={() => vote(o.id, v)} aria-label={v ? VOTE_LABEL[v] : 'не голосовал'} />;
                })}
              </div>
            ))}
          </div>
          {best && best.score > 0 && (
            <div className="card best">
              <div className="eyebrow" style={{ margin: 0 }}>Лучшая дата</div>
              <b>{fmtDate(best.date)}{best.time ? `, ${best.time}` : ''}</b>
              <span className="sub"> · подходит {best.yes}, могут {best.maybe}</span>
              {m.mine && <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => finalize(best.id)}>Назначить эту дату</button>}
            </div>
          )}
          {m.mine && m.options.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              {m.options.map((o) => <button key={o.id} className="chip" onClick={() => finalize(o.id)}>Назначить {fmtDate(o.date)}</button>)}
            </div>
          )}
        </>
      )}

      <p className="eyebrow">Участники</p>
      <div className="mt-people">
        {m.members.map((u) => (
          <div className="mt-p" key={u.id}>
            <Avatar user={u} />
            <span>{u.first_name}</span>
            <span className={`dotr ${u.rsvp || ''}`}>{u.rsvp ? RSVP_LABEL[u.rsvp] : 'ждём'}</span>
          </div>
        ))}
      </div>

      {m.status === 'set' && m.date && (
        <a className="btn neutral block" style={{ marginTop: 16 }} href={gcal(m)} target="_blank" rel="noreferrer"><CalendarPlus size={18} /> В календарь телефона</a>
      )}

      {m.mine && !edit && m.status === 'set' && (
        <button className="btn ghost block" onClick={() => { setF({ title: m.title, date: m.date || '', time: m.time || '', place: m.place || '' }); setEdit(true); }}>Изменить время и место</button>
      )}
      {edit && (
        <div style={{ marginTop: 8 }}>
          <label className="label">Название</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <div className="grid2">
            <div><label className="label">Дата</label><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <div><label className="label">Время</label><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
          </div>
          <label className="label">Место</label><input className="input" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
          <div className="grid2" style={{ marginTop: 16 }}>
            <button className="btn neutral" onClick={() => setEdit(false)}>Отмена</button>
            <button className="btn primary" onClick={save}>Сохранить</button>
          </div>
        </div>
      )}
      <button className="btn ghost danger block" onClick={remove}>{m.mine ? <><Trash2 size={16} /> Отменить встречу</> : <><X size={16} /> Выйти из встречи</>}</button>
    </Sheet>
  );
}
