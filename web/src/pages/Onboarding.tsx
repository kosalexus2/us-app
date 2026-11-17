import { useState } from 'react';
import { Heart, Send, UserRound, Users } from 'lucide-react';
import { get, post } from '../api';
import { ERRORS, useToast } from '../components/ui';
import { shareInvite } from '../tg';

/** Экран входа, затем выбор: пригласить партнёра или друга (можно пропустить). */
export default function Onboarding({ botUsername, onDone, existingCode }: { invite?: string | null; botUsername: string | null; onDone: () => void; existingCode?: string }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(existingCode ?? null);
  const toast = useToast();

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз'); } finally { setBusy(false); }
  };

  if (!code) {
    return (
      <div className="center-screen">
        <div className="logo-ring"><Heart size={42} fill="currentColor" /></div>
        <h1>Us App</h1>
        <p>Приветствую вас! Общее пространство для близких: места, дом, вишлист и маленькие сюрпризы.</p>
        <button className="btn primary block" disabled={busy} onClick={() => wrap(async () => { const r = await post('/couple/create'); setCode(r.code); })}>Войти в приложение</button>
      </div>
    );
  }

  const invitePartner = () => {
    if (!botUsername) return toast('Не задан BOT_USERNAME на сервере');
    shareInvite(`https://t.me/${botUsername}/app?startapp=invite_${code}`, 'Заходи в наше пространство в Us App 💛');
  };
  const inviteFriend = () => wrap(async () => {
    if (!botUsername) throw new Error('no_bot');
    const f = await get<{ code: string }>('/friends');
    shareInvite(`https://t.me/${botUsername}/app?startapp=friend_${f.code}`, 'Добавляйся ко мне в друзья в Us App 💛');
  });

  return (
    <div className="center-screen">
      <div className="logo-ring"><Heart size={42} fill="currentColor" /></div>
      <h1>Кого пригласить?</h1>
      <p>Отправьте ссылку в Telegram. Человек увидит приглашение и сам решит, присоединяться ли.</p>
      <button className="btn primary block" disabled={busy} onClick={invitePartner}><UserRound size={18} /> Пригласить партнёра <Send size={16} /></button>
      <button className="btn soft block" style={{ marginTop: 8 }} disabled={busy} onClick={inviteFriend}><Users size={18} /> Пригласить друга</button>
      <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onDone}>Позже</button>
    </div>
  );
}
