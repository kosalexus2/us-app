import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X } from 'lucide-react';

export type User = { id: number; name: string; first_name: string; photo_url: string | null; online: boolean };

export function Avatar({ user, size, dot }: { user?: Partial<User> | null; size?: 'sm' | 'lg'; dot?: boolean }) {
  const letter = (user?.first_name || user?.name || '?').trim()[0]?.toUpperCase() || '?';
  return (
    <span className={`av ${size || ''}`}>
      {user?.photo_url ? <img src={user.photo_url} alt="" referrerPolicy="no-referrer" /> : letter}
      {dot && user?.online && <span className="dot" />}
    </span>
  );
}

export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        <div className="head">
          {title ? <h2>{title}</h2> : <span />}
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic">{icon}</div>
      <h3>{title}</h3>
      {text && <p style={{ marginBottom: action ? 16 : 0 }}>{text}</p>}
      {action}
    </div>
  );
}

export const Skeletons = ({ n = 3 }: { n?: number }) => (
  <div className="stack" style={{ marginTop: 16 }}>
    {Array.from({ length: n }).map((_, i) => <div key={i} className="skeleton" />)}
  </div>
);

// ---- toast ----
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export const ERRORS: Record<string, string> = {
  invalid_code: 'Приглашение недействительно',
  couple_full: 'В этом пространстве уже двое',
  already_in_couple: 'Вы уже состоите в другом пространстве',
  unauthorized: 'Откройте приложение из Telegram',
};
