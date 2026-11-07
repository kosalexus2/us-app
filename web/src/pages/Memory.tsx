import { useEffect, useState } from 'react';
import { Camera, Clapperboard, Gift, Lock, Mail, Plus, Sparkles, Trash2 } from 'lucide-react';
import { del, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Empty, Segmented, Sheet, Skeletons, Switch } from '../components/ui';
import type { Note, Wish } from '../types';
import { fmtDateTime } from '../util';
import { haptic } from '../tg';

type Sub = 'wishlist' | 'notes' | 'memories';

export default function Memory({ sub }: { sub?: string }) {
  const [tab, setTab] = useState<Sub>((sub as Sub) || 'wishlist');
  useEffect(() => { if (sub) setTab(sub as Sub); }, [sub]);
  return (
    <div className="scroll">
      <h1 className="h-title">Память</h1>
      <p className="sub">Желания, записки и то, что хочется сохранить</p>
      <Segmented<Sub> value={tab} onChange={setTab} options={[['wishlist', 'Вишлист'], ['notes', 'Записки'], ['memories', 'Воспоминания']]} />
      {tab === 'wishlist' && <Wishlist />}
      {tab === 'notes' && <Notes />}
      {tab === 'memories' && (
        <Empty icon={<Camera size={26} />} title="Воспоминания — скоро" text="Здесь появятся ваши фото и истории. Пока можно сохранять места и оставлять записки." />
      )}
    </div>
  );
}

const KIND_LABEL = { gift: 'Подарки', watch: 'Посмотреть', dream: 'Мечты' } as const;
const KindIcon = ({ k, size = 34 }: { k: Wish['kind']; size?: number }) => (k === 'gift' ? <Gift size={size} /> : k === 'watch' ? <Clapperboard size={size} /> : <Sparkles size={size} />);

function Wishlist() {
  const { boot } = useApp();
  const partner = boot.partner;
  const { data, reload, setData } = useResource<Wish[]>('/wishes', 5000);
  const [who, setWho] = useState<'me' | 'partner'>('me');
  const [kind, setKind] = useState<Wish['kind']>('gift');
  const [adding, setAdding] = useState(false);
  if (!data) return <Skeletons n={2} />;
  const list = data.filter((w) => (who === 'me' ? w.mine : !w.mine) && w.kind === kind);

  const claim = async (w: Wish) => {
    haptic.tap();
    setData(data.map((x) => (x.id === w.id ? { ...x, claimed_by_me: !x.claimed_by_me } : x)));
    await post(`/wishes/${w.id}/claim`);
    reload();
  };

  return (
    <>
      <div className="chips" style={{ marginTop: 16 }}>
        <button className={`chip ${who === 'me' ? 'on' : ''}`} onClick={() => setWho('me')}>Хочу я</button>
        <button className={`chip ${who === 'partner' ? 'on accent' : ''}`} onClick={() => setWho('partner')}>Хочет {partner?.first_name || 'партнёр'}</button>
      </div>
      <div className="chips" style={{ marginTop: 10 }}>
        {(Object.keys(KIND_LABEL) as Wish['kind'][]).map((k) => (
          <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      {kind === 'gift' && <div className="notice"><Lock size={16} /> Подготовка подарка видна только дарителю</div>}

      {list.length ? (
        <div className="grid2">
          {list.map((w) => (
            <div className="card wish" key={w.id}>
              <div className="img">{w.image_url ? <img src={w.image_url} alt="" referrerPolicy="no-referrer" /> : <KindIcon k={w.kind} />}</div>
              <h3>{w.title}</h3>
              <div className="price">{w.price ? `${w.price}` : ' '}</div>
              {w.mine ? (
                <button className="btn ghost sm" onClick={async () => { await del(`/wishes/${w.id}`); reload(); }}><Trash2 size={14} /> Удалить</button>
              ) : w.kind === 'gift' ? (
                <button className={`btn sm ${w.claimed_by_me ? 'soft' : 'primary'}`} onClick={() => claim(w)}>{w.claimed_by_me ? 'Ты берёшь ✓' : 'Беру на себя'}</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<KindIcon k={kind} size={26} />}
          title={who === 'me' ? 'Пока пусто' : 'Список партнёра пока пуст'}
          text={who === 'me' ? 'Добавьте то, о чём мечтаете — партнёр увидит' : undefined}
          action={who === 'me' && <button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> Добавить</button>}
        />
      )}
      {who === 'me' && list.length > 0 && <button className="btn soft block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><Plus size={18} /> Добавить</button>}
      {adding && <AddWishSheet initial={kind} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export function AddWishSheet({ initial = 'gift', title: t0 = '', onClose, onSaved }: { initial?: Wish['kind']; title?: string; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<Wish['kind']>(initial);
  const [title, setTitle] = useState(t0);
  const [price, setPrice] = useState('');
  const [url, setUrl] = useState('');
  return (
    <Sheet title="В вишлист" onClose={onClose}>
      <div className="chips" style={{ marginTop: 8 }}>
        {(Object.keys(KIND_LABEL) as Wish['kind'][]).map((k) => (
          <button key={k} className={`chip ${kind === k ? 'on accent' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>
      <label className="label">Что хочется</label>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, шерстяной свитер" />
      {kind === 'gift' && (
        <>
          <label className="label">Цена (необязательно)</label>
          <input className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="150 BYN" />
          <label className="label">Ссылка (необязательно)</label>
          <input className="input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </>
      )}
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title.trim()} onClick={async () => { await post('/wishes', { kind, title, price, url }); haptic.ok(); onSaved(); }}>Сохранить</button>
    </Sheet>
  );
}

function Notes() {
  const { data, reload } = useResource<Note[]>('/notes', 6000);
  const [adding, setAdding] = useState(false);
  if (!data) return <Skeletons n={2} />;
  return (
    <>
      <button className="btn primary block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><Mail size={18} /> Оставить записку</button>
      {data.length ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {data.map((n) => (
            <div key={n.id} className={`card note-card ${n.locked ? 'locked' : ''}`}>
              <div className="from">
                <span>{n.mine ? 'ТЫ' : n.from_name.split(' ')[0].toUpperCase()}</span>
                <span style={{ color: 'var(--label-2)', fontWeight: 500 }}>{n.open_at && n.open_at > Date.now() / 1000 ? `откроется ${fmtDateTime(n.open_at)}` : fmtDateTime(n.created_at)}</span>
              </div>
              {n.locked ? <p style={{ color: 'var(--label-2)' }}><Lock size={15} style={{ verticalAlign: -2 }} /> Записка-сюрприз. Её можно будет прочитать {n.open_at ? fmtDateTime(n.open_at) : 'позже'}.</p> : <p>{n.text}</p>}
              {n.mine && <button className="x-btn" style={{ marginTop: 8, padding: 0 }} onClick={async () => { await del(`/notes/${n.id}`); reload(); }}><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={<Mail size={26} />} title="Записок пока нет" text="Напишите партнёру пару тёплых слов — можно с открытием в назначенное время" />
      )}
      {adding && <NoteSheet onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export function NoteSheet({ text: t0 = '', onClose, onSaved }: { text?: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(t0);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const openAt = later && when ? Math.floor(new Date(when).getTime() / 1000) : null;
  return (
    <Sheet title="Новая записка" onClose={onClose}>
      <textarea className="input" autoFocus style={{ marginTop: 12 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что хочется сказать?" />
      <div className="switch-row"><div><b>Открыть позже</b><div className="sub" style={{ marginTop: 0 }}>Записка появится у партнёра в нужный момент</div></div><Switch on={later} onChange={setLater} /></div>
      {later && <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
      <button className="btn primary block" style={{ marginTop: 16 }} disabled={!text.trim() || (later && !when)} onClick={async () => { await post('/notes', { text, open_at: openAt }); haptic.ok(); onSaved(); }}>Отправить</button>
    </Sheet>
  );
}
