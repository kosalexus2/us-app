import { useEffect, useState } from 'react';
import { Heart, Users } from 'lucide-react';
import { get, post } from '../api';
import { Avatar, ERRORS, useToast } from '../components/ui';
import type { User } from '../components/ui';
import { haptic } from '../tg';

type Info = { kind: 'partner' | 'friend'; from: User; full: boolean; self: boolean };

/** Экран «Вас приглашают»: показывает, кто приглашает, и даёт принять или отказаться. */
export default function InviteScreen({ param, onDone }: { param: string; onDone: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    get<Info>(`/invite/${encodeURIComponent(param)}`).then(setInfo).catch((e) => setError(e.message || 'error'));
  }, [param]);

  const accept = async () => {
    if (!info) return;
    setBusy(true);
    try {
      if (info.kind === 'partner') await post('/couple/join', { code: param });
      else await post('/friends/join', { code: param });
      haptic.ok();
      toast(info.kind === 'partner' ? `Вы теперь пара с ${info.from.first_name} 💛` : `${info.from.first_name} теперь у вас в друзьях`);
      onDone();
    } catch (e: any) {
      toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз');
      setBusy(false);
    }
  };

  if (error || (info && (info.full || info.self))) {
    const text = error ? ERRORS[error] || 'Приглашение недействительно' : info!.self ? 'Это ваша собственная ссылка' : 'В этом пространстве уже двое';
    return (
      <div className="center-screen">
        <div className="logo-ring"><Heart size={42} fill="currentColor" /></div>
        <h1>{text}</h1>
        <button className="btn primary block" onClick={onDone}>Продолжить</button>
      </div>
    );
  }
  if (!info) return <div className="center-screen"><div className="skeleton" style={{ width: 200, height: 24 }} /></div>;

  const partner = info.kind === 'partner';
  return (
    <div className="center-screen">
      <Avatar user={info.from} size="lg" />
      <h1 style={{ marginTop: 16 }}>{info.from.first_name} {partner ? 'приглашает вас стать партнёром' : 'приглашает вас в друзья'}</h1>
      <p>
        {partner
          ? 'Общее пространство для двоих: места, дом, вишлист и маленькие сюрпризы.'
          : 'Вы будете видеть друг друга в Us App и сможете делиться планами и вишлистами.'}
      </p>
      <button className="btn primary block" disabled={busy} onClick={accept}>
        {partner ? <Heart size={18} /> : <Users size={18} />} {partner ? 'Стать партнёром' : 'Стать друзьями'}
      </button>
      <button className="btn ghost block" style={{ marginTop: 8 }} disabled={busy} onClick={onDone}>Не сейчас</button>
    </div>
  );
}
