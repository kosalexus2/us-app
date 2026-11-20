import { ReactNode, useRef, useState } from 'react';
import { haptic } from '../tg';

type Act = { label: string; icon?: ReactNode; tone?: 'ok' | 'danger' | 'accent' };

/** Карточка, которую можно смахнуть: вправо одно действие, влево другое. Работает пальцем и мышью. */
export default function SwipeRow({ children, right, left, onRight, onLeft, disabled }: {
  children: ReactNode; right?: Act; left?: Act; onRight?: () => void; onLeft?: () => void; disabled?: boolean;
}) {
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const st = useRef({ x: 0, y: 0, lock: '' as '' | 'h' | 'v', passed: false });
  const LIMIT = 84;

  const down = (e: React.PointerEvent) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    st.current = { x: e.clientX, y: e.clientY, lock: '', passed: false };
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.x && !s.y) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.lock) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.lock = Math.abs(mx) > Math.abs(my) ? 'h' : 'v';
      if (s.lock === 'h') { setDrag(true); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }
    }
    if (s.lock !== 'h') return;
    let v = mx;
    if ((v > 0 && !onRight) || (v < 0 && !onLeft)) v = v / 5;
    v = Math.max(-140, Math.min(140, v));
    const past = Math.abs(v) >= LIMIT;
    if (past && !s.passed) haptic.tap();
    s.passed = past;
    setDx(v);
  };
  const up = () => {
    const s = st.current;
    const v = dx;
    st.current = { x: 0, y: 0, lock: '', passed: false };
    setDrag(false);
    setDx(0);
    if (s.lock !== 'h') return;
    if (v >= LIMIT && onRight) onRight();
    else if (v <= -LIMIT && onLeft) onLeft();
  };

  const show = dx > 0 ? right : dx < 0 ? left : null;
  const ready = Math.abs(dx) >= LIMIT;
  return (
    <div className="swipe">
      {show && (
        <div className={`swipe-bg ${dx > 0 ? 'r' : 'l'} ${show.tone || 'accent'} ${ready ? 'ready' : ''}`}>
          {show.icon}<span>{show.label}</span>
        </div>
      )}
      <div
        className={`swipe-fg ${drag ? 'drag' : ''}`}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  );
}
