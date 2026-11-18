// Разбор голосовой/текстовой команды по-русски. Всё локально, без внешних сервисов.
// «добавь встречу поход в зал 27 ноября в 17:00 напомни за час» -> {kind:'cal', title, date, time, remind_min}
// Важно: в JS \b и \w не работают с кириллицей, поэтому границы слов задаём явно.

export type Kind = 'cal' | 'wish' | 'shopping' | 'chore' | 'place' | 'recipe' | 'note';
export type Parsed = {
  kind: Kind;
  title: string;
  date?: string;
  time?: string;
  remind_min?: number;
  url?: string;
  instead?: boolean; // «вместо зала предложи кино»
  raw: string;
};

const W = 'а-яёa-z0-9'; // «буквенные» символы для границ слова
const L = `(?:^|[^${W}])`; // граница слева
const R = `(?![${W}])`; //   граница справа
const re = (body: string, flags = 'i') => new RegExp(body, flags);
/** Шаблон слова с границами. Первая группа шаблона — то, что слева, её не используем. */
const word = (body: string) => re(L + '(' + body + ')' + R);

const MONTHS: [string, number][] = [
  ['январ', 1], ['феврал', 2], ['март', 3], ['апрел', 4], ['мая', 5], ['май', 5], ['июн', 6],
  ['июл', 7], ['август', 8], ['сентябр', 9], ['октябр', 10], ['ноябр', 11], ['декабр', 12],
];
const WEEK: [string, number][] = [
  ['понедельник', 1], ['вторник', 2], ['серед', 3], ['сред', 3], ['четверг', 4],
  ['пятниц', 5], ['суббот', 6], ['воскресень', 0],
];
const NUM: Record<string, number> = {
  полчаса: 30, час: 60, часа: 60, часов: 60, сутки: 1440, сутак: 1440, день: 1440, дня: 1440,
  один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Вырезает первое совпадение, возвращает [совпадение, остаток]. Группа 1 шаблона — левая граница. */
function cut(s: string, pattern: RegExp): [RegExpExecArray | null, string] {
  const m = pattern.exec(s);
  if (!m) return [null, s];
  const lead = /^[^а-яёa-z0-9]/i.test(m[0]) ? 1 : 0; // съеденный разделитель возвращаем как пробел
  const rest = (s.slice(0, m.index + lead) + ' ' + s.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  return [m, rest];
}

function parseDate(s: string, today: Date): [string | undefined, string] {
  const base = startOfDay(today);
  let m: RegExpExecArray | null;

  [m, s] = cut(s, word('послезавтра|завтра|сегодня'));
  if (m) {
    const d = new Date(base);
    d.setDate(d.getDate() + (/после/i.test(m[1]) ? 2 : /завтра/i.test(m[1]) ? 1 : 0));
    return [iso(d), s];
  }

  // 27 ноября, 27-го ноября 2026
  let rest: string;
  [m, rest] = cut(s, re(`${L}(\\d{1,2})\\s*(?:-?(?:го|е|ое))?\\s+([а-яё]{3,})\\s*(\\d{4})?${R}`));
  if (m) {
    const name = m[2].toLowerCase();
    const mon = MONTHS.find(([k]) => name.startsWith(k))?.[1];
    if (mon) {
      const day = Number(m[1]);
      const year = m[3] ? Number(m[3]) : base.getFullYear();
      const d = new Date(year, mon - 1, day);
      if (!m[3] && d < base) d.setFullYear(year + 1);
      if (d.getDate() === day) return [iso(d), rest];
    }
  }

  [m, rest] = cut(s, re(`${L}(\\d{4})-(\\d{2})-(\\d{2})${R}`));
  if (m) return [`${m[1]}-${m[2]}-${m[3]}`, rest];

  // 5.12 / 27.11.2026 / 5/12
  [m, rest] = cut(s, re(`${L}(\\d{1,2})[.\\/](\\d{1,2})(?:[.\\/](\\d{2,4}))?${R}`));
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : base.getFullYear();
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && d < base) d.setFullYear(y + 1);
    if (d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1) return [iso(d), rest];
  }

  // в субботу, в следующую пятницу
  [m, rest] = cut(s, re(`${L}(?:в|во)?\\s*(следующ[а-яё]+\\s+)?(понедельник|вторник|серед[а-яё]*|сред[а-яё]*|четверг|пятниц[а-яё]*|суббот[а-яё]*|воскресень[а-яё]*)${R}`));
  if (m) {
    const name = m[2].toLowerCase();
    const want = WEEK.find(([k]) => name.startsWith(k))?.[1];
    if (want !== undefined) {
      const d = new Date(base);
      let add = (want - d.getDay() + 7) % 7;
      if (add === 0) add = 7;
      if (m[1]) add += 7;
      d.setDate(d.getDate() + add);
      return [iso(d), rest];
    }
  }

  // через 3 дня / через неделю
  [m, s] = cut(s, re(`${L}через\\s+(\\d+|[а-яё]+)?\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)${R}`));
  if (m) {
    const n = m[1] ? (/^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()] ?? 1) : 1;
    const d = new Date(base);
    if (/недел/i.test(m[2])) d.setDate(d.getDate() + n * 7);
    else if (/месяц/i.test(m[2])) d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    return [iso(d), s];
  }
  return [undefined, s];
}

function parseTime(s: string): [string | undefined, string] {
  let m: RegExpExecArray | null;
  let rest: string;
  [m, rest] = cut(s, re(`${L}(?:в|к|во)?\\s*([01]?\\d|2[0-3])[:.](\\d{2})${R}`));
  if (m && Number(m[2]) < 60) return [`${pad(Number(m[1]))}:${m[2]}`, rest];

  // в 17, в 7 вечера, к 9 утра, в 19 часов
  [m, rest] = cut(s, re(`${L}(?:в|к|во)\\s*(\\d{1,2})\\s*(утра|дня|вечера|ночи)?\\s*(?:час[а-яё]*)?${R}`));
  if (m) {
    let h = Number(m[1]);
    const part = (m[2] || '').toLowerCase();
    if (h <= 23) {
      if ((part === 'вечера' || part === 'дня') && h < 12) h += 12;
      if (part === 'ночи' && h === 12) h = 0;
      return [`${pad(h)}:00`, rest];
    }
  }
  return [undefined, s];
}

function parseRemind(s: string): [number | undefined, string] {
  let m: RegExpExecArray | null;
  // «напомни за 2 часа», «поставь напоминание», «напомнить за 15 минут»
  [m, s] = cut(s, re(`${L}(?:поставь\\s+|сделай\\s+)?напом(?:ни|ина)[а-яё]*\\s*(?:мне\\s*|нам\\s*)?(?:за\\s+(\\d+|[а-яё]+)\\s*(минут[а-яё]*|час[а-яё]*|дн[а-яё]*|сутк[а-яё]*)?)?${R}`));
  if (!m) return [undefined, s];
  if (!m[1]) return [60, s]; // «напомни» без уточнения — за час
  const token = m[1].toLowerCase();
  const n = /^\d+$/.test(token) ? Number(token) : NUM[token];
  const unit = (m[2] || '').toLowerCase();
  if (n === undefined) return [60, s];
  if (/минут/.test(unit)) return [n, s];
  if (/дн|сутк/.test(unit)) return [n * 1440, s];
  if (/час/.test(unit)) return [n * 60, s];
  return [NUM[token] ?? n, s]; // «за полчаса», «за час»
}

const KIND_RULES: [RegExp, Kind][] = [
  [word('подар[а-яё]*|вишлист[а-яё]*|мечт[а-яё]*|желани[а-яё]*|хочу|хотел[а-яё]*'), 'wish'],
  [word('посмотреть|фильм[а-яё]*|сериал[а-яё]*'), 'wish'],
  [word('рецепт[а-яё]*|приготов[а-яё]*'), 'recipe'],
  [word('купить|куплю|продукт[а-яё]*|покупк[а-яё]*'), 'shopping'],
  [word('встреч[а-яё]*|событи[а-яё]*|календар[а-яё]*|запланир[а-яё]*|свидани[а-яё]*|напом(?:ни|ина)[а-яё]*|напоминани[а-яё]*|тренировк[а-яё]*|поход'), 'cal'],
  [word('записк[а-яё]*'), 'note'],
  [word('мест[а-яё]*|сходить|съездить|заглянуть|кафе|ресторан|бар'), 'place'],
  [word('дело|дела|задач[а-яё]*|сделать|не\\s+забыть|оплат[а-яё]*|почин[а-яё]*|убра[а-яё]*'), 'chore'],
];

// Слова-команды и служебные обороты, которые в названии не нужны.
const FILLERS: RegExp[] = [
  re(`^(?:слушай|эй|окей|ок|привет|короче)[,\\s]+`),
  re(`^(?:давай|пожалуйста)[,\\s]+`),
  re(`${L}(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать|внеси|внести|сделай|сделать|закинь|предложи|предложить|напиши|написать)${R}`, 'gi'),
  re(`${L}(?:которое|которая|который)\\s+(?:будет\\s+)?(?:называется|называться|назвать)${R}`, 'gi'),
  re(`${L}(?:под\\s+названием|названием|называется|называться)${R}`, 'gi'),
  re(`${L}(?:мне|нам|себе|ему|ей|пожалуйста|пожалста)${R}`, 'gi'),
  re(`${L}(?:в\\s+календарь|календарь|в\\s+календаре)${R}`, 'gi'),
  re(`${L}(?:встречу|встреча|событие|задачу|задача|напоминание|напоминалку)${R}`, 'gi'),
  re(`${L}(?:в\\s+вишлист|вишлист|в\\s+список\\s+покупок|список\\s+покупок|в\\s+покупки)${R}`, 'gi'),
  re(`${L}(?:хочу|хотел|хотела|хотелось\\s+бы)${R}`, 'gi'),
  re(`${L}(?:рецепт|место|дело|задачу)${R}`, 'gi'),
];

const EDGE = re(`^(?:[\\s,.;:—–-]|(?:и|а|в|во|на|к|ко|с|со|о|об|про|для|что|чтобы|бы|же|ну|там|это|вот|его|её|ему|ей|он|она|они|мы|до|после|около|примерно)(?=\\s|$))+`, 'i');

function trimEdges(t: string): string {
  let prev = '';
  let s = t.trim();
  while (s !== prev) {
    prev = s;
    s = s.replace(EDGE, '').trim();
    // конец строки чистим без lookbehind: по словам
    const parts = s.split(/\s+/);
    while (parts.length > 1 && /^(?:и|а|в|во|на|к|ко|с|со|о|об|про|для|что|чтобы|бы|же|ну|там|это|вот|до|после|около|примерно)$/i.test(parts[parts.length - 1])) parts.pop();
    s = parts.join(' ').replace(/[\s,.;:—–-]+$/, '').trim();
  }
  return s;
}

/** Главная функция: превращает фразу в понятное действие. */
export function parseCommand(raw: string, today = new Date()): Parsed {
  const text = raw.trim().replace(/\s+/g, ' ');
  let s = text;

  const instead = re(`${L}(?:вместо|перенес[а-яё]*|замен[а-яё]*)${R}`).test(s);
  // «вместо зала предложи кино» — название берём из второй половины
  const mInstead = re(`${L}(?:вместо|заместо)\\s+(.+?)\\s+(?:предлож[а-яё]*|давай|лучше|пусть|сходим|пойдём|пойдем)\\s+(.+)$`).exec(s);
  if (mInstead) s = mInstead[2];

  let url: string | undefined;
  const mUrl = /(https?:\/\/\S+|(?:^|\s)[a-z0-9][a-z0-9-]*\.(?:ru|by|com|org|net|io|me|ua|kz|pl|de|shop|store|info|biz)(?:\/\S*)?)/i.exec(s);
  if (mUrl) {
    url = mUrl[1].trim();
    s = (s.slice(0, mUrl.index) + ' ' + s.slice(mUrl.index + mUrl[0].length)).replace(/\s{2,}/g, ' ').trim();
  }

  let kind: Kind | undefined;
  for (const [pattern, k] of KIND_RULES) {
    if (pattern.test(s)) { kind = k; break; }
  }

  let date: string | undefined, time: string | undefined, remind: number | undefined;
  [remind, s] = parseRemind(s);
  [date, s] = parseDate(s, today);
  [time, s] = parseTime(s);
  if (!kind && (date || time || remind !== undefined)) kind = 'cal';
  if (!kind) kind = url ? 'wish' : 'shopping';

  let title = s;
  for (const f of FILLERS) title = title.replace(f, ' ');
  title = trimEdges(title.replace(/\s{2,}/g, ' '));
  if (!title) title = DEFAULT_TITLE[kind];
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { kind, title, date, time, remind_min: remind, url, instead, raw: text };
}

const DEFAULT_TITLE: Record<Kind, string> = {
  cal: 'Встреча', wish: 'Желание', shopping: 'Покупка', chore: 'Дело',
  place: 'Место', recipe: 'Рецепт', note: 'Записка',
};

export const KIND_LABEL: Record<Kind, string> = {
  cal: 'Встреча',
  wish: 'Вишлист',
  shopping: 'Покупки',
  chore: 'Дело',
  place: 'Место',
  recipe: 'Рецепт',
  note: 'Записка',
};

// ---- распознавание речи в браузере (на iPhone его нет — там диктуем микрофоном клавиатуры) ----
export const speechSupported = () =>
  typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function listen(onText: (text: string, final: boolean) => void, onEnd: (err?: string) => void): (() => void) | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  let rec: any;
  try {
    rec = new Ctor();
    rec.lang = 'ru-RU';
    rec.continuous = false;
    rec.interimResults = true;
  } catch {
    return null;
  }
  rec.onresult = (e: any) => {
    let text = '';
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      if (e.results[i].isFinal) final = true;
    }
    onText(text.trim(), final);
  };
  rec.onerror = (e: any) => onEnd(e?.error || 'error');
  rec.onend = () => onEnd();
  try { rec.start(); } catch { return null; }
  return () => { try { rec.abort(); } catch {} };
}
