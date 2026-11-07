import { useEffect, useState } from 'react';
import { ArrowUp, Check, ChefHat, ChevronDown, ChevronUp, ListChecks, Repeat, ShoppingCart, Trash2, Dices } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { Empty, Segmented, Sheet, Skeletons, useToast } from '../components/ui';
import type { Chore, Recipe, Shop } from '../types';
import { fmtDate } from '../util';
import { haptic } from '../tg';

type Sub = 'shop' | 'chores' | 'recipes';

export default function Home({ sub }: { sub?: string }) {
  const [tab, setTab] = useState<Sub>((sub as Sub) || 'shop');
  useEffect(() => { if (sub) setTab(sub as Sub); }, [sub]);
  return (
    <div className="scroll">
      <h1 className="h-title">Дом</h1>
      <p className="sub">Совместное пространство и уют</p>
      <Segmented<Sub> value={tab} onChange={setTab} options={[['shop', 'Покупки'], ['chores', 'Дела'], ['recipes', 'Рецепты']]} />
      {tab === 'shop' && <Shopping />}
      {tab === 'chores' && <Chores />}
      {tab === 'recipes' && <Recipes />}
    </div>
  );
}

const SUGGEST = ['Хлеб', 'Яйца', 'Молоко', 'Кофе в зёрнах', 'Сыр', 'Овощи', 'Фрукты', 'Туалетная бумага'];

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const submit = async () => {
    const t = v.trim();
    if (!t) return;
    setV('');
    await onAdd(t);
    haptic.tap();
  };
  return (
    <div className="field" style={{ marginTop: 16 }}>
      <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} enterKeyHint="send" />
      <button className="send" onClick={submit} disabled={!v.trim()} aria-label="Добавить"><ArrowUp size={20} /></button>
    </div>
  );
}

function Shopping() {
  const { data, reload, setData } = useResource<Shop[]>('/shopping', 3000);
  const [showDone, setShowDone] = useState(false);
  if (!data) return <Skeletons n={2} />;
  const open = data.filter((s) => !s.done);
  const done = data.filter((s) => s.done);
  const names = new Set(open.map((s) => s.title.toLowerCase()));
  const chips = SUGGEST.filter((s) => !names.has(s.toLowerCase())).slice(0, 6);

  const add = async (t: string) => { await post('/shopping', { title: t }); reload(); };
  const toggle = async (s: Shop) => {
    haptic.tap();
    setData(data.map((x) => (x.id === s.id ? { ...x, done: s.done ? 0 : 1 } : x))); // optimistic
    await patch(`/shopping/${s.id}`, { done: !s.done });
    reload();
  };

  return (
    <>
      <AddRow placeholder="Добавить молоко, сыр, фрукты…" onAdd={add} />
      {chips.length > 0 && (
        <div className="chips" style={{ marginTop: 12 }}>
          {chips.map((c) => <button key={c} className="chip" onClick={() => add(c)}>+ {c}</button>)}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        {open.length ? (
          <div className="list">
            {open.map((s) => (
              <div className="li" key={s.id}>
                <button className="check" onClick={() => toggle(s)} aria-label="Купили" />
                <div className="grow"><div className="title">{s.title}</div></div>
                {s.category && <span className="badge gray">{s.category}</span>}
                <button className="x-btn" aria-label="Удалить" onClick={async () => { await del(`/shopping/${s.id}`); reload(); }}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<ShoppingCart size={26} />} title="Список пуст" text="Добавьте, что нужно купить — партнёр увидит сразу" />
        )}
      </div>
      {done.length > 0 && (
        <>
          <button className="card" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, textAlign: 'left' }} onClick={() => setShowDone(!showDone)}>
            <Check size={18} color="var(--label-2)" /><span style={{ flex: 1, fontWeight: 500 }}>Куплено ({done.length})</span>
            {showDone ? <ChevronUp size={18} color="var(--label-2)" /> : <ChevronDown size={18} color="var(--label-2)" />}
          </button>
          {showDone && (
            <div className="list" style={{ marginTop: 8 }}>
              {done.map((s) => (
                <div className="li done" key={s.id}>
                  <button className="check" onClick={() => toggle(s)} aria-label="Вернуть"><Check size={15} /></button>
                  <div className="grow"><div className="title">{s.title}</div></div>
                  {s.done_by_name && <span className="badge">{s.done_by_name.split(' ')[0]}</span>}
                </div>
              ))}
              <button className="btn ghost block" onClick={async () => { await del('/shopping'); reload(); }}>Очистить купленное</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function Chores() {
  const { data, reload, setData } = useResource<Chore[]>('/chores', 4000);
  const [sheet, setSheet] = useState(false);
  if (!data) return <Skeletons n={2} />;
  const today = new Date().toISOString().slice(0, 10);
  const toggle = async (c: Chore) => {
    haptic.tap();
    setData(data.map((x) => (x.id === c.id ? { ...x, done: c.done ? 0 : 1 } : x)));
    await patch(`/chores/${c.id}`, { done: !c.done });
    reload();
  };
  return (
    <>
      <AddRow placeholder="Новое дело…" onAdd={async (t) => { await post('/chores', { title: t }); reload(); }} />
      <div style={{ marginTop: 16 }}>
        {data.length ? (
          <div className="list">
            {data.map((c) => (
              <div className={`li ${c.done ? 'done' : ''}`} key={c.id}>
                <button className="check" onClick={() => toggle(c)} aria-label="Готово">{c.done ? <Check size={15} /> : null}</button>
                <div className="grow">
                  <div className="title">{c.title}</div>
                  {(c.due_date || c.repeat_days) && (
                    <div className="sub" style={{ marginTop: 0, color: c.due_date && c.due_date < today && !c.done ? 'var(--accent)' : undefined }}>
                      {c.due_date ? fmtDate(c.due_date) : ''}{c.repeat_days ? ` · каждые ${c.repeat_days} дн.` : ''}
                    </div>
                  )}
                </div>
                {c.repeat_days ? <Repeat size={15} color="var(--label-3)" /> : null}
                <button className="x-btn" aria-label="Удалить" onClick={async () => { await del(`/chores/${c.id}`); reload(); }}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<ListChecks size={26} />} title="Дел пока нет" text="Разовые и повторяющиеся домашние дела" />
        )}
      </div>
      <button className="btn soft block" style={{ marginTop: 14 }} onClick={() => setSheet(true)}><Repeat size={18} /> Повторяющееся дело</button>
      {sheet && <RepeatSheet onClose={() => setSheet(false)} onSaved={() => { setSheet(false); reload(); }} />}
    </>
  );
}

function RepeatSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(7);
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  return (
    <Sheet title="Повторяющееся дело" onClose={onClose}>
      <p className="sub">После отметки дата сдвинется сама — дело не пропадёт.</p>
      <label className="label">Что делаем</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, генеральная уборка" />
      <label className="label">Как часто</label>
      <div className="chips">
        {[[1, 'Каждый день'], [7, 'Раз в неделю'], [14, 'Раз в 2 недели'], [30, 'Раз в месяц']].map(([n, l]) => (
          <button key={n} className={`chip ${days === n ? 'on accent' : ''}`} onClick={() => setDays(n as number)}>{l}</button>
        ))}
      </div>
      <label className="label">Ближайший раз</label>
      <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title.trim()} onClick={async () => { await post('/chores', { title, repeat_days: days, due_date: due }); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}

function Recipes() {
  const { data, reload } = useResource<Recipe[]>('/recipes', 8000);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<Recipe | null>(null);
  const toast = useToast();
  if (!data) return <Skeletons n={2} />;
  return (
    <>
      <div className="tiles" style={{ gridTemplateColumns: '1fr' }}>
        <button className="tile dark" style={{ minHeight: 96 }} onClick={() => { if (!data.length) return toast('Сначала сохраните рецепт'); setPick(data[Math.floor(Math.random() * data.length)]); }}>
          <Dices size={24} /><div><h3>Случайный рецепт</h3><p>Пусть жребий решит, что готовить</p></div>
        </button>
      </div>
      <div className="sec-head"><h2>Наши рецепты</h2><button className="link" onClick={() => setAdding(true)}>+ Добавить</button></div>
      {data.length ? (
        <div className="stack">
          {data.map((r) => (
            <div className="card" key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <h3 style={{ fontSize: 17 }}>{r.title}</h3>
                <button className="x-btn" aria-label="Удалить" onClick={async () => { await del(`/recipes/${r.id}`); reload(); }}><Trash2 size={16} /></button>
              </div>
              {r.note && <p className="sub" style={{ whiteSpace: 'pre-wrap' }}>{r.note}</p>}
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<ChefHat size={26} />} title="Рецептов пока нет" text="Сохраняйте блюда, которые хочется приготовить вместе" action={<button className="btn primary" onClick={() => setAdding(true)}>Добавить рецепт</button>} />
      )}
      {adding && <RecipeSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
      {pick && (
        <Sheet title="Готовим сегодня?" onClose={() => setPick(null)}>
          <div className="card" style={{ boxShadow: 'none', background: 'var(--canvas)', marginTop: 12 }}>
            <h3 style={{ fontSize: 22 }}>{pick.title}</h3>
            {pick.note && <p className="sub" style={{ whiteSpace: 'pre-wrap' }}>{pick.note}</p>}
          </div>
          <button className="btn soft block" style={{ marginTop: 16 }} onClick={() => setPick(data[Math.floor(Math.random() * data.length)])}>Крутить ещё</button>
        </Sheet>
      )}
    </>
  );
}

function RecipeSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  return (
    <Sheet title="Новый рецепт" onClose={onClose}>
      <label className="label">Название</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Паста карбонара" />
      <label className="label">Ингредиенты или заметка</label>
      <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Яйца, пармезан, гуанчале…" />
      <button className="btn primary block" style={{ marginTop: 16 }} disabled={!title.trim()} onClick={async () => { await post('/recipes', { title, note }); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}
