import { useEffect, useState } from 'react';
import {
  ArrowLeft, Bell, CalendarPlus, Check, Clock, Gift, Link2, Lock, Pencil, Plus, Send, Shield, Trash2, X,
} from 'lucide-react';
import { del, get, patch, post, useResource } from '../api';
import { Avatar, ERRORS, Empty, Segmented, Sheet, Skeletons, Switch, useToast } from '../components/ui';
import type { User } from '../components/ui';
import { fmtDate } from '../util';
import { haptic } from '../tg';
import Assistant from '../components/Assistant';
import type { Parsed } from '../assistant';

export type CalItem = {
  id: number; title: string; date: string; time: string | null; note: string | null;
  remind_min: number | null; private: number; with_name: string | null; pending: number;
};
export type WishItem = {
  id: number; kind: 'gift' | 'watch' | 'dream'; title: string; price: string | null;
  url: string | null; image_url: string | null; claimed_by_me: boolean; taken: boolean;
};
export type PersonData = {
  user: User & { username: string | null };
  relation: 'self' | 'partner' | 'friend';
  today: string;
  wishes: WishItem[];
  cal: CalItem[];
  grant: 'view' | 'propose' | 'edit';
  can: 'view' | 'propose' | 'edit';
};

const REMIND: [number, string][] = [[0, 'в момент'], [15, 'за 15 мин'], [60, 'за час'], [180, 'за 3 часа'], [1440, 'за день']];
const remindLabel = (m: number | null) => (m === null ? null : REMIND.find(([v]) => v === m)?.[1] || `за ${m} мин`);
const WISH_TABS: ['gift' | 'watch' | 'dream', string][] = [['gift', 'Подарки'], ['watch', 'Посмотреть'], ['dream', 'Мечты']];

/** Карточка человека: его вишлист со ссылками и его календарь. */
export default function Person({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, error, reload } = useResource<PersonData>(`/people/${id}`, 6000);
  const [tab, setTab] = useState<'wish' | 'cal'>('wish');
  const [sheet, setSheet] = useState<null | { kind: 'cal'; item?: CalItem; prefill?: Parsed } | { kind: 'wish' } | { kind: 'perm' }>(null);
  const toast = useToast();

  if (error?.status === 404) {
    return (
      <div className="center-screen">
        <h1>Профиль недоступен</h1>
        <p>Этот человек не в вашей паре и не у вас в друзьях.</p>
        <button className="btn primary block" onClick={onBack}>Назад</button>
      </div>
    );
  }
  if (!data) return <div className="scroll" style={{ paddingTop: 70 }}><Skeletons n={3} /></div>;

  const self = data.relation === 'self';
  const canEdit = data.can === 'edit' || self;
  const canPropose = data.can !== 'view' || self;

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    try {
      const r = await fn();
      reload();
      if (r?.proposed) toast('Предложение отправлено');
      else if (okMsg) toast(okMsg);
    } catch (e: any) {
      toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз');
    }
  };

  return (
    <>
      <div className="scroll" style={{ paddingTop: 8 }}>
        <div className="person-head">
          <button className="icon-btn" onClick={onBack} aria-label="Назад"><ArrowLeft size={18} /></button>
          <Avatar user={data.user} size="lg" dot />
          <div className="grow">
            <h1>{self ? 'Вы' : data.user.name}</h1>
            <p>{self ? 'ваш профиль' : data.relation === 'partner' ? 'ваша пара' : 'друг'}{data.user.username ? ` · @${data.user.username}` : ''}</p>
          </div>
          {self && (
            <button className="icon-btn" onClick={() => setSheet({ kind: 'perm' })} aria-label="Кто что видит"><Shield size={18} /></button>
          )}
        </div>

        <Segmented<'wish' | 'cal'> value={tab} options={[['wish', `Вишлист${data.wishes.length ? ` · ${data.wishes.length}` : ''}`], ['cal', `Календарь${data.cal.length ? ` · ${data.cal.length}` : ''}`]]} onChange={setTab} />

        {tab === 'wish' ? (
          <Wishes data={data} onAdd={() => setSheet({ kind: 'wish' })} onChanged={reload} />
        ) : (
          <Calendar
            data={data}
            onAdd={() => canPropose && setSheet({ kind: 'cal' })}
            onEdit={(item) => canPropose && setSheet({ kind: 'cal', item })}
            onDelete={(item) => canEdit && window.confirm(`Удалить «${item.title}»?`) && act(() => del(`/cal/${item.id}`), 'Удалено')}
          />
        )}
      </div>

      {(tab === 'wish' ? self : canPropose) && (
        <button className="fab" onClick={() => { haptic.tap(); setSheet(tab === 'wish' ? { kind: 'wish' } : { kind: 'cal' }); }} aria-label="Добавить">
          <Plus size={24} strokeWidth={2.6} />
        </button>
      )}

      <Assistant
        person={data}
        onParsed={(p) => setSheet({ kind: 'cal', prefill: p })}
        onDone={reload}
      />

      {sheet?.kind === 'wish' && <WishSheet onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
      {sheet?.kind === 'cal' && (
        <CalSheet
          person={data}
          item={sheet.item}
          prefill={sheet.prefill}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); reload(); }}
        />
      )}
      {sheet?.kind === 'perm' && <PermSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function Wishes({ data, onAdd, onChanged }: { data: PersonData; onAdd: () => void; onChanged: () => void }) {
  const self = data.relation === 'self';
  const [kind, setKind] = useState<'gift' | 'watch' | 'dream'>('gift');
  const toast = useToast();
  const list = data.wishes.filter((w) => w.kind === kind);

  const claim = async (w: WishItem) => {
    haptic.tap();
    try {
      await post(`/people/${data.user.id}/wishes/${w.id}/claim`);
      onChanged();
    } catch (e: any) {
      toast(e.message === 'already_taken' ? 'Это уже взял кто-то другой' : 'Не получилось');
    }
  };
  const remove = async (w: WishItem) => {
    if (!window.confirm(`Удалить «${w.title}»?`)) return;
    try { await del(`/wishes/${w.id}`); onChanged(); } catch { toast('Не получилось'); }
  };

  return (
    <>
      <div className="chips" style={{ marginTop: 14 }}>
        {WISH_TABS.map(([k, label]) => (
          <button key={k} className={`chip ${kind === k ? 'on accent' : ''}`} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>

      {!self && kind === 'gift' && (
        <div className="notice" style={{ marginTop: 12 }}><Lock size={14} /> {data.user.first_name} не узнает, что подарок уже взяли</div>
      )}

      {list.length === 0 ? (
        <Empty
          icon={<Gift size={24} />}
          title={self ? 'Пока пусто' : `У ${data.user.first_name} пока пусто`}
          text={self ? 'Добавьте ссылку на товар — подтянется картинка и название' : undefined}
          action={self ? <button className="btn soft" onClick={onAdd}><Plus size={18} /> Добавить</button> : undefined}
        />
      ) : (
        <div className="grid2">
          {list.map((w) => (
            <div key={w.id} className={`card wish ${w.taken ? 'taken' : ''}`}>
              <div className="img">
                {w.image_url ? <img src={w.image_url} alt="" referrerPolicy="no-referrer" loading="lazy" /> : <Gift size={26} />}
                {self && <button className="wish-x" onClick={() => remove(w)} aria-label="Удалить"><X size={14} /></button>}
              </div>
              <h3>{w.title}</h3>
              {w.price && <div className="price">{w.price}</div>}
              {w.url && (
                <a className="wish-link" href={w.url} target="_blank" rel="noreferrer noopener">
                  <Link2 size={13} /> {hostOf(w.url)}
                </a>
              )}
              {!self && (
                w.taken ? (
                  <button className="btn soft block sm" disabled>Уже взяли</button>
                ) : (
                  <button className={`btn ${w.claimed_by_me ? 'soft' : 'primary'} block sm`} onClick={() => claim(w)}>
                    {w.claimed_by_me ? <><Check size={15} /> Беру на себя</> : 'Взять на себя'}
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'ссылка'; } };

function Calendar({ data, onAdd, onEdit, onDelete }: { data: PersonData; onAdd: () => void; onEdit: (i: CalItem) => void; onDelete: (i: CalItem) => void }) {
  const self = data.relation === 'self';
  const canEdit = self || data.can === 'edit';
  const canPropose = self || data.can !== 'view';

  if (data.cal.length === 0) {
    return (
      <Empty
        icon={<CalendarPlus size={24} />}
        title={self ? 'Планов пока нет' : `У ${data.user.first_name} пока пусто`}
        text={canPropose && !self ? 'Можно предложить встречу — он(а) подтвердит' : undefined}
        action={canPropose ? <button className="btn soft" onClick={onAdd}><Plus size={18} /> {self ? 'Добавить' : 'Предложить'}</button> : undefined}
      />
    );
  }
  return (
    <div className="stack" style={{ marginTop: 14 }}>
      {!self && data.can === 'view' && <div className="notice"><Lock size={14} /> Только просмотр: изменения {data.user.first_name} не разрешил(а)</div>}
      {!self && data.can === 'propose' && <div className="notice"><Send size={14} /> Ваши изменения уйдут как предложение</div>}
      {data.cal.map((c) => (
        <div key={c.id} className="card cal-row">
          <div className="when">
            <b>{fmtDate(c.date)}</b>
            <span>{c.time || 'весь день'}</span>
          </div>
          <div className="grow">
            <div className="title">{c.title}</div>
            <div className="meta">
              {c.with_name && <span>с {c.with_name}</span>}
              {c.remind_min !== null && <span><Bell size={12} /> {remindLabel(c.remind_min)}</span>}
              {c.private === 1 && <span><Lock size={12} /> только я</span>}
              {c.pending > 0 && <span className="warn"><Clock size={12} /> есть предложение</span>}
            </div>
            {c.note && <p className="note">{c.note}</p>}
          </div>
          {canPropose && <button className="icon-btn" onClick={() => onEdit(c)} aria-label="Изменить"><Pencil size={15} /></button>}
          {canEdit && <button className="icon-btn" onClick={() => onDelete(c)} aria-label="Удалить"><Trash2 size={15} /></button>}
        </div>
      ))}
    </div>
  );
}

/** Добавление/правка встречи. В чужом календаре — предложение или прямая правка, по правам. */
export function CalSheet({ person, item, prefill, onClose, onSaved }: {
  person: PersonData; item?: CalItem; prefill?: Parsed; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? prefill?.title ?? '');
  const [date, setDate] = useState(item?.date ?? prefill?.date ?? person.today);
  const [time, setTime] = useState(item?.time ?? prefill?.time ?? '');
  const [note, setNote] = useState(item?.note ?? '');
  const [remind, setRemind] = useState<number | null>(item?.remind_min ?? prefill?.remind_min ?? null);
  const [priv, setPriv] = useState(item?.private === 1);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const self = person.relation === 'self';
  const direct = self || person.can === 'edit';

  const save = async () => {
    if (!title.trim()) return toast('Напишите название');
    setBusy(true);
    try {
      const body: any = { title: title.trim(), date, time: time || null, note: note.trim() || null, remind_min: remind };
      if (self) body.private = priv;
      const r = item ? await patch(`/cal/${item.id}`, body) : await post('/cal', { ...body, owner_id: person.user.id });
      toast(r?.proposed ? 'Предложение отправлено' : item ? 'Сохранено' : 'Добавлено');
      haptic.ok();
      onSaved();
    } catch (e: any) {
      toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title={item ? (direct ? 'Изменить' : 'Предложить замену') : direct ? 'Новая встреча' : `Предложить ${person.user.first_name}`} onClose={onClose}>
      {!direct && (
        <div className="notice" style={{ marginTop: 8 }}>
          <Send size={14} /> {person.user.first_name} получит предложение и сможет принять или отклонить
        </div>
      )}
      {item && !direct && <p className="hint" style={{ marginTop: 10 }}>Сейчас: «{item.title}», {fmtDate(item.date)}{item.time ? `, ${item.time}` : ''}</p>}

      <label className="label">Название</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Поход в зал" autoFocus={!title} />

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label className="label">Дата</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ width: 120 }}>
          <label className="label">Время</label>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <label className="label">Напомнить</label>
      <div className="chips">
        <button className={`chip ${remind === null ? 'on' : ''}`} onClick={() => setRemind(null)}>не надо</button>
        {REMIND.map(([v, l]) => (
          <button key={v} className={`chip ${remind === v ? 'on accent' : ''}`} onClick={() => setRemind(v)}>{l}</button>
        ))}
      </div>

      <label className="label">Заметка</label>
      <textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" style={{ minHeight: 70 }} />

      {self && (
        <div className="switch-row">
          <span>Только для меня</span>
          <Switch on={priv} onChange={setPriv} />
        </div>
      )}

      <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={save}>
        {direct ? 'Сохранить' : 'Отправить предложение'}
      </button>
    </Sheet>
  );
}

/** Добавление желания: вставил ссылку — подтянулись картинка, название и цена. */
function WishSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<'gift' | 'watch' | 'dream'>('gift');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const fetchPreview = async (raw: string) => {
    const u = raw.trim();
    if (!u) return;
    setLoading(true);
    try {
      const p = await post<{ url: string; title: string; image: string; price: string; site: string }>('/link-preview', { url: u });
      setUrl(p.url);
      if (p.title && !title.trim()) setTitle(p.title);
      if (p.image) setImage(p.image);
      if (p.price && !price.trim()) setPrice(p.price);
      if (!p.title && !p.image) toast('Ссылка сохранится, но превью нет');
    } catch (e: any) {
      toast(e.message === 'bad_url' ? 'Ссылка выглядит неправильно' : 'Не удалось загрузить превью');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!title.trim()) return toast('Напишите название');
    setBusy(true);
    try {
      await post('/wishes', { kind, title: title.trim(), price: price.trim() || null, url: url.trim() || null, image_url: image || null });
      haptic.ok();
      onSaved();
    } catch {
      toast('Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="В вишлист" onClose={onClose}>
      <Segmented<'gift' | 'watch' | 'dream'> value={kind} options={WISH_TABS} onChange={setKind} />

      <label className="label">Ссылка</label>
      <div className="field">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => fetchPreview(e.target.value)}
          placeholder="Вставьте ссылку на товар"
          inputMode="url"
          autoCapitalize="off"
        />
        <button className="send" disabled={!url.trim() || loading} onClick={() => fetchPreview(url)} aria-label="Загрузить превью">
          {loading ? <span className="spinner" /> : <Link2 size={17} />}
        </button>
      </div>

      {image && (
        <div className="preview-card">
          <img src={image} alt="" referrerPolicy="no-referrer" />
          <button className="icon-btn" onClick={() => setImage('')} aria-label="Убрать картинку"><X size={15} /></button>
        </div>
      )}

      <label className="label">Название</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что это" />

      <label className="label">Цена</label>
      <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Необязательно" />

      <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={save}>Добавить</button>
    </Sheet>
  );
}

/** Кто что может делать в моём календаре. */
function PermSheet({ onClose }: { onClose: () => void }) {
  const { data } = useResource<{ friends: (User & { username: string | null })[] }>('/friends', 0);
  const [people, setPeople] = useState<{ user: User; level: string }[]>([]);
  const toast = useToast();

  useEffect(() => {
    (async () => {
      const boot = await get<{ partner: User | null }>('/bootstrap');
      const list: { user: User; level: string }[] = [];
      for (const u of [boot.partner, ...(data?.friends || [])].filter(Boolean) as User[]) {
        try {
          const p = await get<PersonData>(`/people/${u.id}`);
          list.push({ user: u, level: p.grant });
        } catch { /* нет связи — пропускаем */ }
      }
      setPeople(list);
    })();
  }, [data]);

  const setLevel = async (userId: number, level: string) => {
    setPeople((p) => p.map((x) => (x.user.id === userId ? { ...x, level } : x)));
    try { await post('/perm', { viewer_id: userId, level }); } catch { toast('Не получилось'); }
  };

  return (
    <Sheet title="Кто что может" onClose={onClose}>
      <p className="hint" style={{ marginTop: 4 }}>Это права в вашем календаре. Вишлист виден всем, кто есть в паре и друзьях.</p>
      {people.length === 0 ? (
        <p className="hint" style={{ marginTop: 16 }}>Пока некого настраивать.</p>
      ) : (
        <div className="stack" style={{ marginTop: 14 }}>
          {people.map(({ user, level }) => (
            <div key={user.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar user={user} />
                <div className="grow"><div className="title">{user.name}</div></div>
              </div>
              <div className="chips" style={{ marginTop: 10 }}>
                {[['view', 'смотреть'], ['propose', 'предлагать'], ['edit', 'менять']].map(([v, l]) => (
                  <button key={v} className={`chip ${level === v ? 'on accent' : ''}`} onClick={() => setLevel(user.id, v)}>{l}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
