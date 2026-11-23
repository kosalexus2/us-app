import { useEffect, useRef, useState } from 'react';
import { BookHeart, CalendarCheck, ChevronLeft, ChevronRight, Gift, Plus } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Sheet, Skeletons, Switch, useToast } from '../components/ui';
import SwipeRow from '../components/SwipeRow';
import { haptic } from '../tg';
import { fmtDate } from '../util';
import type { CalItem, CalMonth } from '../types';
import { RSVP_LABEL } from './Meetings';
import { Habits } from '../components/Extras';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const addDay = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const shiftMonth = (mo: string, n: number) => {
  const [y, m] = mo.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function Me() {
  const { boot, go, openMeeting } = useApp();
  const toast = useToast();
  const [month, setMonth] = useState(boot.today.slice(0, 7));
  const [sel, setSel] = useState(boot.today);
  const [sheet, setSheet] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ key: string; run: () => void } | null>(null);
  const timer = useRef<number>();
  const { data, reload } = useResource<CalMonth>(`/calendar?month=${month}`, 8000);
  const touch = useRef({ x: 0, y: 0 });

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const byDay: Record<string, CalItem[]> = {};
  for (const it of data?.items ?? []) (byDay[it.date] ||= []).push(it);
  const key = (it: CalItem) => `${it.src}${it.id}`;
  const list = (byDay[sel] ?? []).filter((it) => !hidden.includes(key(it)));

  const done = async (it: CalItem) => { haptic.ok(); await patch(`/chores/${it.id}`, { done: it.done ? 0 : 1 }); toast(it.done ? 'Вернул в дела' : 'Готово'); reload(); };
  const tomorrow = async (it: CalItem) => {
    haptic.tap();
    const d = addDay(it.date, 1);
    if (it.src === 'chore') await patch(`/chores/${it.id}`, { due_date: d });
    else await patch(`/cal/${it.id}`, { date: d });
    toast('Перенёс на завтра');
    reload();
  };
  // удаление с отменой на 5 секунд: пока ждём, запись просто скрыта
  const remove = (it: CalItem) => {
    const k = key(it);
    window.clearTimeout(timer.current);
    setHidden((h) => [...h, k]);
    const run = async () => { await del(it.src === 'chore' ? `/chores/${it.id}` : `/cal/${it.id}`); setHidden((h) => h.filter((x) => x !== k)); setUndo(null); reload(); };
    setUndo({ key: k, run });
    timer.current = window.setTimeout(run, 5000);
  };
  const cancelUndo = () => {
    window.clearTimeout(timer.current);
    if (undo) setHidden((h) => h.filter((x) => x !== undo.key));
    setUndo(null);
  };

  const onTouchStart = (e: React.PointerEvent) => { touch.current = { x: e.clientX, y: e.clientY }; };
  const onTouchEnd = (e: React.PointerEvent) => {
    const dx = e.clientX - touch.current.x, dy = e.clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { haptic.tap(); setMonth(shiftMonth(month, dx < 0 ? 1 : -1)); }
  };

  return (
    <div className="scroll">
      <h1 className="h-title">Личное</h1>
      <p className="sub">Календарь, задачи и встречи в одном месте</p>

      <div className="tiles">
        <button className="tile" onClick={() => go('memory', 'diary')}><BookHeart size={20} /> Дневник</button>
        <button className="tile" onClick={() => go('memory', 'wishlist')}><Gift size={20} /> Вишлист</button>
        <button className="tile" onClick={() => go('home', 'chores')}><CalendarCheck size={20} /> Дела</button>
      </div>

      <Habits />

      <div className="card cal" onPointerDown={onTouchStart} onPointerUp={onTouchEnd}>
        <div className="cal-head">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Прошлый месяц"><ChevronLeft size={18} /></button>
          <b>{MONTHS[m - 1]} {y}</b>
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Следующий месяц"><ChevronRight size={18} /></button>
        </div>
        <div className="cal-grid wd">{WD.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            if (!d) return <span key={i} />;
            const k = iso(y, m, d);
            const items = byDay[k] ?? [];
            return (
              <button key={i} className={`day ${k === sel ? 'sel' : ''} ${k === (data?.today ?? boot.today) ? 'today' : ''}`} onClick={() => { haptic.tap(); setSel(k); }}>
                {d}
                <i className="dots">{items.slice(0, 3).map((it, j) => <b key={j} className={it.src} />)}</i>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sec-head">
        <h2>{fmtDate(sel)}</h2>
        <button className="link" onClick={() => setSheet(true)}>+ Добавить</button>
      </div>
      {!data ? <Skeletons n={2} /> : list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--label-2)' }}>На этот день ничего нет</div>
      ) : (
        <>
          <p className="hint" style={{ margin: '0 0 8px' }}>Свайп вправо: готово или перенести, влево: удалить</p>
          <div className="stack">
            {list.map((it) => {
              const swipeable = it.src === 'chore' || it.src === 'cal';
              return (
                <SwipeRow
                  key={key(it)} disabled={!swipeable}
                  right={it.src === 'chore' ? { label: it.done ? 'Вернуть' : 'Готово', tone: 'ok' } : { label: 'На завтра', tone: 'accent' }}
                  left={it.src === 'chore' ? { label: 'На завтра', tone: 'accent' } : { label: 'Удалить', tone: 'danger' }}
                  onRight={() => (it.src === 'chore' ? done(it) : tomorrow(it))}
                  onLeft={() => (it.src === 'chore' ? tomorrow(it) : remove(it))}
                >
                  <div className={`card row-it ${it.done ? 'is-done' : ''}`} onClick={() => it.src === 'meeting' && openMeeting(it.id)}>
                    <span className={`src-dot ${it.src}`} />
                    <span className="grow">
                      <b>{it.title}</b>
                      <span className="sub">{it.time || 'весь день'}{it.src === 'meeting' ? ` · встреча${it.rsvp ? `, ${RSVP_LABEL[it.rsvp].toLowerCase()}` : ''}` : it.src === 'chore' ? ' · задача' : it.src === 'event' ? ' · событие пары' : ''}</span>
                    </span>
                  </div>
                </SwipeRow>
              );
            })}
          </div>
        </>
      )}

      {undo && (
        <div className="undo-bar">
          <span>Удалено</span>
          <button onClick={cancelUndo}>Отменить</button>
        </div>
      )}
      <button className="fab-add" onClick={() => setSheet(true)} aria-label="Добавить"><Plus size={22} /></button>
      {sheet && <NewItemSheet day={sel} onClose={() => setSheet(false)} onSaved={() => { setSheet(false); reload(); }} />}
    </div>
  );
}

function NewItemSheet({ day, onClose, onSaved }: { day: string; onClose: () => void; onSaved: () => void }) {
  const { boot } = useApp();
  const toast = useToast();
  const [kind, setKind] = useState<'task' | 'event'>('task');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(day);
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState(0);
  const [remind, setRemind] = useState<string>('');
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      if (kind === 'task') await post('/chores', { title, due_date: date || null, repeat_days: repeat || null, remind_rule: remind || null });
      else await post('/cal', { owner_id: boot.me.id, title, date, time: time || null, remind_min: remind === '' ? null : Number(remind), private: priv });
      haptic.ok();
      toast('Добавлено');
      onSaved();
    } catch { toast('Проверьте дату'); setBusy(false); }
  };
  const chip = (v: string, label: string, cur: string, set: (x: string) => void) => (
    <button key={v} className={`chip ${cur === v ? 'on' : ''}`} onClick={() => set(v)}>{label}</button>
  );

  return (
    <Sheet title="Добавить" onClose={onClose}>
      <div className="seg" style={{ marginTop: 10 }}>
        <button className={kind === 'task' ? 'on' : ''} onClick={() => { setKind('task'); setRemind(''); }}>Задача</button>
        <button className={kind === 'event' ? 'on' : ''} onClick={() => { setKind('event'); setRemind(''); }}>Событие</button>
      </div>
      <label className="label">Название</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'task' ? 'Купить билеты' : 'Поход в зал'} autoFocus />
      <div className="grid2">
        <div><label className="label">Дата</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {kind === 'event' && <div><label className="label">Время</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>}
      </div>
      {kind === 'task' && (
        <>
          <label className="label">Повтор</label>
          <div className="chips">{[[0, 'не повторять'], [1, 'каждый день'], [7, 'каждую неделю']].map(([v, l]) => <button key={v} className={`chip ${repeat === v ? 'on' : ''}`} onClick={() => setRepeat(v as number)}>{l}</button>)}</div>
        </>
      )}
      <label className="label">Напомнить</label>
      <div className="chips">
        {kind === 'task'
          ? [['', 'не надо'], ['morning', 'утром в день'], ['day_before', 'за день']].map(([v, l]) => chip(v, l, remind, setRemind))
          : [['', 'не надо'], ['0', 'в момент'], ['15', 'за 15 минут'], ['60', 'за час'], ['1440', 'за день']].map(([v, l]) => chip(v, l, remind, setRemind))}
      </div>
      {kind === 'event' && <div className="switch-row"><div><b>Только для меня</b></div><Switch on={priv} onChange={setPriv} /></div>}
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title.trim() || busy} onClick={save}>Сохранить</button>
    </Sheet>
  );
}
