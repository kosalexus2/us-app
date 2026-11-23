import { useState } from 'react';
import { Calendar, Pencil, Plus, Users } from 'lucide-react';
import { patch, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Empty, Skeletons, useToast } from '../components/ui';
import SwipeRow from '../components/SwipeRow';
import { fmtDate } from '../util';
import { haptic } from '../tg';
import type { FriendsStatus, Meeting, Rsvp } from '../types';
import { RSVP_LABEL } from './Meetings';
import { FriendsExtra } from '../components/Extras';

export default function FriendsHome() {
  const { boot, openPerson, openMeeting } = useApp();
  const toast = useToast();
  const { data: fr, reload: reloadFr } = useResource<FriendsStatus>('/friends/status', 15000);
  const { data: ms, reload } = useResource<Meeting[]>('/meetings', 6000);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');

  const saveStatus = async () => {
    await patch('/me/status', { status });
    setEditing(false);
    reloadFr();
  };
  const answer = async (m: Meeting, r: Rsvp) => {
    if (m.status !== 'set') return openMeeting(m.id);
    haptic.ok();
    await post(`/meetings/${m.id}/rsvp`, { rsvp: r });
    toast(`${RSVP_LABEL[r]}: ${m.title}`);
    reload();
  };

  const next = ms?.find((m) => m.status === 'set') ?? ms?.[0];
  return (
    <div className="scroll">
      <h1 className="h-title">Друзья</h1>
      <p className="sub">Встречи, планы и статусы компании</p>

      <div className="friends-row">
        <button className="fr" onClick={() => openPerson(boot.me.id)}>
          <Avatar user={boot.me} dot />
          <span className="n">Я</span>
          <span className="st">{fr?.me.status || 'статус'}</span>
        </button>
        {fr?.friends.map((u) => (
          <button className="fr" key={u.id} onClick={() => openPerson(u.id)}>
            <Avatar user={u} dot />
            <span className="n">{u.first_name}</span>
            <span className="st">{u.status || (u.online ? 'в сети' : '')}</span>
          </button>
        ))}
      </div>

      {editing ? (
        <div className="field flat" style={{ marginTop: 12 }}>
          <input value={status} maxLength={60} autoFocus placeholder="Чем занят? Например, на тренировке" onChange={(e) => setStatus(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveStatus()} />
          <button className="btn primary sm" onClick={saveStatus}>OK</button>
        </div>
      ) : (
        <button className="link" style={{ marginTop: 10, display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={() => { setStatus(fr?.me.status || ''); setEditing(true); }}>
          <Pencil size={14} /> Мой статус
        </button>
      )}

      <div className="sec-head">
        <h2>Встречи</h2>
        <button className="link" onClick={() => openMeeting('new')}>+ Новая</button>
      </div>

      {!ms ? <Skeletons n={2} /> : ms.length === 0 ? (
        <Empty
          icon={<Users size={26} />} title="Пока нет встреч"
          text={fr && fr.friends.length ? 'Позовите друзей: выберите дату или запустите опрос' : 'Сначала добавьте друзей кнопкой в верхней панели'}
          action={<button className="btn primary" onClick={() => openMeeting('new')}><Plus size={18} /> Новая встреча</button>}
        />
      ) : (
        <>
          {next && next.status === 'set' && (
            <button className="card next-meet" onClick={() => openMeeting(next.id)}>
              <span className="eyebrow" style={{ margin: 0 }}>Ближайшая встреча</span>
              <b>{next.title}</b>
              <span className="sub">{next.date ? `${fmtDate(next.date)}${next.time ? `, ${next.time}` : ''}` : ''}{next.place ? ` · ${next.place}` : ''}</span>
              <span className="mt-count" style={{ margin: '8px 0 0' }}><b>{next.counts.yes}</b> идут · <b>{next.counts.maybe}</b> может быть</span>
            </button>
          )}
          <p className="hint" style={{ margin: '14px 0 8px' }}>Свайп вправо: иду, влево: не иду</p>
          <div className="stack">
            {ms.map((m) => (
              <SwipeRow
                key={m.id}
                disabled={m.status !== 'set'}
                right={{ label: 'Иду', tone: 'ok' }} left={{ label: 'Не иду', tone: 'danger' }}
                onRight={() => answer(m, 'yes')} onLeft={() => answer(m, 'no')}
              >
                <button className="card meet" onClick={() => openMeeting(m.id)}>
                  <span className="round-ic"><Calendar size={18} /></span>
                  <span className="grow">
                    <b>{m.title}</b>
                    <span className="sub">{m.status === 'poll' ? 'Опрос дат: ответьте' : `${fmtDate(m.date!)}${m.time ? `, ${m.time}` : ''}`}</span>
                  </span>
                  <span className={`badge ${m.my_rsvp === 'yes' ? '' : 'gray'}`}>{m.my_rsvp ? RSVP_LABEL[m.my_rsvp] : m.status === 'poll' ? 'опрос' : 'ждём ответ'}</span>
                </button>
              </SwipeRow>
            ))}
          </div>
        </>
      )}
      <FriendsExtra onMeet={() => openMeeting('new')} />
    </div>
  );
}
