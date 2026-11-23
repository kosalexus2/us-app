import { useMemo, useState } from 'react';
import { Bell, Check, ChevronDown, ChevronRight, MapPin, Plus, Repeat as RepeatIcon, Settings as Cog, Trash2 } from 'lucide-react';
import { post } from '../api';
import { Sheet, Switch, useToast } from '../components/ui';
import SwipeRow from '../components/SwipeRow';
import { haptic } from '../tg';
import { fmtDate } from '../util';
import {
  COLORS, Project, Repeat, Task, completeTask, mutate, newTask, postpone, removeTask, saveTask, uid, useDoc,
} from '../store';

export const REMIND_OPTS: [number | null, string][] = [
  [null, 'Нет'], [0, 'В момент'], [15, 'За 15 мин'], [60, 'За час'], [180, 'За 3 часа'], [1440, 'За день'],
];
const KINDS: [Task['kind'], string][] = [['list', 'Список'], ['urgent', 'Срочная'], ['big', 'Большая']];
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const addDay = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

export const remindLabel = (m: number | null | undefined) => {
  if (m == null) return 'без напоминания';
  const f = REMIND_OPTS.find(([v]) => v === m);
  return f ? f[1].toLowerCase() : `за ${m} мин`;
};

/** Блок «Задачи» на экране «Личное»: проекты, срочные, большие и обычный список. */
export function TasksSection({ today, onEvent }: { today: string; onEvent: () => void }) {
  const { doc, ready } = useDoc();
  const toast = useToast();
  const [proj, setProj] = useState<string>('all');
  const [edit, setEdit] = useState<Task | null>(null);
  const [cfg, setCfg] = useState(false);
  const [newProj, setNewProj] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const pmap = useMemo(() => Object.fromEntries(doc.projects.map((p) => [p.id, p])), [doc.projects]);
  const list = doc.tasks.filter((t) => proj === 'all' || t.project === proj);
  const open = list.filter((t) => !t.done);
  const byDue = (a: Task, b: Task) => (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '').localeCompare(b.time || '');
  const groups: [string, Task[]][] = [
    ['Срочные', open.filter((t) => t.kind === 'urgent').sort(byDue)],
    ['Большие', open.filter((t) => t.kind === 'big').sort(byDue)],
    ['Список', open.filter((t) => t.kind === 'list').sort(byDue)],
  ];
  const done = list.filter((t) => t.done);

  const finish = (t: Task) => {
    haptic.ok();
    const next = completeTask(t.id, today);
    toast(t.done ? 'Вернул в работу' : next ? `Сделано. Следующий раз: ${fmtDate(next)}` : 'Готово');
  };
  const tomorrow = (t: Task) => {
    haptic.tap();
    postpone(t.id, addDay(t.due && t.due >= today ? t.due : today, 1));
    toast('Перенёс на завтра');
  };

  return (
    <>
      <div className="sec-head">
        <h2>Задачи</h2>
        <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button className="icon-btn" aria-label="Настройки напоминаний" onClick={() => setCfg(true)}><Cog size={18} /></button>
          <button className="link" onClick={() => setEdit(newTask({ due: today }))}>+ Задача</button>
        </span>
      </div>

      <div className="chips scroll-x">
        <button className={`chip ${proj === 'all' ? 'on' : ''}`} onClick={() => setProj('all')}>Все</button>
        {doc.projects.map((p) => (
          <button key={p.id} className={`chip ${proj === p.id ? 'on' : ''}`} onClick={() => setProj(p.id)}>
            <i className="pdot" style={{ background: p.color }} />{p.name}
          </button>
        ))}
        <button className="chip" onClick={() => setNewProj(true)} aria-label="Новый проект"><Plus size={14} /></button>
      </div>

      {!ready ? <div className="skeleton" style={{ height: 80, marginTop: 10 }} /> : open.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--label-2)', marginTop: 10 }}>
          Задач нет. Нажмите «+ Задача» или скажите помощнику: «задача сдать отчёт в пятницу в 15:00».
        </div>
      ) : (
        groups.filter(([, g]) => g.length).map(([name, g]) => (
          <div key={name}>
            <p className="eyebrow" style={{ marginTop: 14 }}>{name} · {g.length}</p>
            <div className="stack">
              {g.map((t) => (
                <SwipeRow key={t.id} right={{ label: 'Готово', tone: 'ok' }} left={{ label: 'На завтра', tone: 'accent' }} onRight={() => finish(t)} onLeft={() => tomorrow(t)}>
                  <TaskRow t={t} p={pmap[t.project]} today={today} onTick={() => finish(t)} onOpen={() => setEdit(t)} />
                </SwipeRow>
              ))}
            </div>
          </div>
        ))
      )}

      {done.length > 0 && (
        <>
          <button className="link" style={{ marginTop: 14, display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={() => setShowDone((v) => !v)}>
            {showDone ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Выполнено · {done.length}
          </button>
          {showDone && <div className="stack" style={{ marginTop: 8 }}>{done.map((t) => <TaskRow key={t.id} t={t} p={pmap[t.project]} today={today} onTick={() => finish(t)} onOpen={() => setEdit(t)} />)}</div>}
        </>
      )}

      {edit && <TaskSheet task={edit} isNew={!doc.tasks.some((x) => x.id === edit.id)} onClose={() => setEdit(null)} onEvent={() => { setEdit(null); onEvent(); }} />}
      {cfg && <SettingsSheet onClose={() => setCfg(false)} />}
      {newProj && <ProjectSheet onClose={() => setNewProj(false)} onDone={(id) => { setProj(id); setNewProj(false); }} />}
    </>
  );
}

export function TaskRow({ t, p, today, onTick, onOpen }: { t: Task; p?: Project; today: string; onTick: () => void; onOpen: () => void }) {
  const late = !t.done && t.due && t.due < today;
  const subDone = t.subs.filter((s) => s.d).length;
  return (
    <div className={`card task ${t.done ? 'is-done' : ''}`}>
      <button className={`tick ${t.done ? 'on' : ''}`} onClick={onTick} aria-label={t.done ? 'Вернуть' : 'Выполнить'}>{t.done && <Check size={14} />}</button>
      <button className="grow task-body" onClick={onOpen}>
        <b>{t.title}</b>
        <span className="sub">
          {p && <><i className="pdot" style={{ background: p.color }} />{p.name}</>}
          {t.due && <span className={late ? 'late' : ''}> · {t.due === today ? 'сегодня' : fmtDate(t.due)}{t.time ? `, ${t.time}` : ''}</span>}
          {t.place && <> · <MapPin size={11} style={{ verticalAlign: -1 }} /> {t.place}</>}
          {t.subs.length > 0 && <> · {subDone}/{t.subs.length}</>}
          {t.repeat && <> · <RepeatIcon size={11} style={{ verticalAlign: -1 }} /></>}
          {t.remind != null && t.due && <> · <Bell size={11} style={{ verticalAlign: -1 }} /></>}
        </span>
      </button>
    </div>
  );
}

export function TaskSheet({ task, isNew, onClose, onEvent }: { task: Task; isNew: boolean; onClose: () => void; onEvent?: () => void }) {
  const { doc } = useDoc();
  const toast = useToast();
  const [t, setT] = useState<Task>(task);
  const [custom, setCustom] = useState(false);
  const [sub, setSub] = useState('');
  const up = (p: Partial<Task>) => setT((x) => ({ ...x, ...p }));
  const preset = REMIND_OPTS.some(([v]) => v === (t.remind ?? null));
  const repType = !t.repeat ? 'none' : t.repeat.type === 'week' ? 'week' : t.repeat.every === 1 ? 'day' : 'n';
  const setRepeat = (r: Repeat | null) => up({ repeat: r });

  const save = () => {
    if (!t.title.trim()) return;
    saveTask({ ...t, title: t.title.trim(), subs: t.subs.filter((s) => s.t.trim()) });
    haptic.ok();
    toast(isNew ? 'Задача добавлена' : 'Сохранено');
    onClose();
  };
  const noDue = t.remind != null && !t.due;

  return (
    <Sheet title={isNew ? 'Новая задача' : 'Задача'} onClose={onClose}>
      {isNew && onEvent && (
        <div className="seg" style={{ marginTop: 10 }}>
          <button className="on">Задача</button>
          <button onClick={onEvent}>Событие</button>
        </div>
      )}
      <label className="label">Название</label>
      <input className="input" value={t.title} onChange={(e) => up({ title: e.target.value })} placeholder="Сдать отчёт" autoFocus={isNew} />

      <label className="label">Проект</label>
      <div className="chips">
        {doc.projects.map((p) => (
          <button key={p.id} className={`chip ${t.project === p.id ? 'on' : ''}`} onClick={() => up({ project: p.id })}><i className="pdot" style={{ background: p.color }} />{p.name}</button>
        ))}
      </div>

      <label className="label">Вид</label>
      <div className="seg">{KINDS.map(([k, l]) => <button key={k} className={t.kind === k ? 'on' : ''} onClick={() => up({ kind: k })}>{l}</button>)}</div>

      <div className="grid2">
        <div><label className="label">Срок</label><input className="input" type="date" value={t.due || ''} onChange={(e) => up({ due: e.target.value || undefined })} /></div>
        <div><label className="label">Время</label><input className="input" type="time" value={t.time || ''} onChange={(e) => up({ time: e.target.value || undefined })} /></div>
      </div>

      <label className="label">Место</label>
      <input className="input" value={t.place || ''} onChange={(e) => up({ place: e.target.value || undefined })} placeholder="Спортзал, офис, адрес" />

      <label className="label">Напомнить</label>
      <div className="chips">
        {REMIND_OPTS.map(([v, l]) => <button key={String(v)} className={`chip ${(t.remind ?? null) === v && !custom ? 'on' : ''}`} onClick={() => { setCustom(false); up({ remind: v }); }}>{l}</button>)}
        <button className={`chip ${custom || (!preset && t.remind != null) ? 'on' : ''}`} onClick={() => setCustom(true)}>Своё</button>
      </div>
      {(custom || (!preset && t.remind != null)) && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <input className="input" inputMode="numeric" placeholder="Минут до срока" value={t.remind ?? ''} onChange={(e) => up({ remind: e.target.value === '' ? null : Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
          <span className="hint" style={{ alignSelf: 'center' }}>минут до срока</span>
        </div>
      )}
      {noDue && <p className="hint" style={{ marginTop: 6 }}>Чтобы напоминание сработало, укажите срок.</p>}

      <label className="label">Повтор</label>
      <div className="chips">
        {([['none', 'Нет'], ['day', 'Каждый день'], ['week', 'По дням недели'], ['n', 'Раз в N дней']] as const).map(([k, l]) => (
          <button key={k} className={`chip ${repType === k ? 'on' : ''}`} onClick={() => setRepeat(k === 'none' ? null : k === 'day' ? { type: 'days', every: 1 } : k === 'week' ? { type: 'week', days: [] } : { type: 'days', every: 2 })}>{l}</button>
        ))}
      </div>
      {t.repeat?.type === 'week' && (
        <div className="chips" style={{ marginTop: 8 }}>
          {WD.map((d, i) => {
            const on = (t.repeat as { days: number[] }).days.includes(i);
            return <button key={d} className={`chip ${on ? 'on' : ''}`} onClick={() => setRepeat({ type: 'week', days: on ? (t.repeat as { days: number[] }).days.filter((x) => x !== i) : [...(t.repeat as { days: number[] }).days, i] })}>{d}</button>;
          })}
        </div>
      )}
      {repType === 'n' && t.repeat?.type === 'days' && (
        <div className="grid2" style={{ marginTop: 8 }}>
          <input className="input" inputMode="numeric" value={t.repeat.every} onChange={(e) => setRepeat({ type: 'days', every: Math.min(365, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)) })} />
          <span className="hint" style={{ alignSelf: 'center' }}>дней между повторами</span>
        </div>
      )}
      {t.repeat && !t.due && <p className="hint" style={{ marginTop: 6 }}>Для повтора нужна дата первого раза.</p>}

      {t.kind === 'big' && (
        <>
          <label className="label">Подзадачи</label>
          {t.subs.map((s, i) => (
            <div className="sub-row" key={i}>
              <button className={`tick ${s.d ? 'on' : ''}`} onClick={() => up({ subs: t.subs.map((x, j) => (j === i ? { ...x, d: !x.d } : x)) })}>{s.d && <Check size={14} />}</button>
              <input className="input" value={s.t} onChange={(e) => up({ subs: t.subs.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)) })} />
              <button className="icon-btn" aria-label="Убрать" onClick={() => up({ subs: t.subs.filter((_, j) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <div className="sub-row">
            <input className="input" value={sub} placeholder="Новый шаг" onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { up({ subs: [...t.subs, { t: sub.trim(), d: false }] }); setSub(''); } }} />
            <button className="btn soft sm" onClick={() => { if (sub.trim()) { up({ subs: [...t.subs, { t: sub.trim(), d: false }] }); setSub(''); } }}>Добавить</button>
          </div>
        </>
      )}

      <label className="label">Заметка</label>
      <input className="input" value={t.note || ''} onChange={(e) => up({ note: e.target.value || undefined })} placeholder="Необязательно" />

      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!t.title.trim()} onClick={save}>Сохранить</button>
      {!isNew && <button className="btn ghost danger block" onClick={() => { if (window.confirm('Удалить задачу?')) { removeTask(t.id); onClose(); } }}><Trash2 size={16} /> Удалить</button>}
    </Sheet>
  );
}

function ProjectSheet({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[1]);
  return (
    <Sheet title="Новый проект" onClose={onClose}>
      <label className="label">Название</label>
      <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Сайт клиента" maxLength={30} />
      <label className="label">Цвет</label>
      <div className="chips">{COLORS.map((c) => <button key={c} className={`chip ${color === c ? 'on' : ''}`} onClick={() => setColor(c)} aria-label={c}><i className="pdot" style={{ background: c, margin: 0 }} /></button>)}</div>
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!name.trim()} onClick={() => { const id = uid(); mutate((d) => { d.projects.push({ id, name: name.trim(), color }); }); onDone(id); }}>Создать</button>
    </Sheet>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { doc } = useDoc();
  const toast = useToast();
  const s = doc.settings;
  const set = (p: Partial<typeof s>) => mutate((d) => { d.settings = { ...d.settings, ...p }; });
  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <Sheet title="Напоминания" onClose={onClose}>
      <label className="label">Для новых задач по умолчанию</label>
      <div className="chips">{REMIND_OPTS.map(([v, l]) => <button key={String(v)} className={`chip ${s.remind === v ? 'on' : ''}`} onClick={() => set({ remind: v })}>{l}</button>)}</div>
      <label className="label">Если у задачи нет времени, напомнить утром в</label>
      <div className="chips">{[7, 8, 9, 10, 12].map((h) => <button key={h} className={`chip ${s.day_hour === h ? 'on' : ''}`} onClick={() => set({ day_hour: h })}>{h}:00</button>)}</div>
      <div className="switch-row"><div><b>Тихие часы</b><span className="sub">Напоминания не приходят ночью, а переносятся на утро</span></div><Switch on={!!s.quiet} onChange={(v) => set({ quiet: v ? [23, 8] : null })} /></div>
      {s.quiet && (
        <div className="grid2">
          <div><label className="label">С</label><select className="input" value={s.quiet[0]} onChange={(e) => set({ quiet: [Number(e.target.value), s.quiet![1]] })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select></div>
          <div><label className="label">До</label><select className="input" value={s.quiet[1]} onChange={(e) => set({ quiet: [s.quiet![0], Number(e.target.value)] })}>{hours.map((h) => <option key={h} value={h}>{h}:00</option>)}</select></div>
        </div>
      )}
      <button className="btn neutral block" style={{ marginTop: 18 }} onClick={async () => { await post('/reminders/test', {}); toast('Проверьте чат с ботом'); }}>Прислать пробное напоминание</button>
      <p className="hint" style={{ marginTop: 8 }}>Задачи хранятся в вашем Telegram, на сервер уходит только время и короткий текст напоминания.</p>
    </Sheet>
  );
}
