import { useState } from 'react';
import { CalendarHeart, Heart, Lock, Sparkles, UserPlus, Utensils, Cake, Plane, Calendar } from 'lucide-react';
import { post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Sheet, Skeletons, useToast } from '../components/ui';
import type { Today } from '../types';
import { ago, fmtDate, inDaysLabel, MOODS, MOOD_EMOJI, togetherSpan } from '../util';
import { haptic, shareInvite } from '../tg';

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
  const inviteUrl = boot.bot_username && boot.couple ? `https://t.me/${boot.bot_username}/app?startapp=invite_${boot.couple.invite_code}` : '';

  return (
    <div className="scroll">
      <div style={{ height: 16 }} />
      {!partner && (
        <div className="banner">
          <UserPlus size={20} color="var(--accent)" />
          <div className="grow">Партнёр ещё не присоединился</div>
          <button className="btn soft sm" onClick={() => (inviteUrl ? shareInvite(inviteUrl, 'Заходи в наше пространство в Us App 💛') : toast('Укажите BOT_USERNAME на сервере'))}>
            Пригласить
          </button>
        </div>
      )}

      <div className="card">
        <div className="hero">
          <div>
            {data.days_together != null ? (
              <>
                <Heart size={18} fill="var(--accent)" color="var(--accent)" />
                <div className="num">Вместе {togetherSpan(data.start_date!, boot.today).map((p, i) => <span key={i}>{i ? ' ' : ''}<b>{p.n}</b> {p.word}</span>)}</div>
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

      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ fontSize: 17, fontWeight: 600 }}>Как ты сегодня?</h3>
        <div className="moods" role="group" aria-label="Настроение">
          {MOODS.map(([k, emoji]) => (
            <button key={k} className={`mood ${data.mood.me === k ? 'on' : ''}`} onClick={() => setMood(k)} aria-label={k}>{emoji}</button>
          ))}
        </div>
        {partner && data.mood.partner && (
          <p className="mood-note">{partner.first_name} сегодня: {MOOD_EMOJI[data.mood.partner] || ''}</p>
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
            <input className="input" value={answer} placeholder="Ваш ответ…" onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendAnswer()} />
            <button className="btn primary block" style={{ marginTop: 12 }} onClick={sendAnswer} disabled={!answer.trim()}>Ответить</button>
            <p className="hint" style={{ justifyContent: 'center' }}><Lock size={13} /> Ответ {partner?.first_name || 'партнёра'} откроется, когда ответите оба{q.partner_answered ? ' — он уже ответил(а)' : ''}</p>
          </>
        )}
      </div>

      <div className="sec-head">
        <h2>Ближайшее</h2>
        <button className="link" onClick={() => go('together', 'calendar')}>Всё</button>
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

      <div className="sec-head"><h2>Что нового</h2></div>
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
