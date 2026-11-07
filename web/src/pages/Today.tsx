import { useState } from 'react';
import { ArrowUp, CalendarHeart, Heart, Lock, Meh, Smile, Frown, Sparkles, UserPlus, Utensils, Cake, Plane, Calendar } from 'lucide-react';
import { post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Sheet, Skeletons, useToast } from '../components/ui';
import type { Today } from '../types';
import { ago, fmtDate, fmtLongDate, greeting, inDaysLabel, plural } from '../util';
import { haptic, shareInvite } from '../tg';

const MOODS: [string, string, any][] = [
  ['great', 'Отлично', Smile],
  ['ok', 'Норм', Meh],
  ['sad', 'Грустно', Frown],
];
const MOOD_WORD: Record<string, string> = { great: 'отлично', ok: 'нормально', sad: 'грустно' };

export default function TodayPage() {
  const { boot, go, reloadBoot } = useApp();
  const { data, reload } = useResource<Today>('/today', 4000);
  const [answer, setAnswer] = useState('');
  const [dateSheet, setDateSheet] = useState(false);
  const toast = useToast();
  const { me, partner } = boot;

  if (!data) return <div className="scroll"><Skeletons n={3} /></div>;

  const setMood = async (m: string) => {
    haptic.tap();
    await post('/mood', { mood: m });
    reload();
  };
  const sendAnswer = async () => {
    if (!answer.trim()) return;
    await post('/answer', { text: answer });
    setAnswer('');
    haptic.ok();
    reload();
  };
  const q = data.question;
  const inviteUrl = boot.bot_username && boot.couple ? `https://t.me/${boot.bot_username}?startapp=invite_${boot.couple.invite_code}` : '';

  return (
    <div className="scroll">
      <p className="eyebrow">{fmtLongDate()}</p>
      <h1 className="h-display">{greeting()}, {me.first_name}</h1>

      {!partner && (
        <div className="banner">
          <UserPlus size={20} color="var(--accent)" />
          <div className="grow">Партнёр ещё не присоединился</div>
          <button className="btn soft sm" onClick={() => (inviteUrl ? shareInvite(inviteUrl, 'Заходи в наше пространство в Us App 💛') : toast('Укажите BOT_USERNAME на сервере'))}>
            Пригласить
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="hero">
          <div>
            {data.days_together != null ? (
              <>
                <div className="num">{data.days_together}</div>
                <div className="cap">{plural(data.days_together, 'день', 'дня', 'дней')} вместе</div>
                <div className="since">с {fmtDate(data.start_date!)}</div>
              </>
            ) : (
              <>
                <div className="cap" style={{ marginTop: 0 }}>Вы вместе с…</div>
                <button className="btn soft sm" style={{ marginTop: 10 }} onClick={() => setDateSheet(true)}>
                  <CalendarHeart size={16} /> Указать дату
                </button>
              </>
            )}
          </div>
          <div className="pair-pill">
            <Avatar user={me} dot />
            <Avatar user={partner} dot />
          </div>
        </div>

        <div className="moods" role="group" aria-label="Настроение">
          {MOODS.map(([k, label, Icon]) => (
            <button key={k} className={`mood ${data.mood.me === k ? 'on' : ''}`} onClick={() => setMood(k)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
        {partner && data.mood.partner && (
          <p className="mood-note">{partner.first_name} сегодня: {MOOD_WORD[data.mood.partner]}</p>
        )}
      </div>

      <div className="card qcard" style={{ marginTop: 12 }}>
        <div className="tag"><Sparkles size={14} /> Вопрос дня</div>
        <p className="q">{q.text}</p>
        {q.my_answer ? (
          <>
            <div className="answer-bubble"><b>Ты</b>{q.my_answer}</div>
            {q.partner_answer ? (
              <div className="answer-bubble"><b>{partner?.first_name}</b>{q.partner_answer}</div>
            ) : (
              <p className="hint"><Lock size={13} /> {partner ? `${partner.first_name} ещё отвечает` : 'Ответ партнёра появится здесь'}</p>
            )}
          </>
        ) : (
          <>
            <div className="field flat">
              <input value={answer} placeholder="Напиши свой ответ…" onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendAnswer()} />
              <button className="send" onClick={sendAnswer} disabled={!answer.trim()} aria-label="Отправить"><ArrowUp size={20} /></button>
            </div>
            <p className="hint"><Lock size={13} /> Ответ откроется, когда ответите оба{q.partner_answered ? ` — ${partner?.first_name} уже ответил(а)` : ''}</p>
          </>
        )}
      </div>

      <div className="sec-head">
        <h2>Скоро</h2>
        <button className="link" onClick={() => go('together', 'calendar')}>Все планы</button>
      </div>
      {data.upcoming.length ? (
        <div className="scroller">
          {data.upcoming.map((e, i) => (
            <div key={i} className="card ev">
              <div className="top">
                <span className={`round-ic ${e.kind === 'anniversary' ? '' : 'gray'}`}>
                  {e.kind === 'anniversary' ? <Cake size={18} /> : e.kind === 'trip' ? <Plane size={18} /> : <Utensils size={18} />}
                </span>
                <span className="badge">{inDaysLabel(e.in_days)}</span>
              </div>
              <h3>{e.title}</h3>
              <p>{fmtDate(e.date)}{e.time ? `, ${e.time}` : ''}</p>
            </div>
          ))}
        </div>
      ) : (
        <button className="card block" style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 12, alignItems: 'center' }} onClick={() => go('together', 'calendar')}>
          <span className="round-ic"><Calendar size={18} /></span>
          <span><b>Планов пока нет</b><br /><span className="sub">Добавьте событие или поездку</span></span>
        </button>
      )}

      <div className="sec-head"><h2>Недавно</h2></div>
      {data.activity.length ? (
        <div className="card feed" style={{ padding: '4px 16px' }}>
          {data.activity.map((a) => (
            <div className="row" key={a.id}>
              <Avatar user={{ name: a.name, first_name: a.name.split(' ')[0], photo_url: a.photo_url }} size="lg" />
              <div>
                <div className="t">{a.mine ? 'Ты' : a.name.split(' ')[0]} {a.text}</div>
                <div className="m">{ago(a.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><p className="sub" style={{ textAlign: 'center' }}><Heart size={14} style={{ verticalAlign: -2 }} /> Здесь будут появляться ваши общие действия</p></div>
      )}

      {dateSheet && <DateSheet onClose={() => setDateSheet(false)} onSaved={() => { setDateSheet(false); reload(); reloadBoot(); }} />}
    </div>
  );
}

function DateSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState('');
  return (
    <Sheet title="Когда вы вместе?" onClose={onClose}>
      <p className="sub">Дата начала отношений — от неё считаются дни и годовщина.</p>
      <label className="label">Дата</label>
      <input className="input" type="date" value={d} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setD(e.target.value)} />
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!d} onClick={async () => { await post('/couple/start-date', { date: d }); onSaved(); }}>
        Сохранить
      </button>
    </Sheet>
  );
}
