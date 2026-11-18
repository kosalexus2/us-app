import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CalendarSearch, Check, Info, Mic, Send, Sparkles, UserPlus } from 'lucide-react';
import { post } from '../api';
import { ERRORS, Sheet, Switch, useToast } from './ui';
import { KIND_LABEL, PICKABLE, listen, parseCommand, speechSupported } from '../assistant';
import type { Kind, Parsed } from '../assistant';
import { fmtDate } from '../util';
import { haptic } from '../tg';
import { useApp } from '../ctx';
import type { PersonData } from '../pages/Person';

const EXAMPLES = [
  'Зал завтра в 19:00, напомни за час',
  'Отметь, что купил молоко',
  'Хотим суши на следующей неделе',
  'Оплатить интернет до пятницы',
];
const REMIND: [number | null, string][] = [
  [null, 'без напоминания'], [0, 'в момент'], [15, 'за 15 мин'], [30, 'за 30 мин'],
  [60, 'за час'], [180, 'за 3 часа'], [1440, 'за день'], [10080, 'за неделю'],
];
const CHORE_REMIND: [string | null, string][] = [
  [null, 'без напоминания'], ['morning', 'утром в день'], ['day_before', 'за день'], ['week_before', 'за неделю'],
];
const DURATIONS: [number, string][] = [[60, '1 час'], [90, '1.5 часа'], [120, '2 часа'], [180, '3 часа'], [300, '5 часов']];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const dayLabel = (d: string) => `${WD[new Date(d + 'T00:00:00').getDay()]}, ${fmtDate(d)}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

type Slot = { date: string; start: string; end: string };

/** Кнопка-помощник: говорите или пишите обычной фразой, приложение само поймёт, куда это. */
export default function Assistant({ person, onParsed, onDone }: {
  person?: PersonData;
  onParsed?: (p: Parsed) => void;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="assistant-fab" onClick={() => { haptic.tap(); setOpen(true); }} aria-label="Голосовой помощник">
        <Sparkles size={20} />
      </button>
      {open && createPortal(
        <AssistantSheet person={person} onParsed={onParsed} onDone={onDone} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

function AssistantSheet({ person, onParsed, onDone, onClose }: {
  person?: PersonData; onParsed?: (p: Parsed) => void; onDone?: () => void; onClose: () => void;
}) {
  const { boot } = useApp();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Parsed | null>(null);
  const [choreRule, setChoreRule] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const voice = speechSupported();

  // С кем делаем: в карточке человека — он, иначе партнёр из пары.
  const mate = person && person.relation !== 'self' ? person.user : boot.partner;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => { clearTimeout(t); stopRef.current?.(); };
  }, []);

  /** Разбираем фразу заново и готовим черновик, который можно поправить руками. */
  const reparse = (value: string) => {
    setText(value);
    setSlots(null);
    if (!value.trim()) return setDraft(null);
    const p = parseCommand(value);
    setDraft(p);
    setChoreRule(p.kind === 'chore' && p.date ? 'morning' : null);
    setInvite(!!p.together && !!mate);
  };
  const edit = (patch: Partial<Parsed>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const mic = () => {
    if (rec) { stopRef.current?.(); setRec(false); return; }
    haptic.tap();
    const stop = listen(
      (t) => reparse(t),
      (err) => {
        setRec(false);
        if (err && err !== 'aborted' && err !== 'no-speech') toast(err === 'not-allowed' ? 'Доступ к микрофону запрещён' : 'Не расслышал, попробуйте ещё раз');
      },
    );
    if (!stop) return toast('Здесь нет распознавания речи — нажмите микрофон на клавиатуре');
    stopRef.current = stop;
    setRec(true);
  };

  const findSlots = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await post<{ slots: Slot[] }>('/free-slots', {
        from: draft.from || todayStr(),
        to: draft.to || undefined,
        duration_min: draft.duration_min || 120,
        with_id: mate?.id,
      });
      setSlots(r.slots);
      if (!r.slots.length) toast('Свободных окон не нашлось — попробуйте другой период');
    } catch (e: any) {
      toast(ERRORS[e.message] || 'Не получилось найти время');
    } finally {
      setBusy(false);
    }
  };

  /** Выбрали окно — превращаем в обычную встречу, которую можно досохранить. */
  const takeSlot = (s: Slot) => {
    haptic.tap();
    const title = draft?.title && draft.title !== 'Свободное время' ? draft.title : 'Встреча';
    setDraft({ ...(draft as Parsed), kind: 'cal', title, date: s.date, time: s.start, remind_min: draft?.remind_min ?? 60 });
    setSlots(null);
    setInvite(!!mate);
  };

  const apply = async () => {
    if (!draft) return;
    // Встреча в чужом календаре — отдаём форму на странице человека, чтобы было видно, что уйдёт
    if (draft.kind === 'cal' && person && person.relation !== 'self' && onParsed) {
      onParsed(draft);
      onClose();
      return;
    }
    setBusy(true);
    try {
      switch (draft.kind) {
        case 'done': {
          const r = await post<{ type: string; title: string }>('/assist/complete', { text: draft.title });
          toast(`${r.type === 'shopping' ? 'Куплено' : 'Сделано'}: ${r.title}`);
          break;
        }
        case 'cal': {
          const body = {
            title: draft.title,
            date: draft.date || todayStr(),
            time: draft.time || null,
            remind_min: draft.remind_min ?? null,
          };
          await post('/cal', body);
          if (invite && mate) {
            const r = await post<{ proposed?: boolean }>('/cal', { ...body, owner_id: mate.id });
            toast(r?.proposed ? `Предложил(а) ${mate.first_name}` : `Добавлено и у ${mate.first_name}`);
          } else {
            toast('Встреча добавлена');
          }
          break;
        }
        case 'chore':
          await post('/chores', {
            title: draft.title,
            due_date: draft.date || null,
            remind_rule: draft.date ? choreRule : null,
          });
          toast(draft.date && choreRule ? 'Дело добавлено, напомню' : 'Дело добавлено');
          break;
        case 'wish':
        case 'recipe': {
          let image: string | null = null;
          let title = draft.title;
          let price: string | null = null;
          if (draft.url) {
            try {
              const p = await post<{ title: string; image: string; price: string }>('/link-preview', { url: draft.url });
              image = p.image || null;
              price = p.price || null;
              if (p.title && (!title || title.length < 3)) title = p.title;
            } catch { /* превью необязательно */ }
          }
          if (draft.kind === 'recipe') await post('/recipes', { title, url: draft.url || null, image_url: image });
          else await post('/wishes', { kind: /посмотр|фильм|сериал/i.test(draft.raw) ? 'watch' : 'gift', title, url: draft.url || null, image_url: image, price });
          toast(draft.kind === 'recipe' ? 'Рецепт сохранён' : 'Добавлено в вишлист');
          break;
        }
        case 'shopping':
          await post('/shopping', { title: draft.title });
          toast('В списке покупок');
          break;
        case 'place':
          await post('/places', { title: draft.title });
          toast('Место добавлено');
          break;
        case 'note':
          await post('/notes', { text: draft.title });
          toast('Записка отправлена');
          break;
        default:
          toast('Выберите, что это');
          setBusy(false);
          return;
      }
      haptic.ok();
      onDone?.();
      onClose();
    } catch (e: any) {
      toast(e.message === 'not_found' && draft.kind === 'done' ? 'Не нашёл такого в списках' : ERRORS[e.message] || 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const k = draft?.kind;
  const target = person && person.relation !== 'self' ? person.user.first_name : null;

  return (
    <Sheet title="Помощник" onClose={onClose}>
      <p className="hint" style={{ marginTop: 2 }}>
        {target ? `Скажите, что предложить ${target}` : 'Скажите обычной фразой — что это, я пойму сам'}
      </p>

      <div className="mic-row">
        <button className={`mic ${rec ? 'on' : ''}`} onClick={mic} aria-label={rec ? 'Остановить' : 'Говорить'}>
          <Mic size={24} />
        </button>
        <div className="grow">
          <textarea
            ref={inputRef}
            className="input"
            value={text}
            onChange={(e) => reparse(e.target.value)}
            placeholder={voice ? 'Нажмите микрофон или напишите' : 'Нажмите микрофон на клавиатуре и надиктуйте'}
            style={{ minHeight: 76 }}
          />
        </div>
      </div>

      {!text && (
        <div className="chips" style={{ marginTop: 10 }}>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => reparse(e)}>{e}</button>
          ))}
        </div>
      )}

      {draft && (
        <div className="card parsed" style={{ marginTop: 14 }}>
          {/* тип можно поменять, если понял неправильно */}
          <div className="chips">
            {(k === 'done' || k === 'findtime' ? [k as Kind, ...PICKABLE] : PICKABLE).map((t) => (
              <button
                key={t}
                className={`chip ${k === t ? 'on accent' : ''}`}
                onClick={() => { edit({ kind: t }); setSlots(null); }}
              >{KIND_LABEL[t]}</button>
            ))}
          </div>

          <label className="label">{k === 'done' ? 'Что отметить' : k === 'note' ? 'Текст записки' : 'Название'}</label>
          <input className="input" value={draft.title} onChange={(e) => edit({ title: e.target.value })} />

          {k === 'findtime' && (
            <>
              <label className="label">Сколько времени нужно</label>
              <div className="chips">
                {DURATIONS.map(([v, l]) => (
                  <button key={v} className={`chip ${draft.duration_min === v ? 'on accent' : ''}`} onClick={() => edit({ duration_min: v })}>{l}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="label">С</label>
                  <input className="input" type="date" value={draft.from || todayStr()} onChange={(e) => edit({ from: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="label">По</label>
                  <input className="input" type="date" value={draft.to || ''} onChange={(e) => edit({ to: e.target.value })} />
                </div>
              </div>
              <button className="btn soft block" style={{ marginTop: 12 }} disabled={busy} onClick={findSlots}>
                <CalendarSearch size={17} /> {mate ? `Когда мы с ${mate.first_name} свободны` : 'Когда я свободен'}
              </button>
              {slots && slots.length > 0 && (
                <>
                  <label className="label">Свободные окна — выберите</label>
                  <div className="chips">
                    {slots.map((s) => (
                      <button key={`${s.date}${s.start}`} className="chip" onClick={() => takeSlot(s)}>
                        {dayLabel(s.date)}, {s.start}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {(k === 'cal' || k === 'chore') && (
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="label">{k === 'chore' ? 'Срок' : 'Дата'}</label>
                <input className="input" type="date" value={draft.date || ''} onChange={(e) => edit({ date: e.target.value })} />
              </div>
              {k === 'cal' && (
                <div style={{ width: 120 }}>
                  <label className="label">Время</label>
                  <input className="input" type="time" value={draft.time || ''} onChange={(e) => edit({ time: e.target.value })} />
                </div>
              )}
            </div>
          )}

          {k === 'cal' && (
            <>
              <label className="label">Напомнить</label>
              <div className="chips">
                {REMIND.map(([v, l]) => (
                  <button
                    key={String(v)}
                    className={`chip ${(draft.remind_min ?? null) === v ? 'on accent' : ''}`}
                    onClick={() => edit({ remind_min: v === null ? undefined : v })}
                  >{l}</button>
                ))}
              </div>
            </>
          )}

          {k === 'chore' && draft.date && (
            <>
              <label className="label">Напомнить</label>
              <div className="chips">
                {CHORE_REMIND.map(([v, l]) => (
                  <button key={String(v)} className={`chip ${choreRule === v ? 'on accent' : ''}`} onClick={() => setChoreRule(v)}>{l}</button>
                ))}
              </div>
            </>
          )}

          {k === 'cal' && mate && !target && (
            <div className="switch-row">
              <span><UserPlus size={15} /> Позвать {mate.first_name}</span>
              <Switch on={invite} onChange={setInvite} />
            </div>
          )}

          {k === 'cal' && draft.date && (
            <div className="meta" style={{ marginTop: 10 }}>
              <span><Check size={12} /> {dayLabel(draft.date)}{draft.time ? `, ${draft.time}` : ''}</span>
              {draft.remind_min !== undefined && <span><Bell size={12} /> напомню</span>}
            </div>
          )}
        </div>
      )}

      {!voice && !draft && (
        <div className="notice" style={{ marginTop: 12 }}>
          <Info size={14} /> На iPhone говорите через микрофон на клавиатуре — текст попадёт сюда
        </div>
      )}

      {draft && k !== 'findtime' && (
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={apply}>
          <Send size={17} /> {k === 'done' ? 'Отметить сделанным' : target && k === 'cal' ? 'Дальше' : 'Добавить'}
        </button>
      )}
    </Sheet>
  );
}
