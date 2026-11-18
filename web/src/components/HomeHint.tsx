import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { addToHomeScreen, homeScreenStatus } from '../tg';

const KEY = 'homeHintHidden';

/** Небольшая плашка «Добавить на главный экран»: показывается, пока ярлык не добавлен и плашку не закрыли. */
export default function HomeHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch {}
    homeScreenStatus((s) => setShow(s === 'missed' || s === 'unknown'));
  }, []);
  if (!show) return null;
  const hide = () => { try { localStorage.setItem(KEY, '1'); } catch {} setShow(false); };
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 16px 0' }}>
      <Smartphone size={22} />
      <div style={{ flex: 1, fontSize: 14 }}>Добавьте Us App на главный экран, чтобы открывать как обычное приложение</div>
      <button className="btn soft sm" onClick={() => { addToHomeScreen(); hide(); }}>Добавить</button>
      <button className="btn ghost sm" aria-label="Закрыть" onClick={hide}><X size={16} /></button>
    </div>
  );
}
