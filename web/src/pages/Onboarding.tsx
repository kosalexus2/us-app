import { useState } from 'react';
import { Heart, Link2, Send } from 'lucide-react';
import { post } from '../api';
import { ERRORS, useToast } from '../components/ui';
import { shareInvite } from '../tg';

/** Shown until the user belongs to a couple. Either accept an invite or create a space and invite the partner. */
export default function Onboarding({ invite, botUsername, onDone, existingCode }: { invite: string | null; botUsername: string | null; onDone: () => void; existingCode?: string }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(existingCode ?? null);
  const toast = useToast();

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e: any) { toast(ERRORS[e.message] || 'Не получилось, попробуйте ещё раз'); } finally { setBusy(false); }
  };

  if (invite) {
    return (
      <div className="center-screen">
        <div className="logo-ring"><Heart size={42} fill="currentColor" /></div>
        <h1>Вас пригласили</h1>
        <p>Присоединяйтесь к общему пространству двоих: места, дом, вишлист и маленькие сюрпризы.</p>
        <button className="btn primary block" disabled={busy} onClick={() => wrap(async () => { await post('/couple/join', { code: invite }); onDone(); })}>Присоединиться</button>
        <button className="btn ghost block" style={{ marginTop: 8 }} disabled={busy} onClick={() => wrap(async () => { await post('/couple/create'); onDone(); })}>Создать своё пространство</button>
      </div>
    );
  }

  if (code) {
    const link = botUsername ? `https://t.me/${botUsername}?startapp=invite_${code}` : '';
    return (
      <div className="center-screen">
        <div className="logo-ring"><Link2 size={40} /></div>
        <h1>Пригласите партнёра</h1>
        <p>Отправьте ссылку — после перехода вы окажетесь в одном пространстве.</p>
        {link && <div className="invite-box">{link}</div>}
        <button className="btn primary block" disabled={!link} onClick={() => shareInvite(link, 'Заходи в наше пространство в Us App 💛')}><Send size={18} /> Отправить в Telegram</button>
        <button className="btn ghost block" style={{ marginTop: 8 }} onClick={onDone}>Продолжить пока одному</button>
        {!link && <p style={{ fontSize: 13, marginTop: 16 }}>Не задан BOT_USERNAME на сервере — ссылку-приглашение собрать нельзя.</p>}
      </div>
    );
  }

  return (
    <div className="center-screen">
      <div className="logo-ring"><Heart size={42} fill="currentColor" /></div>
      <h1>Us App</h1>
      <p>Пространство для вас двоих: места, дом, вишлист и маленькие сюрпризы друг для друга.</p>
      <button className="btn primary block" disabled={busy} onClick={() => wrap(async () => { const r = await post('/couple/create'); setCode(r.code); })}>Начать</button>
    </div>
  );
}
