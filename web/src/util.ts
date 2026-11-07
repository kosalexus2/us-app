export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
};

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export const fmtLongDate = (d = new Date()) => `${cap(WEEKDAYS[d.getDay()])}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
};
export const fmtDateTime = (unix: number) => {
  const d = new Date(unix * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
};
export const ago = (unix: number) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return `${Math.floor(s / 86400)} дн. назад`;
};
export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
export const inDaysLabel = (n: number) => (n === 0 ? 'сегодня' : n === 1 ? 'завтра' : `через ${n} ${plural(n, 'день', 'дня', 'дней')}`);

export type QuickKind = 'shopping' | 'place' | 'gift' | 'watch' | 'chore' | 'recipe' | 'note';
export const QUICK_LABELS: Record<QuickKind, string> = {
  shopping: 'Покупки',
  place: 'Место',
  gift: 'Подарок',
  watch: 'Посмотреть',
  chore: 'Дело',
  recipe: 'Рецепт',
  note: 'Записка',
};

/** Guess where a free-form line belongs: "сходить в Zero" -> place, "хочу часы" -> gift, ... */
export function classifyQuick(raw: string): { kind: QuickKind; title: string } {
  const t = raw.trim();
  const rules: [RegExp, QuickKind][] = [
    [/^(сходить|съездить|поехать|заглянуть|место|свидание)\s+(?:в |на |к )?/i, 'place'],
    [/^(подарок|подарить|хочу|вишлист)\s+(?:в |на )?/i, 'gift'],
    [/^(фильм|сериал|посмотреть)\s+/i, 'watch'],
    [/^(дело|сделать|убраться|убрать|не забыть|оплатить|починить)\s*/i, 'chore'],
    [/^(рецепт|приготовить)\s+/i, 'recipe'],
    [/^(записка|написать ей|написать ему)\s*[:\-]?\s*/i, 'note'],
    [/^(купить)\s+/i, 'shopping'],
  ];
  for (const [re, kind] of rules) {
    if (re.test(t)) {
      const title = kind === 'chore' ? (re.exec(t)![1].match(/^(сделать|убраться|убрать|не забыть|оплатить|починить)$/i) ? t : t.replace(re, '')) : t.replace(re, '');
      return { kind, title: (title || t).trim() };
    }
  }
  return { kind: 'shopping', title: t };
}
