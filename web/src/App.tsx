import { useCallback, useMemo, useState } from 'react';
import { CalendarDays, Heart, LayoutGrid, Plus, UserRound, Users } from 'lucide-react';
import { useResource } from './api';
import { Ctx, Tab } from './ctx';
import { Avatar, Skeletons, ToastProvider } from './components/ui';
import { FriendsButton } from './components/Friends';
import HomeButton from './components/HomeHint';
import { InboxButton } from './components/Inbox';
import Assistant from './components/Assistant';
import Person from './pages/Person';
import InviteScreen from './pages/Invite';
import QuickAdd from './components/QuickAdd';
import Onboarding from './pages/Onboarding';
import TodayPage from './pages/Today';
import Together, { EventSheet } from './pages/Together';
import Home from './pages/Home';
import Memory from './pages/Memory';
import FriendsHome from './pages/FriendsHome';
import Me from './pages/Me';
import More from './pages/More';
import { MeetingSheet, NewMeetingSheet } from './pages/Meetings';
import type { Boot } from './types';
import { haptic, startParam } from './tg';

const TABS: [Tab, string, any][] = [
  ['today', 'Отношения', Heart],
  ['friends', 'Друзья', Users],
  ['me', 'Личное', UserRound],
  ['more', 'Ещё', LayoutGrid],
];
void CalendarDays;

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
  const [inviteDone, setInviteDone] = useState(false);
  const [person, setPerson] = useState<number | null>(null);
  const [meeting, setMeeting] = useState<number | 'new' | null>(null);

  const go = useCallback((tab: Tab, sub?: string) => {
    haptic.tap();
    setNav({ tab, sub });
    setPerson(null);
    window.scrollTo({ top: 0 });
  }, []);

  const openPerson = useCallback((id: number) => {
    haptic.tap();
    setPerson(id);
    window.scrollTo({ top: 0 });
  }, []);

  const ctx = useMemo(
    () => (boot ? { boot, go, reloadBoot: reload, openEventSheet: () => setEventSheet(true), openPerson, openMeeting: (id: number | 'new') => setMeeting(id) } : null),
    [boot, go, reload, openPerson],
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

  // Пришли по ссылке-приглашению: сначала экран «Вас приглашают», потом всё остальное.
  const param = boot.start_param || startParam() || '';
  const partnerCode = param.startsWith('invite_') ? param.slice(7) : null;
  const friendInvite = param.startsWith('friend_');
  const partnerPending = !!partnerCode && !(boot.couple && boot.partner) && boot.couple?.invite_code !== partnerCode;
  if (!inviteDone && (partnerPending || friendInvite)) {
    return <InviteScreen param={param} onDone={() => { setInviteDone(true); reload(); }} />;
  }
  const invite: string | null = null;
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
            <InboxButton />
            <FriendsButton />
            <HomeButton />
            <button className="av-btn" onClick={() => openPerson(boot.me.id)} aria-label="Мой профиль"><Avatar user={boot.me} dot /></button>
            {boot.partner && (
              <button className="av-btn" onClick={() => openPerson(boot.partner!.id)} aria-label={boot.partner.name}><Avatar user={boot.partner} dot /></button>
            )}
          </div>
        </header>

        {person !== null ? (
          <main key={`person-${person}`}>
            <Person id={person} onBack={() => setPerson(null)} />
          </main>
        ) : (
        <main key={nav.tab}>
          {nav.tab === 'today' && <TodayPage />}
          {nav.tab === 'friends' && <FriendsHome />}
          {nav.tab === 'me' && <Me />}
          {nav.tab === 'more' && <More />}
          {nav.tab === 'together' && <Together sub={nav.sub} />}
          {nav.tab === 'home' && <Home sub={nav.sub} />}
          {nav.tab === 'memory' && <Memory sub={nav.sub} />}
        </main>
        )}

        <nav className="nav" aria-label="Разделы">
          {TABS.slice(0, 2).map(([t, label, Icon]) => (
            <button key={t} className={`tab ${nav.tab === t || (t === 'more' && ['together', 'home', 'memory'].includes(nav.tab)) ? 'on' : ''}`} onClick={() => go(t)}>
              <Icon size={22} strokeWidth={nav.tab === t ? 2.4 : 1.8} /> {label}
            </button>
          ))}
          <button className="plus" onClick={() => { haptic.tap(); setQuick(true); }} aria-label="Добавить"><Plus size={28} strokeWidth={2.6} /></button>
          {TABS.slice(2).map(([t, label, Icon]) => (
            <button key={t} className={`tab ${nav.tab === t || (t === 'more' && ['together', 'home', 'memory'].includes(nav.tab)) ? 'on' : ''}`} onClick={() => go(t)}>
              <Icon size={22} strokeWidth={nav.tab === t ? 2.4 : 1.8} /> {label}
            </button>
          ))}
        </nav>

        {person === null && <Assistant onDone={reload} />}

        {quick && <QuickAdd onClose={() => setQuick(false)} onDone={(t, s) => { setQuick(false); go(t, s); }} />}
        {meeting === 'new' && <NewMeetingSheet onClose={() => setMeeting(null)} onSaved={() => setMeeting(null)} />}
        {typeof meeting === 'number' && <MeetingSheet id={meeting} onClose={() => setMeeting(null)} onChanged={() => {}} />}
        {eventSheet && <EventSheet onClose={() => setEventSheet(false)} onSaved={() => setEventSheet(false)} />}
      </div>
    </Ctx.Provider>
  );
}
