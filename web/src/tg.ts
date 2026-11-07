// Thin wrapper around the Telegram WebApp SDK with safe fallbacks for the browser.
const w: any = typeof window !== 'undefined' ? (window as any) : {};
export const WebApp = w.Telegram?.WebApp;

export const initData: string = WebApp?.initData || '';

export function initTelegram() {
  if (!WebApp) return;
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor?.('#F5F5F7');
    WebApp.setBackgroundColor?.('#F5F5F7');
    WebApp.disableVerticalSwipes?.();
  } catch {}
}

export const haptic = {
  tap: () => WebApp?.HapticFeedback?.impactOccurred?.('light'),
  ok: () => WebApp?.HapticFeedback?.notificationOccurred?.('success'),
};

export function shareInvite(url: string, text: string) {
  const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (WebApp?.openTelegramLink) WebApp.openTelegramLink(link);
  else window.open(link, '_blank');
}

/** Start parameter passed via t.me/bot?startapp=... or ?p= from the bot's /start button. */
export function startParam(): string | null {
  return (
    WebApp?.initDataUnsafe?.start_param ||
    new URLSearchParams(location.search).get('p') ||
    null
  );
}

/** Local development outside Telegram: open /?dev=111:Alex (server needs DEV_MODE=1). */
export const devUser: string | null =
  new URLSearchParams(location.search).get('dev') || localStorage.getItem('devUser');
if (devUser) localStorage.setItem('devUser', devUser);
