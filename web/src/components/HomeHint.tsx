import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Share, Smartphone } from 'lucide-react';
import { Sheet, useToast } from './ui';
import { addToHomeScreen, homeScreenStatus } from '../tg';
import { haptic } from '../tg';

/** Тихая кнопка в верхней панели: «Добавить на главный экран». Всегда на месте, ничего не загораживает. */
export default function HomeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="top-btn quiet" aria-label="Добавить на главный экран" onClick={() => { haptic.tap(); setOpen(true); }}>
        <Share size={20} strokeWidth={1.6} />
      </button>
      {open && createPortal(<HomeSheet onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function HomeSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const add = () => {
    homeScreenStatus((s) => {
      if (s === 'added') {
        toast('Ярлык уже на главном экране');
      } else if (s === 'unsupported') {
        toast('Откройте меню ⋯ в Telegram и выберите «Добавить на главный экран»');
      } else {
        addToHomeScreen();
      }
      onClose();
    });
  };
  return (
    <Sheet onClose={onClose}>
      <div className="home-sheet">
        <div className="big-ic"><Smartphone size={30} /></div>
        <h2>Добавить на главный экран</h2>
        <p>Откроется как обычное приложение, без Telegram</p>
        <button className="btn primary block" onClick={add}>Добавить</button>
        <button className="btn ghost block" style={{ marginTop: 6 }} onClick={onClose}>Не сейчас</button>
      </div>
    </Sheet>
  );
}
