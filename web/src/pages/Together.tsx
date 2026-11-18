import { useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Dices, EyeOff, MapPin, Plane, Plus, Search, Star, Trash2, Heart, RotateCw } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { useApp } from '../ctx';
import { EditSheet, RowActions } from '../components/Editable';
import { Empty, Segmented, Sheet, Skeletons, Switch, useToast } from '../components/ui';
import type { EventT, Place } from '../types';
import { fmtDate } from '../util';
import { haptic } from '../tg';

type Sub = 'places' | 'dates' | 'trips' | 'calendar';

export default function Together({ sub }: { sub?: string }) {
  const [tab, setTab] = useState<Sub>((sub as Sub) || 'places');
  useEffect(() => { if (sub) setTab(sub as Sub); }, [sub]);
  return (
    <div className="scroll">
      <h1 className="h-title">Вместе</h1>
      <p className="sub">Общие планы, вдохновение и места</p>
      <Segmented<Sub>
        value={tab}
        onChange={setTab}
        options={[['places', 'Места'], ['dates', 'Свидания'], ['trips', 'Поездки'], ['calendar', 'Календарь']]}
      />
      {tab === 'places' && <Places />}
      {tab === 'dates' && <Dates />}
      {tab === 'trips' && <Events only="trip" />}
      {tab === 'calendar' && <Events />}
    </div>
  );
}

// ---------------------------------------------------------------- places
function Places() {
  const { data, reload } = useResource<Place[]>('/places', 5000);
  const [q, setQ] = useState('');
  const [randomPick, setRandomPick] = useState<Place | null>(null);
  const [visitFor, setVisitFor] = useState<Place | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const want = useMemo(() => (data || []).filter((p) => p.status === 'want' && p.title.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const wantAll = (data || []).filter((p) => p.status === 'want');

  const roll = () => {
    if (!wantAll.length) return toast('Сначала добавьте хотя бы одно место');
    haptic.tap();
    setRandomPick(wantAll[Math.floor(Math.random() * wantAll.length)]);
  };

  return (
    <>
      <div className="tiles">
        <button className="tile dark" onClick={roll}>
          <Dices size={26} />
          <div><h3>Случайное место</h3><p>Где провести вечер вдвоём</p></div>
        </button>
        <button className="tile" onClick={() => toast('Свидание вслепую — в следующей версии')}>
          <span className="badge gray soon">скоро</span>
          <EyeOff size={26} color="var(--accent)" />
          <div><h3>Свидание вслепую</h3><p>Тайный сюрприз для двоих</p></div>
        </button>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <Search size={18} color="var(--label-2)" />
        <input placeholder="Поиск по местам…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="icon-btn" style={{ background: 'var(--accent)', color: '#fff' }} onClick={() => setAdding(true)} aria-label="Добавить место"><Plus size={18} /></button>
      </div>

      <div className="sec-head" style={{ marginTop: 22 }}>
        <h2>Хотим сходить <span className="badge gray" style={{ verticalAlign: 3 }}>{wantAll.length}</span></h2>
      </div>

      {!data ? <Skeletons n={2} /> : want.length ? (
        <div className="stack">
          {want.map((p) => <PlaceCard key={p.id} p={p} onVisit={() => setVisitFor(p)} onChanged={reload} />)}
        </div>
      ) : (
        <Empty icon={<MapPin size={26} />} title={q ? 'Ничего не найдено' : 'Мест пока нет'} text={q ? undefined : 'Сохраняйте кафе, прогулки и выставки, куда хочется сходить вдвоём'}
          action={!q && <button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> Добавить место</button>} />
      )}

      {randomPick && (
        <Sheet title="Может, сюда?" onClose={() => setRandomPick(null)}>
          <div className="card" style={{ marginTop: 12, boxShadow: 'none', background: 'var(--canvas)' }}>
            {randomPick.category && <span className="badge gray">{randomPick.category}</span>}
            <h3 style={{ fontSize: 22, margin: '8px 0 4px' }}>{randomPick.title}</h3>
            {randomPick.note && <p className="sub">{randomPick.note}</p>}
          </div>
          <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => { setVisitFor(randomPick); setRandomPick(null); }}><Check size={18} /> Отметить посещение</button>
          <button className="btn soft block" style={{ marginTop: 8 }} onClick={roll}><RotateCw size={18} /> Крутить ещё</button>
        </Sheet>
      )}
      {visitFor && <VisitSheet p={visitFor} onClose={() => setVisitFor(null)} onSaved={() => { setVisitFor(null); reload(); }} />}
      {adding && <AddPlaceSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

function PlaceCard({ p, onVisit, onChanged }: { p: Place; onVisit?: () => void; onChanged: () => void }) {
  const visited = p.status === 'visited';
  const [edit, setEdit] = useState(false);
  return (
    <div className="card place">
      <div className="body">
        <div className="row1">
          {p.category ? <span className="badge gray">{p.category}</span> : <span />}
          <RowActions
            onEdit={() => setEdit(true)}
            onDelete={async () => { if (confirm(`Удалить «${p.title}»?`)) { await del(`/places/${p.id}`); onChanged(); } }}
          />
        </div>
        <h3>{p.title}</h3>
        {p.note && <p>{p.note}</p>}
        {visited && p.review && <p style={{ color: 'var(--label)' }}>«{p.review}»</p>}
      </div>
      <div className="foot">
        <span>{p.mine ? 'добавил(а) ты' : `добавил(а) ${p.added_by_name.split(' ')[0]}`}</span>
        {visited ? (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {p.visited_at && <span>{fmtDate(p.visited_at)}</span>}
            {p.rating ? <span className="badge gray"><Star size={11} fill="currentColor" /> {p.rating}</span> : null}
            {p.want_return ? <span className="badge dark"><Heart size={11} /> Вернёмся</span> : null}
          </span>
        ) : (
          <button className="badge" onClick={onVisit}><Check size={11} /> Были здесь</button>
        )}
      </div>
      {edit && (
        <EditSheet
          title="Место"
          value={{ title: p.title, category: p.category || '', note: p.note || '' }}
          fields={[
            { k: 'title', label: 'Название' },
            { k: 'category', label: 'Категория', placeholder: 'кафе, парк, музей' },
            { k: 'note', label: 'Заметка', type: 'textarea' },
          ]}
          onClose={() => setEdit(false)}
          onSave={async (patchBody) => { await patch(`/places/${p.id}`, patchBody); onChanged(); }}
          onDelete={async () => { await del(`/places/${p.id}`); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddPlaceSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Кафе');
  const [note, setNote] = useState('');
  return (
    <Sheet title="Новое место" onClose={onClose}>
      <label className="label">Название</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, кофейня «Zero»" />
      <label className="label">Категория</label>
      <div className="chips">
        {['Кафе', 'Природа', 'Выставка', 'Кино', 'Ресторан', 'Прогулка', 'Магазин'].map((c) => (
          <button key={c} className={`chip ${category === c ? 'on accent' : ''}`} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <label className="label">Заметка (необязательно)</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Чем интересно это место" />
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title.trim()} onClick={async () => { await post('/places', { title, category, note }); haptic.ok(); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}

function VisitSheet({ p, onClose, onSaved }: { p: Place; onClose: () => void; onSaved: () => void }) {
  const [rating, setRating] = useState(0);
  const [again, setAgain] = useState(true);
  const [review, setReview] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Sheet title="Отметить посещение" onClose={onClose}>
      <p className="sub">{p.title}</p>
      <label className="label">Дата посещения</label>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={n <= rating ? 'on' : ''} onClick={() => setRating(n === rating ? 0 : n)} aria-label={`${n} из 5`}><Star size={34} fill={n <= rating ? 'currentColor' : 'none'} /></button>
        ))}
      </div>
      <div className="switch-row"><div><b>Вернёмся?</b><div className="sub" style={{ marginTop: 0 }}>Придём сюда ещё раз</div></div><Switch on={again} onChange={setAgain} /></div>
      <label className="label">Отзыв — необязательно</label>
      <textarea className="input" value={review} onChange={(e) => setReview(e.target.value)} placeholder="Как прошло? Что понравилось?" />
      <button className="btn primary block" style={{ marginTop: 16 }} onClick={async () => { await post(`/places/${p.id}/visit`, { rating, want_return: again, review, date }); haptic.ok(); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}

// ---------------------------------------------------------------- visited history
function Dates() {
  const { data, reload } = useResource<Place[]>('/places', 6000);
  if (!data) return <Skeletons n={2} />;
  const visited = data.filter((p) => p.status === 'visited').sort((a, b) => (b.visited_at || '').localeCompare(a.visited_at || ''));
  if (!visited.length) return <Empty icon={<Heart size={26} />} title="История свиданий пуста" text="Когда отметите посещение места, оно появится здесь с оценкой и отзывом" />;
  return <div className="stack" style={{ marginTop: 16 }}>{visited.map((p) => <PlaceCard key={p.id} p={p} onChanged={reload} />)}</div>;
}

// ---------------------------------------------------------------- events
const EVENT_REMIND: [any, string][] = [[null, 'без напоминания'], ['morning', 'утром в день'], ['day_before', 'за день'], ['week_before', 'за неделю'], ['two_hours', 'за 2 часа']];

function Events({ only }: { only?: string }) {
  const { openEventSheet } = useApp();
  const { data, reload } = useResource<EventT[]>('/events', 6000);
  const [edit, setEdit] = useState<EventT | null>(null);
  if (!data) return <Skeletons n={2} />;
  const today = new Date().toISOString().slice(0, 10);
  const list = data.filter((e) => !only || e.kind === only);
  const upcoming = list.filter((e) => e.date >= today || e.yearly);
  const past = list.filter((e) => e.date < today && !e.yearly).reverse();
  const Row = ({ e }: { e: EventT }) => (
    <div className="li">
      <span className="round-ic gray">{e.kind === 'trip' ? <Plane size={18} /> : <Calendar size={18} />}</span>
      <div className="grow"><div className="title">{e.title}</div><div className="sub" style={{ marginTop: 0 }}>{fmtDate(e.date)}{e.time ? `, ${e.time}` : ''}{e.yearly ? ' · каждый год' : ''}{e.remind_rule ? ' · напомню' : ''}</div></div>
      <RowActions onEdit={() => setEdit(e)} onDelete={async () => { await del(`/events/${e.id}`); reload(); }} />
    </div>
  );
  return (
    <>
      <div className="sec-head" style={{ marginTop: 20 }}>
        <h2>{only === 'trip' ? 'Поездки' : 'Ближайшее'}</h2>
        <button className="link" onClick={openEventSheet}>+ Добавить</button>
      </div>
      {upcoming.length ? <div className="list">{upcoming.map((e) => <Row key={e.id} e={e} />)}</div> : (
        <Empty icon={only === 'trip' ? <Plane size={26} /> : <Calendar size={26} />} title={only === 'trip' ? 'Поездок пока нет' : 'Событий пока нет'} text="Добавьте даты, которые важны вам обоим" action={<button className="btn primary" onClick={openEventSheet}><Plus size={18} /> Добавить</button>} />
      )}
      {past.length > 0 && (
        <>
          <div className="sec-head"><h2>Прошедшие</h2></div>
          <div className="list" style={{ opacity: 0.7 }}>{past.map((e) => <Row key={e.id} e={e} />)}</div>
        </>
      )}
      {edit && (
        <EditSheet
          title="Событие"
          value={{ title: edit.title, date: edit.date, time: edit.time || '', yearly: !!edit.yearly, remind_rule: edit.remind_rule ?? null }}
          fields={[
            { k: 'title', label: 'Название' },
            { k: 'date', label: 'Дата', type: 'date' },
            { k: 'time', label: 'Время', type: 'time' },
            { k: 'yearly', label: 'Каждый год', type: 'switch', hint: 'Годовщина повторяется' },
            { k: 'remind_rule', label: 'Напоминание', type: 'chips', options: EVENT_REMIND, hint: 'Придёт обоим в Telegram' },
          ]}
          onClose={() => setEdit(null)}
          onSave={async (p) => { await patch(`/events/${edit.id}`, p); reload(); }}
          onDelete={async () => { await del(`/events/${edit.id}`); reload(); }}
        />
      )}
    </>
  );
}

export function EventSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('');
  const [kind, setKind] = useState('event');
  const [yearly, setYearly] = useState(false);
  return (
    <Sheet title="Новое событие" onClose={onClose}>
      <label className="label">Название</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ужин, поездка, годовщина…" />
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><label className="label">Дата</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label className="label">Время</label><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
      </div>
      <label className="label">Тип</label>
      <div className="chips">
        {[['event', 'Событие'], ['trip', 'Поездка'], ['date', 'Свидание']].map(([k, l]) => (
          <button key={k} className={`chip ${kind === k ? 'on accent' : ''}`} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      <div className="switch-row"><b>Повторять каждый год</b><Switch on={yearly} onChange={setYearly} /></div>
      <button className="btn primary block" disabled={!title.trim() || !date} onClick={async () => { await post('/events', { title, date, time, kind, yearly }); haptic.ok(); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}
