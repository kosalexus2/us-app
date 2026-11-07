import { useMemo, useState } from 'react';
import { Clapperboard, Gift, ListChecks, MapPin, ChefHat, Mail, ShoppingCart } from 'lucide-react';
import { post } from '../api';
import { Sheet, useToast } from './ui';
import { QUICK_LABELS, QuickKind, classifyQuick } from '../util';
import { haptic } from '../tg';
import type { Tab } from '../ctx';

const ICONS: Record<QuickKind, any> = {
  shopping: ShoppingCart, place: MapPin, gift: Gift, watch: Clapperboard, chore: ListChecks, recipe: ChefHat, note: Mail,
};
const WHERE: Record<QuickKind, [Tab, string]> = {
  shopping: ['home', 'shop'], place: ['together', 'places'], gift: ['memory', 'wishlist'],
  watch: ['memory', 'wishlist'], chore: ['home', 'chores'], recipe: ['home', 'recipes'], note: ['memory', 'notes'],
};

/** The centre "+" sheet: type one line, we guess where it goes; tap a type to override. */
export default function QuickAdd({ onClose, onDone }: { onClose: () => void; onDone: (tab: Tab, sub: string) => void }) {
  const [text, setText] = useState('');
  const [manual, setManual] = useState<QuickKind | null>(null);
  const toast = useToast();
  const guess = useMemo(() => classifyQuick(text), [text]);
  const kind = manual ?? guess.kind;
  const title = manual ? text.trim() : guess.title;

  const submit = async () => {
    if (!title) return;
    const body = { title };
    if (kind === 'shopping') await post('/shopping', body);
    else if (kind === 'place') await post('/places', body);
    else if (kind === 'gift' || kind === 'watch') await post('/wishes', { title, kind });
    else if (kind === 'chore') await post('/chores', body);
    else if (kind === 'recipe') await post('/recipes', body);
    else await post('/notes', { text: title });
    haptic.ok();
    toast(`Добавлено: ${QUICK_LABELS[kind]}`);
    onDone(...WHERE[kind]);
  };

  const Icon = ICONS[kind];
  return (
    <Sheet title="Что добавить?" onClose={onClose}>
      <input
        className="input" style={{ marginTop: 14, fontSize: 17 }} autoFocus value={text}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Молоко, сходить в Zero, подарок ей…" enterKeyHint="done"
      />
      <div style={{ minHeight: 34, marginTop: 12 }}>
        {text.trim() && (
          <span className="badge" style={{ padding: '7px 12px', fontSize: 13 }}>
            <Icon size={14} /> {QUICK_LABELS[kind]}{manual ? '' : ' · определено автоматически'}
          </span>
        )}
      </div>
      <div className="qa-grid">
        {(Object.keys(QUICK_LABELS) as QuickKind[]).map((k) => {
          const I = ICONS[k];
          return (
            <button key={k} className={`qa ${manual === k || (!manual && text.trim() && guess.kind === k) ? 'on' : ''}`} onClick={() => setManual(manual === k ? null : k)}>
              <I size={20} /> {QUICK_LABELS[k]}
            </button>
          );
        })}
      </div>
      <button className="btn primary block" style={{ marginTop: 20 }} disabled={!title} onClick={submit}>Добавить</button>
    </Sheet>
  );
}
