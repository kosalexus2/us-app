import { ReactNode, useRef, useState } from 'react';
import { GripVertical, Pencil, Trash2 } from 'lucide-react';
import { Sheet, Switch, useToast } from './ui';
import { haptic } from '../tg';

// Общие кирпичики для правки: форма с полями, кнопки «изменить/удалить» и перетаскивание списков.

export type Field = {
  k: string;
  label: string;
  type?: 'text' | 'textarea' | 'date' | 'time' | 'url' | 'chips' | 'switch';
  placeholder?: string;
  options?: [any, string][];
  hint?: string;
};

/** Универсальная форма правки: показывает поля, возвращает только изменённое. */
export function EditSheet({ title, value, fields, onClose, onSave, onDelete, deleteLabel }: {
  title: string;
  value: Record<string, any>;
  fields: Field[];
  onClose: () => void;
  onSave: (patch: Record<string, any>) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  deleteLabel?: string;
}) {
  const [form, setForm] = useState<Record<string, any>>({ ...value });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const first = fields[0];
    if (first && (first.type ?? 'text') !== 'switch' && !String(form[first.k] ?? '').trim()) {
      return toast(`Заполните «${first.label.toLowerCase()}»`);
    }
    setBusy(true);
    try {
      const patch: Record<string, any> = {};
      for (const f of fields) if (form[f.k] !== value[f.k]) patch[f.k] = form[f.k];
      await onSave(patch);
      haptic.ok();
      onClose();
    } catch (e: any) {
      toast(e?.message === 'bad_date' ? 'Проверьте дату' : 'Не получилось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm('Удалить насовсем?')) return;
    setBusy(true);
    try {
      await onDelete();
      haptic.ok();
      onClose();
    } catch {
      toast('Не получилось удалить');
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} onClose={onClose}>
      {fields.map((f) => {
        const type = f.type ?? 'text';
        return (
          <div key={f.k}>
            <label className="label">{f.label}</label>
            {type === 'textarea' && (
              <textarea className="input" value={form[f.k] ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.k, e.target.value)} style={{ minHeight: 80 }} />
            )}
            {type === 'chips' && (
              <div className="chips">
                {(f.options || []).map(([v, l]) => (
                  <button key={String(v)} className={`chip ${(form[f.k] ?? null) === v ? 'on accent' : ''}`} onClick={() => set(f.k, v)}>{l}</button>
                ))}
              </div>
            )}
            {type === 'switch' && (
              <div className="switch-row" style={{ marginTop: 0 }}>
                <span>{f.hint || ''}</span>
                <Switch on={!!form[f.k]} onChange={(v) => set(f.k, v)} />
              </div>
            )}
            {['text', 'date', 'time', 'url'].includes(type) && (
              <input
                className="input"
                type={type === 'url' ? 'text' : type}
                inputMode={type === 'url' ? 'url' : undefined}
                autoCapitalize={type === 'url' ? 'off' : undefined}
                value={form[f.k] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => set(f.k, e.target.value)}
              />
            )}
            {f.hint && type !== 'switch' && <p className="hint" style={{ marginTop: 4 }}>{f.hint}</p>}
          </div>
        );
      })}

      <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy} onClick={save}>Сохранить</button>
      {onDelete && (
        <button className="btn ghost block danger" style={{ marginTop: 8 }} disabled={busy} onClick={remove}>
          <Trash2 size={16} /> {deleteLabel || 'Удалить'}
        </button>
      )}
    </Sheet>
  );
}

/** Карандаш и корзина в строке списка. */
export function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  return (
    <div className="row-actions">
      {onEdit && (
        <button className="icon-btn" aria-label="Изменить" onClick={(e) => { e.stopPropagation(); haptic.tap(); onEdit(); }}>
          <Pencil size={15} />
        </button>
      )}
      {onDelete && (
        <button className="icon-btn" aria-label="Удалить" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

/** Список, который можно перетаскивать за «ручку» слева. Порядок уходит на сервер. */
export function Sortable<T extends { id: number }>({ items, onReorder, render, className = 'stack' }: {
  items: T[];
  onReorder: (ids: number[]) => void;
  render: (item: T, handle: ReactNode, dragging: boolean) => ReactNode;
  className?: string;
}) {
  const [drag, setDrag] = useState<{ id: number; from: number; to: number; dy: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement[]>([]);

  const start = (index: number, id: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    haptic.tap();
    const startY = e.clientY;
    const rects = rows.current.map((r) => r?.getBoundingClientRect());

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      let to = index;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (!r) continue;
        const mid = r.top + r.height / 2;
        if (i < index && ev.clientY < mid) { to = Math.min(to, i); }
        if (i > index && ev.clientY > mid) { to = Math.max(to, i); }
      }
      setDrag({ id, from: index, to, dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag((d) => {
        if (d && d.to !== d.from) {
          const next = items.slice();
          const [moved] = next.splice(d.from, 1);
          next.splice(d.to, 0, moved);
          onReorder(next.map((x) => x.id));
          haptic.ok();
        }
        return null;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Пока тащим — показываем порядок, который получится.
  const view = drag ? (() => {
    const next = items.slice();
    const [moved] = next.splice(drag.from, 1);
    next.splice(drag.to, 0, moved);
    return next;
  })() : items;

  return (
    <div className={className} ref={boxRef}>
      {view.map((item, i) => {
        const isDragging = drag?.id === item.id;
        const handle = (
          <button
            className="drag-handle"
            aria-label="Перетащить"
            onPointerDown={start(items.findIndex((x) => x.id === item.id), item.id)}
          >
            <GripVertical size={16} />
          </button>
        );
        return (
          <div
            key={item.id}
            ref={(el) => { if (el) rows.current[i] = el; }}
            className={`srow${isDragging ? ' dragging' : ''}`}
          >
            {render(item, handle, !!isDragging)}
          </div>
        );
      })}
    </div>
  );
}
