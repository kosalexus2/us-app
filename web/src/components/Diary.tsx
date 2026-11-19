import { useState } from 'react';
import { Eye, Lock, Pencil, Trash2 } from 'lucide-react';
import { del, patch, post, useResource } from '../api';
import { Skeletons, Switch, useToast } from './ui';
import { useApp } from '../ctx';
import type { DiaryEntry } from '../types';
import { haptic } from '../tg';
import { MOODS, MOOD_EMOJI } from '../util';

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const parse = (day: string) => new Date(`${day}T00:00:00`);
const dayLabel = (day: string) => { const d = parse(day); return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`; };
const shortLabel = (day: string) => { const d = parse(day); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const monthLabel = (day: string) => { const d = parse(day); const y = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`; return `${MONTHS_NOM[d.getMonth()]}${y}`; };

/** Личный дневник: записи видит только автор, пока он не нажмёт «Показать партнёру». */
export default function Diary() {
  const { boot } = useApp();
  const partner = boot.partner;
  const { data, reload } = useResource<DiaryEntry[]>('/diary', 8000);
  const [editor, setEditor] = useState<{ entry: DiaryEntry | null; mood: string | null } | null>(null);
  const [mood, setMood] = useState<string | null>(null);

  if (!data) return <Skeletons n={2} />;

  const groups: [string, DiaryEntry[]][] = [];
  for (const e of data) {
    const m = monthLabel(e.day);
    const g = groups[groups.length - 1];
    if (g && g[0] === m) g[1].push(e); else groups.push([m, [e]]);
  }

  return (
    <>
      <p className="hint" style={{ marginTop: 14 }}><Lock size={13} /> Только вы{partner ? `: ${partner.first_name} видит запись, только если вы её откроете` : ''}</p>

      <div className="card diary-compose" style={{ marginTop: 12 }}>
        <h3>Как прошёл день?</h3>
        <div className="moods">
          {MOODS.map(([k, emoji]) => (
            <button key={k} className={`mood ${mood === k ? 'on' : ''}`} onClick={() => { haptic.tap(); setMood(mood === k ? null : k); }} aria-label={k}>{emoji}</button>
          ))}
        </div>
        <button className="btn primary block" onClick={() => setEditor({ entry: null, mood })}>Написать</button>
      </div>

      {groups.map(([m, list]) => (
        <div key={m}>
          <p className="month-label">{m}</p>
          <div className="stack">
            {list.map((e) => (
              <div key={e.id} className="card entry" onClick={e.mine ? () => setEditor({ entry: e, mood: e.mood }) : undefined} style={e.mine ? undefined : { cursor: 'default' }}>
                <div className="top">
                  <span>{e.mine ? dayLabel(e.day) : `${e.from_name?.split(' ')[0]} · ${shortLabel(e.day)}`}</span>
                  <span className="em">{e.mood ? MOOD_EMOJI[e.mood] : ''}</span>
                </div>
                <div className="text">{e.body}</div>
                <div className="meta">
                  {e.mine && e.shared && <span className="shared"><Eye size={12} /> видно {partner?.first_name || 'партнёру'}</span>}
                  {!e.mine && <span className="shared"><Eye size={12} /> поделился(ась) с вами</span>}
                  {e.mine && <span><Pencil size={12} /> изменить</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {!data.length && <p className="sub" style={{ textAlign: 'center', marginTop: 28 }}>Первая запись появится здесь</p>}

      {editor && <DiaryEditor entry={editor.entry} initialMood={editor.mood} partnerName={partner?.first_name || null} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMood(null); reload(); }} />}
    </>
  );
}

function DiaryEditor({ entry, initialMood, partnerName, onClose, onSaved }: { entry: DiaryEntry | null; initialMood: string | null; partnerName: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState(entry?.body ?? '');
  const [mood, setMood] = useState<string | null>(initialMood);
  const [shared, setShared] = useState(entry?.shared ?? false);
  const [busy, setBusy] = useState(false);
  const day = entry?.day ?? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      if (entry) await patch(`/diary/${entry.id}`, { body, mood, shared });
      else await post('/diary', { body, mood, shared, day });
      haptic.ok();
      onSaved();
    } catch {
      toast('Не получилось сохранить, попробуйте ещё раз');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!entry || !window.confirm('Удалить запись? Это нельзя отменить.')) return;
    try { await del(`/diary/${entry.id}`); onSaved(); } catch { toast('Не получилось удалить'); }
  };

  return (
    <div className="diary-editor" role="dialog" aria-modal="true">
      <div className="bar">
        <button className="cancel" onClick={onClose}>Отмена</button>
        <span>{shortLabel(day)}</span>
        <button className="done" onClick={save} disabled={!body.trim() || busy}>Готово</button>
      </div>
      <div className="body">
        <div className="moods">
          {MOODS.map(([k, emoji]) => (
            <button key={k} className={`mood ${mood === k ? 'on' : ''}`} onClick={() => setMood(mood === k ? null : k)} aria-label={k}>{emoji}</button>
          ))}
        </div>
        <textarea autoFocus={!entry} value={body} placeholder="Как прошёл день?" onChange={(e) => setBody(e.target.value)} maxLength={4000} />
        {partnerName && (
          <div className="share">
            <div className="switch-row">
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 16 }}><Eye size={18} color="var(--label-2)" /> Показать {partnerName}</span>
              <Switch on={shared} onChange={setShared} />
            </div>
            <p className="hint">По умолчанию запись видите только вы</p>
          </div>
        )}
        {entry && <button className="del" onClick={remove}><Trash2 size={18} /> Удалить запись</button>}
      </div>
    </div>
  );
}
