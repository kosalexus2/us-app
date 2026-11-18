import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Info, Mic, Send, Sparkles } from 'lucide-react';
import { post } from '../api';
import { ERRORS, Sheet, useToast } from './ui';
import { KIND_LABEL, listen, parseCommand, speechSupported } from '../assistant';
import type { Parsed } from '../assistant';
import { fmtDate } from '../util';
import { haptic } from '../tg';
import type { PersonData } from '../pages/Person';

const EXAMPLES = [
  'Поход в зал 27 ноября в 17:00, напомни за час',
  'Ужин с мамой завтра в 19:00',
  'Купить молоко',
  'Хочу наушники + ссылка',
];

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
  const [text, setText] = useState('');
  const [rec, setRec] = useState(false);
  const [busy, setBusy] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const parsed = text.trim() ? parseCommand(text) : null;
  const voice = speechSupported();

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => { clearTimeout(t); stopRef.current?.(); };
  }, []);

  const mic = () => {
    if (rec) { stopRef.current?.(); setRec(false); return; }
    haptic.tap();
    const stop = listen(
      (t) => setText(t),
      (err) => {
        setRec(false);
        if (err && err !== 'aborted' && err !== 'no-speech') toast(err === 'not-allowed' ? 'Доступ к микрофону запрещён' : 'Не расслышал, попробуйте ещё раз');
      },
    );
    if (!stop) return toast('Здесь нет распознавания речи — нажмите микрофон на клавиатуре');
    stopRef.current = stop;
    setRec(true);
  };

  const apply = async () => {
    if (!parsed) return;
    // встреча в карточке человека — открываем форму, чтобы было видно, что именно уйдёт
    if (parsed.kind === 'cal' && person && onParsed) {
      onParsed(parsed);
      onClose();
      return;
    }
    setBusy(true);
    try {
      switch (parsed.kind) {
        case 'cal':
          await post('/cal', { title: parsed.title, date: parsed.date || new Date().toISOString().slice(0, 10), time: parsed.time || null, remind_min: parsed.remind_min ?? null });
          break;
        case 'wish':
        case 'recipe': {
          let image: string | null = null;
          let title = parsed.title;
          let price: string | null = null;
          if (parsed.url) {
            try {
              const p = await post<{ url: string; title: string; image: string; price: string }>('/link-preview', { url: parsed.url });
              image = p.image || null;
              price = p.price || null;
              if (p.title && (!title || title.length < 3)) title = p.title;
            } catch { /* превью необязательно */ }
          }
          if (parsed.kind === 'recipe') await post('/recipes', { title, note: parsed.url || null, image_url: image });
          else await post('/wishes', { kind: /посмотр|фильм|сериал/i.test(parsed.raw) ? 'watch' : 'gift', title, url: parsed.url || null, image_url: image, price });
          break;
        }
        case 'shopping': await post('/shopping', { title: parsed.title }); break;
        case 'chore': await post('/chores', { title: parsed.title, due_date: parsed.date || null }); break;
        case 'place': await post('/places', { title: parsed.title }); break;
        case 'note': await post('/notes', { text: parsed.title }); break;
      }
      haptic.ok();
      toast(`${KIND_LABEL[parsed.kind]}: готово`);
      onDone?.();
      onClose();
    } catch (e: any) {
      toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const target = person && person.relation !== 'self' ? person.user.first_name : null;

  return (
    <Sheet title="Помощник" onClose={onClose}>
      <p className="hint" style={{ marginTop: 2 }}>
        {target ? `Скажите, что предложить ${target}` : 'Скажите обычной фразой, остальное я пойму сам'}
      </p>

      <div className={`mic-row ${rec ? 'rec' : ''}`}>
        <button className={`mic ${rec ? 'on' : ''}`} onClick={mic} aria-label={rec ? 'Остановить' : 'Говорить'}>
          <Mic size={24} />
        </button>
        <div className="grow">
          <textarea
            ref={inputRef}
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={voice ? 'Нажмите микрофон или напишите' : 'Нажмите микрофон на клавиатуре и надиктуйте'}
            style={{ minHeight: 76 }}
          />
        </div>
      </div>

      {!text && (
        <div className="chips" style={{ marginTop: 10 }}>
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" onClick={() => setText(e)}>{e}</button>
          ))}
        </div>
      )}

      {parsed && (
        <div className="card parsed" style={{ marginTop: 14 }}>
          <div className="badge">{KIND_LABEL[parsed.kind]}{target && parsed.kind === 'cal' ? ` · ${target}` : ''}</div>
          <h3>{parsed.title}</h3>
          <div className="meta">
            {parsed.date && <span><Check size={12} /> {fmtDate(parsed.date)}{parsed.time ? `, ${parsed.time}` : ''}</span>}
            {parsed.remind_min !== undefined && <span><Bell size={12} /> напомню</span>}
            {parsed.url && <span>ссылка</span>}
          </div>
        </div>
      )}

      {!voice && (
        <div className="notice" style={{ marginTop: 12 }}>
          <Info size={14} /> На iPhone говорите через микрофон на клавиатуре — результат попадёт сюда
        </div>
      )}

      <button className="btn primary block" style={{ marginTop: 16 }} disabled={!parsed || busy} onClick={apply}>
        <Send size={17} /> {target && parsed?.kind === 'cal' ? 'Дальше' : 'Добавить'}
      </button>
    </Sheet>
  );
}
