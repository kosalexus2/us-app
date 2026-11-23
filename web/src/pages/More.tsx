import { BookHeart, Heart, House } from 'lucide-react';
import { useApp } from '../ctx';
import { Safety } from '../components/Extras';

export default function More() {
  const { go } = useApp();
  const items: [string, string, any, () => void][] = [
    ['Вместе', 'Места, свидания, события и поездки пары', Heart, () => go('together')],
    ['Дом', 'Покупки, дела и рецепты', House, () => go('home')],
    ['Память', 'Дневник, желания и записки', BookHeart, () => go('memory')],
  ];
  return (
    <div className="scroll">
      <h1 className="h-title">Ещё</h1>
      <p className="sub">Остальные разделы приложения</p>
      <div className="stack">
        {items.map(([t, s, Icon, fn]) => (
          <button key={t} className="card meet" onClick={fn}>
            <span className="round-ic"><Icon size={18} /></span>
            <span className="grow"><b>{t}</b><span className="sub">{s}</span></span>
          </button>
        ))}
      </div>
      <Safety />
    </div>
  );
}
