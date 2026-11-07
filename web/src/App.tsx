import { useCallback, useMemo, useState } from 'react';
import { BookHeart, CalendarDays, Heart, House, Plus } from 'lucide-react';
import { useResource } from './api';
import { Ctx, Tab } from './ctx';
import { Avatar, Skeletons, ToastProvider } from './components/ui';
import QuickAdd from './components/QuickAdd';
import Onboarding from './pages/Onboarding';
import TodayPage from './pages/Today';
import Together, { EventSheet } from './pages/Together';
import Home from './pages/Home';
import Memory from './pages/Memory';
import type { Boot } from './types';
import { haptic, startParam } from './tg';

const TABS: [Tab, string, any][] = [
  ['today', 'Сегодня', CalendarDays],
  ['together', 'Вместе', Heart],
  ['home', 'Дом', House],
  ['memory', 'Память', BookHeart],
];

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { data: boot, error, reload } = useResource<Boot>('/bootstrap', 4000);
  const [nav, setNav] = useState<{ tab: Tab; sub?: string }>({ tab: 'today' });
  const [quick, setQuick] = useState(false);
  const [eventSheet, setEventSheet] = useState(false);
  const [solo, setSolo] = useState(false);

  const go = useCallback((tab: Tab, sub?: string) => {
    haptic.tap();
    setNav({ tab, sub });
    window.scrollTo({ top: 0 });
  }, []);

  const ctx = useMemo(
    () => (boot ? { boot, go, reloadBoot: reload, openEventSheet: () => setEventSheet(true) } : null),
    [boot, go, reload],
  );

  if (error?.status === 401) {
    return (
      <div className="center-screen">
        <h1>Откройте из Telegram</h1>
        <p>Us App работает как мини-приложение внутри Telegram. Откройте бота и нажмите кнопку запуска.</p>
      </div>
    );
  }
  if (!boot || !ctx) return <div className="app"><div className="scroll" style={{ paddingTop: 80 }}><Skeletons n={3} /></div></div>;

  const invite = (boot.start_param || startParam() || '').startsWith('invite_') ? (boot.start_param || startParam()) : null;
  if (!boot.couple) {
    return <Onboarding invite={invite} botUsername={boot.bot_username} onDone={reload} />;
  }
  // Couple exists but the partner has not joined yet: show the invite screen once, then allow solo use.
  if (!boot.partner && !solo && !invite) {
    return (
      <Onboarding
        invite={null}
        botUsername={boot.bot_username}
        onDone={() => setSolo(true)}
        // jump straight to the invite step because the couple already exists
        existingCode={boot.couple.invite_code}
      />
    );
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <span className="brand">Us App</span>
          <div className="avatars">
            <Avatar user={boot.me} dot />
            {boot.partner && <Avatar user={boot.partner} dot />}
          </div>
        </header>

        <main key={nav.tab}>
          {nav.tab === 'today' && <TodayPage />}
          {nav.tab === 'together' && <Together sub={nav.sub} />}
          {nav.tab === 'home' && <Home sub={nav.sub} />}
          {nav.tab === 'memory' && <Memory sub={nav.sub} />}
        </main>

        <nav className="nav" aria-label="Разделы">
          {TABS.slice(0, 2).map(([t, label, Icon]) => (
            <button key={t} className={`tab ${nav.tab === t ? 'on' : ''}`} onClick={() => go(t)}>
              <Icon size={22} strokeWidth={nav.tab === t ? 2.4 : 1.8} /> {label}
            </button>
          ))}
          <button className="plus" onClick={() => { haptic.tap(); setQuick(true); }} aria-label="Добавить"><Plus size={28} strokeWidth={2.6} /></button>
          {TABS.slice(2).map(([t, label, Icon]) => (
            <button key={t} className={`tab ${nav.tab === t ? 'on' : ''}`} onClick={() => go(t)}>
              <Icon size={22} strokeWidth={nav.tab === t ? 2.4 : 1.8} /> {label}
            </button>
          ))}
        </nav>

        {quick && <QuickAdd onClose={() => setQuick(false)} onDone={(t, s) => { setQuick(false); go(t, s); }} />}
        {eventSheet && <EventSheet onClose={() => setEventSheet(false)} onSaved={() => setEventSheet(false)} />}
      </div>
    </Ctx.Provider>
  );
}
