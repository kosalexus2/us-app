import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, UserPlus, Users } from 'lucide-react';
import { del, post, useResource } from '../api';
import { useApp } from '../ctx';
import { Avatar, Sheet, useToast } from './ui';
import type { User } from './ui';
import { haptic, shareInvite, startParam } from '../tg';

type Friend = User & { username: string | null };
type FriendsData = { code: string; friends: Friend[] };

// Открыли по ссылке t.me/<bot>/app?startapp=friend_<код>: добавляем в друзья один раз при запуске.
const joinParam = (() => {
  const p = startParam() || '';
  return p.startsWith('friend_') ? p : null;
})();
let joinPromise: Promise<any> | null = joinParam
  ? post('/friends/join', { code: joinParam }).catch((e: any) => ({ error: e?.message || 'error' }))
  : null;

export function FriendsButton() {
  const { boot } = useApp();
  const [open, setOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const p = joinPromise;
    if (!p) return;
    joinPromise = null;
    p.then((r) => {
      if (r?.friend) toast(`${r.friend.first_name} теперь у вас в друзьях`);
      else if (r?.error === 'invalid_code') toast('Приглашение недействительно');
      else if (r?.error === 'self') toast('Это ваша собственная ссылка');
    });
  }, [toast]);

  return (
    <>
      <button className="btn soft sm" style={{ marginRight: 10 }} onClick={() => { haptic.tap(); setOpen(true); }} aria-label="Пара и друзья">
        <Users size={16} /> Друзья
      </button>
      {open && createPortal(<FriendsSheet onClose={() => setOpen(false)} meId={boot.me.id} />, document.body)}
    </>
  );
}

function Row({ user, sub, right }: { user: Partial<User>; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="li">
      <Avatar user={user} dot />
      <div className="grow">
        <div className="title">{user.name}</div>
        {sub && <div style={{ fontSize: 13, color: 'var(--label-2)' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function FriendsSheet({ onClose }: { onClose: () => void; meId: number }) {
  const { boot } = useApp();
  const { data, reload } = useResource<FriendsData>('/friends', 8000);
  const toast = useToast();
  const link = data && boot.bot_username ? `https://t.me/${boot.bot_username}/app?startapp=friend_${data.code}` : '';

  const remove = async (f: Friend) => {
    if (!window.confirm(`Убрать ${f.first_name} из друзей?`)) return;
    try {
      await del(`/friends/${f.id}`);
      reload();
    } catch {
      toast('Не получилось, попробуйте ещё раз');
    }
  };

  return (
    <Sheet title="Пара и друзья" onClose={onClose}>
      <p className="eyebrow">Пара</p>
      <div className="list">
        <Row user={boot.me} sub="Это вы" />
        {boot.partner ? (
          <Row user={boot.partner} sub={boot.partner.online ? 'в сети' : undefined} />
        ) : (
          <div className="li"><div className="grow" style={{ color: 'var(--label-2)' }}>Партнёр ещё не присоединился</div></div>
        )}
      </div>

      <div className="sec-head" style={{ marginTop: 22 }}>
        <h2>Друзья{data ? ` · ${data.friends.length}` : ''}</h2>
      </div>
      {data && data.friends.length > 0 ? (
        <div className="list">
          {data.friends.map((f) => (
            <Row
              key={f.id}
              user={f}
              sub={f.username ? `@${f.username}` : undefined}
              right={<button className="icon-btn" onClick={() => remove(f)} aria-label="Убрать из друзей"><Trash2 size={16} /></button>}
            />
          ))}
        </div>
      ) : (
        <p className="hint" style={{ margin: '0 0 12px' }}>Пока никого. Отправьте другу ссылку, и он появится здесь.</p>
      )}

      <button
        className="btn primary block"
        style={{ marginTop: 16 }}
        disabled={!link}
        onClick={() => shareInvite(link, 'Добавляйся ко мне в друзья в Us App 💛')}
      >
        <UserPlus size={18} /> Пригласить друга
      </button>
    </Sheet>
  );
}
