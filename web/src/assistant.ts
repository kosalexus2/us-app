// Разбор голосовой/текстовой команды по-русски. Всё локально, без внешних сервисов.
// «добавь встречу поход в зал 27 ноября в 17:00 напомни за час» -> {kind:'cal', title, date, time, remind_min}
// «отметь что купил молоко» -> {kind:'done'}   «хотим суши на следующей неделе» -> {kind:'findtime'}
// Важно: в JS \b и \w не работают с кириллицей, поэтому границы слов задаём явно.

export type Kind = 'task' | 'cal' | 'chore' | 'shopping' | 'wish' | 'place' | 'recipe' | 'note' | 'done' | 'findtime';

export type Parsed = {
  kind: Kind;
  title: string;
  date?: string;
  time?: string;
  remind_min?: number;
  duration_min?: number; // для встречи и для поиска свободного времени
  from?: string; // период поиска свободного времени
  to?: string;
  together?: boolean; // «с Машей», «вдвоём», «нам»
  url?: string;
  instead?: boolean; // «вместо зала предложи кино»
  place?: string; // «место спортзал»
  project?: string; // «в проект Сайты»
  urgent?: boolean; // «срочно»
  raw: string;
};

const W = 'а-яёa-z0-9'; // «буквенные» символы для границ слова
const L = `(?:^|[^${W}])`; // граница слева
const R = `(?![${W}])`; //   граница справа
const re = (body: string, flags = 'i') => new RegExp(body, flags);
/** Шаблон слова с границами. Группа 1 — само слово. */
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
  полчаса: 30, час: 60, часа: 60, часов: 60, сутки: 1440, день: 1440, дня: 1440,
  один: 1, одну: 1, полтора: 1.5, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
  семь: 7, восемь: 8, девять: 9, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40,
};
/** Часы словами: «в семь вечера». */
const HOURS: Record<string, number> = {
  час: 1, один: 1, два: 2, двух: 2, три: 3, трёх: 3, трех: 3, четыре: 4, четырёх: 4, четырех: 4,
  пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8, девять: 9, девяти: 9,
  десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const shift = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

/** Вырезает первое совпадение, возвращает [совпадение, остаток]. */
function cut(s: string, pattern: RegExp): [RegExpExecArray | null, string] {
  const m = pattern.exec(s);
  if (!m) return [null, s];
  const lead = /^[^а-яёa-z0-9]/i.test(m[0]) ? 1 : 0; // съеденный разделитель возвращаем как пробел
  const rest = (s.slice(0, m.index + lead) + ' ' + s.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim();
  return [m, rest];
}

// ---------------- период: «на следующей неделе», «на выходных» ----------------
function parsePeriod(s: string, today: Date): [{ from: string; to: string } | undefined, string] {
  const base = startOfDay(today);
  const dow = base.getDay() === 0 ? 7 : base.getDay(); // 1 = понедельник
  let m: RegExpExecArray | null;
  let rest: string;

  [m, rest] = cut(s, re(`${L}(?:на|в|во)?\\s*(следующ[а-яё]+|будущ[а-яё]+|эт[а-яё]+|ближайш[а-яё]+)?\\s*(выходн[а-яё]+)${R}`));
  if (m) {
    const next = /следующ|будущ/i.test(m[1] || '');
    const sat = dow === 6 ? base : shift(base, (6 - dow + 7) % 7);
    const from = next ? shift(sat, 7) : sat;
    return [{ from: iso(from), to: iso(shift(from, 1)) }, rest];
  }

  [m, rest] = cut(s, re(`${L}(?:на|в|во)?\\s*(следующ[а-яё]+|будущ[а-яё]+|эт[а-яё]+|ближайш[а-яё]+)\\s*недел[а-яё]+${R}`));
  if (m) {
    const next = /следующ|будущ/i.test(m[1]);
    const mon = shift(base, next ? 8 - dow : 0);
    const to = next ? shift(mon, 6) : shift(base, 7 - dow);
    return [{ from: iso(mon), to: iso(to) }, rest];
  }

  [m, rest] = cut(s, re(`${L}(?:на\\s+днях|в\\s+ближайшие\\s+дни|в\\s+ближайшее\\s+время|на\\s+этой\\s+неделе)${R}`));
  if (m) return [{ from: iso(base), to: iso(shift(base, 5)) }, rest];

  [m, rest] = cut(s, re(`${L}в\\s+течение\\s+(недели|месяца)${R}`));
  if (m) return [{ from: iso(base), to: iso(shift(base, /месяц/i.test(m[1]) ? 30 : 7)) }, rest];

  return [undefined, s];
}

// ---------------- дата ----------------
function parseDate(s: string, today: Date): [string | undefined, string] {
  const base = startOfDay(today);
  let m: RegExpExecArray | null;
  let rest: string;

  [m, rest] = cut(s, word('послезавтра|завтра|сегодня'));
  if (m) return [iso(shift(base, /после/i.test(m[1]) ? 2 : /завтра/i.test(m[1]) ? 1 : 0)), rest];

  // 27 ноября, 27-го ноября 2026
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
      let add = (want - base.getDay() + 7) % 7;
      if (add === 0) add = 7;
      if (m[1]) add += 7;
      return [iso(shift(base, add)), rest];
    }
  }

  // через 3 дня / через неделю
  [m, rest] = cut(s, re(`${L}через\\s+(\\d+|[а-яё]+)?\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)${R}`));
  if (m) {
    const n = m[1] ? (/^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1].toLowerCase()] ?? 1) : 1;
    const d = new Date(base);
    if (/недел/i.test(m[2])) d.setDate(d.getDate() + n * 7);
    else if (/месяц/i.test(m[2])) d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + n);
    return [iso(d), rest];
  }
  return [undefined, s];
}

// ---------------- время ----------------
/** Приводит час к 24-часовому виду с учётом «утра/дня/вечера/ночи». */
function withPart(h: number, part?: string): number | null {
  if (!(h >= 0 && h <= 23)) return null;
  const p = (part || '').toLowerCase();
  if ((p === 'вечера' || p === 'дня') && h < 12) h += 12;
  if (p === 'ночи' && h === 12) h = 0;
  if (!p && h >= 1 && h <= 6) h += 12; // «в 7» вечером логичнее, чем ночью
  return h;
}

function parseTime(s: string): [string | undefined, string] {
  let m: RegExpExecArray | null;
  let rest: string;

  // 17:00, 17.00, «в 17 00»
  [m, rest] = cut(s, re(`${L}(?:в|к|во)?\\s*([01]?\\d|2[0-3])[:.](\\d{2})${R}`));
  if (m && Number(m[2]) < 60) return [`${pad(Number(m[1]))}:${m[2]}`, rest];
  [m, rest] = cut(s, re(`${L}(?:в|к|во)\\s+([01]?\\d|2[0-3])\\s+([0-5]\\d)${R}`));
  if (m) return [`${pad(Number(m[1]))}:${m[2]}`, rest];

  // в 17, в 7 вечера, к 9 утра, в 19 часов
  [m, rest] = cut(s, re(`${L}(?:в|к|во)\\s*(\\d{1,2})\\s*(утра|дня|вечера|ночи)?\\s*(?:час[а-яё]*)?${R}`));
  if (m) {
    const h = withPart(Number(m[1]), m[2]);
    if (h !== null) return [`${pad(h)}:00`, rest];
  }

  // в семь вечера
  [m, rest] = cut(s, re(`${L}(?:в|к|во)\\s*([а-яё]+)\\s*(утра|дня|вечера|ночи)?\\s*(?:час[а-яё]*)?${R}`));
  if (m) {
    const n = HOURS[m[1].toLowerCase()];
    if (n !== undefined) {
      const h = withPart(n, m[2]);
      if (h !== null) return [`${pad(h)}:00`, rest];
    }
  }
  return [undefined, s];
}

// ---------------- напоминание и длительность ----------------
function parseRemind(s: string): [number | undefined, string] {
  let m: RegExpExecArray | null;
  [m, s] = cut(s, re(`${L}(?:поставь\\s+|сделай\\s+)?напом(?:ни|ина)[а-яё]*\\s*(?:мне\\s*|нам\\s*)?(?:за\\s+(\\d+|[а-яё]+)\\s*(минут[а-яё]*|час[а-яё]*|дн[а-яё]*|сутк[а-яё]*|недел[а-яё]*)?)?${R}`));
  if (!m) {
    [m, s] = cut(s, re(`${L}за\\s+(\\d+|[а-яё]+)\\s*(минут[а-яё]*|час[а-яё]*)\\s+до${R}`));
    if (!m) return [undefined, s];
  }
  if (!m[1]) return [60, s]; // «напомни» без уточнения — за час
  const token = m[1].toLowerCase();
  const n = /^\d+$/.test(token) ? Number(token) : NUM[token];
  const unit = (m[2] || '').toLowerCase();
  if (n === undefined) return [60, s];
  if (/минут/.test(unit)) return [Math.round(n), s];
  if (/недел/.test(unit)) return [Math.round(n) * 10080, s];
  if (/дн|сутк/.test(unit)) return [Math.round(n) * 1440, s];
  if (/час/.test(unit)) return [Math.round(n * 60), s];
  return [NUM[token] ?? Math.round(n), s]; // «за полчаса», «за час»
}

function parseDuration(s: string): [number | undefined, string] {
  let m: RegExpExecArray | null;
  [m, s] = cut(s, re(`${L}(?:на|часа?\\s+на)\\s+(\\d+|полтора|полчаса|[а-яё]+)\\s*(час[а-яё]*|минут[а-яё]*)${R}`));
  if (!m) return [undefined, s];
  const token = m[1].toLowerCase();
  const n = /^\d+$/.test(token) ? Number(token) : NUM[token];
  if (n === undefined) return [undefined, s];
  if (/минут/i.test(m[2])) return [Math.round(n), s];
  return [Math.round(n * 60), s];
}

// ---------------- тип ----------------
const DONE_WORDS = `(?:отметь|отметить|отмечай|выполнено|выполнена|сделано|сделал[а]?|готово|куп(?:ил|ила|лено)|оплатил[а]?|закрыл[а]?|убери\\s+из\\s+списка|вычеркни|заверш(?:ил|ено|ила))`;
const DONE_RE = re(L + DONE_WORDS + R);
const DONE_ALL = re(L + DONE_WORDS + R, 'gi');
const FIND_RE = re(
  `${L}(?:найди\\s+(?:нам\\s+|мне\\s+)?(?:свободн[а-яё]+\\s+)?(?:время|окно|часы|слот[а-яё]*)|подбери\\s+время|когда\\s+(?:мы\\s+)?(?:свободн[а-яё]+|можем|удобно)|свободн[а-яё]+\\s+(?:время|часы|окна)|есть\\s+ли\\s+время)${R}`,
);
const WANT_RE = re(`${L}(?:хочу|хотим|хотел[а]?(?:\\s+бы)?|давай|давайте|надо|нужно|планиру[ею]м?|собираемся)${R}`);
const TOGETHER_RE = re(`${L}(?:вдвоём|вдвоем|вместе|с\\s+(?:тобой|девушк[а-яё]+|женой|мужем|партнёром|партнером|парнем)|нам|мы)${R}`);

const KIND_RULES: [RegExp, Kind][] = [
  [word('задач[а-яё]*|таск[а-яё]*|дедлайн[а-яё]*'), 'task'],
  [word('подар[а-яё]*|вишлист[а-яё]*|мечт[а-яё]*|желани[а-яё]*'), 'wish'],
  [word('посмотреть|фильм[а-яё]*|сериал[а-яё]*'), 'wish'],
  [word('рецепт[а-яё]*|приготов[а-яё]*|готовить|испечь|сварить'), 'recipe'],
  [word('купить|куплю|продукт[а-яё]*|покупк[а-яё]*|в\\s+магазин'), 'shopping'],
  [word('встреч[а-яё]*|событи[а-яё]*|календар[а-яё]*|запланир[а-яё]*|свидани[а-яё]*|напом(?:ни|ина)[а-яё]*|тренировк[а-яё]*|поход|созвон[а-яё]*'), 'cal'],
  [word('записк[а-яё]*|сюрприз[а-яё]*'), 'note'],
  [word('мест[а-яё]*|сходить|съездить|заглянуть|кафе|ресторан|бар|музей|выставк[а-яё]*'), 'place'],
  [word('дело|дела|задач[а-яё]*|сделать|не\\s+забыть|оплат[а-яё]*|почин[а-яё]*|убра[а-яё]*|помыть|постирать|записаться'), 'chore'],
  [word('хочу|хотел[а]?'), 'wish'],
];

// Слова-команды и служебные обороты, которые в названии не нужны.
const FILLERS: RegExp[] = [
  re(`^(?:слушай|эй|окей|ок|привет|короче)[,\\s]+`),
  re(`^(?:давай|давайте|пожалуйста)[,\\s]+`),
  re(`${L}(?:добавь|добавить|создай|создать|запиши|записать|поставь|поставить|запланируй|запланировать|внеси|внести|сделай|сделать|закинь|предложи|предложить|напиши|написать|забронируй)${R}`, 'gi'),
  re(`${L}(?:которое|которая|который)\\s+(?:будет\\s+)?(?:называется|называться|назвать)${R}`, 'gi'),
  re(`${L}(?:под\\s+названием|названием|называется|называться)${R}`, 'gi'),
  re(`${L}(?:мне|нам|себе|ему|ей|пожалуйста|пожалста)${R}`, 'gi'),
  re(`${L}(?:в\\s+календарь|календарь|в\\s+календаре)${R}`, 'gi'),
  re(`${L}(?:встречу|встреча|событие|задачу|задача|напоминание|напоминалку|дело)${R}`, 'gi'),
  re(`${L}(?:в\\s+вишлист|вишлист|в\\s+список\\s+покупок|список\\s+покупок|в\\s+покупки|в\\s+дела|в\\s+места)${R}`, 'gi'),
  re(`${L}(?:хочу|хотим|хотел|хотела|хотелось\\s+бы|надо|нужно|планиру[ею]м?|собираемся)${R}`, 'gi'),
  re(`${L}(?:рецепт|место|задачу|про|насчёт|насчет)${R}`, 'gi'),
  re(`${L}(?:вдвоём|вдвоем|вместе)${R}`, 'gi'),
  re(`${L}с\\s+(?:тобой|девушк[а-яё]+|женой|мужем|партнёром|партнером|парнем)${R}`, 'gi'),
];

const EDGE_WORDS = 'и|а|в|во|на|к|ко|с|со|о|об|про|для|что|чтобы|бы|же|ну|там|это|вот|его|её|ему|ей|он|она|они|мы|до|после|около|примерно|тоже|ещё|еще';
const EDGE = re(`^(?:[\\s,.;:—–-]|(?:${EDGE_WORDS})(?=\\s|$))+`, 'i');

function trimEdges(t: string): string {
  let prev = '';
  let s = t.trim();
  const tail = re(`^(?:${EDGE_WORDS})$`, 'i');
  while (s !== prev) {
    prev = s;
    s = s.replace(EDGE, '').trim();
    const parts = s.split(/\s+/);
    while (parts.length > 1 && tail.test(parts[parts.length - 1])) parts.pop();
    s = parts.join(' ').replace(/[\s,.;:—–-]+$/, '').trim();
  }
  return s;
}

const DEFAULT_TITLE: Record<Kind, string> = {
  task: 'Задача', cal: 'Встреча', wish: 'Желание', shopping: 'Покупка', chore: 'Дело',
  place: 'Место', recipe: 'Рецепт', note: 'Записка', done: 'Готово', findtime: 'Свободное время',
};

export const KIND_LABEL: Record<Kind, string> = {
  task: 'Задача',
  cal: 'Встреча',
  chore: 'Дело',
  shopping: 'Покупки',
  wish: 'Вишлист',
  place: 'Место',
  recipe: 'Рецепт',
  note: 'Записка',
  done: 'Отметить',
  findtime: 'Найти время',
};

/** Типы, между которыми можно переключиться руками в карточке помощника. */
export const PICKABLE: Kind[] = ['task', 'cal', 'chore', 'shopping', 'wish', 'place', 'recipe', 'note'];

/** Главная функция: превращает фразу в понятное действие. */
export function parseCommand(raw: string, today = new Date()): Parsed {
  const text = raw.trim().replace(/\s+/g, ' ');
  let s = text;

  // «отметь, что купил молоко» — ничего больше разбирать не нужно
  if (DONE_RE.test(s)) {
    let title = s.replace(DONE_ALL, ' ');
    for (const f of FILLERS) title = title.replace(f, ' ');
    title = trimEdges(title.replace(/\s{2,}/g, ' '));
    return { kind: 'done', title: title || text, raw: text };
  }

  const instead = re(`${L}(?:вместо|перенес[а-яё]*|замен[а-яё]*)${R}`).test(s);
  const mInstead = re(`${L}(?:вместо|заместо)\\s+(.+?)\\s+(?:предлож[а-яё]*|давай|лучше|пусть|сходим|пойдём|пойдем)\\s+(.+)$`).exec(s);
  if (mInstead) s = mInstead[2];

  let url: string | undefined;
  const mUrl = /(https?:\/\/\S+|(?:^|\s)[a-z0-9][a-z0-9-]*\.(?:ru|by|com|org|net|io|me|ua|kz|pl|de|shop|store|info|biz)(?:\/\S*)?)/i.exec(s);
  if (mUrl) {
    url = mUrl[1].trim();
    s = (s.slice(0, mUrl.index) + ' ' + s.slice(mUrl.index + mUrl[0].length)).replace(/\s{2,}/g, ' ').trim();
  }

  // «в проект Сайты», «место спортзал», «срочно» — только для задач
  let project: string | undefined, place: string | undefined;
  const END = `(?=$|[,.]|\\s+(?:на|в|до|к|за|срочно|напомни[а-яё]*|место|адрес|завтра|сегодня|послезавтра)(?:\\s|$))`;
  const mProj = re(`${L}(?:в|по|для)\\s+проект[а-яё]*\\s+([${W}-]+)(?![${W}-])`).exec(s);
  if (mProj) { project = mProj[1].trim(); s = (s.slice(0, mProj.index) + ' ' + s.slice(mProj.index + mProj[0].length)).replace(/\s{2,}/g, ' ').trim(); }
  const mPlace = re(`${L}(?:место|адрес|локация)[:\\s]+([^,.]+?)${END}`).exec(s);
  if (mPlace) { place = mPlace[1].trim(); s = (s.slice(0, mPlace.index) + ' ' + s.slice(mPlace.index + mPlace[0].length)).replace(/\s{2,}/g, ' ').trim(); }
  const urgent = word('срочн[а-яё]*|дедлайн[а-яё]*').test(s);
  if (urgent) s = s.replace(re(`${L}срочн[а-яё]*${R}`, 'gi'), ' ').replace(/\s{2,}/g, ' ').trim();

  const askedTime = FIND_RE.test(s);
  const together = TOGETHER_RE.test(s);
  const wants = WANT_RE.test(s);
  s = s.replace(FIND_RE, ' ');

  let duration: number | undefined, remind: number | undefined, period: { from: string; to: string } | undefined;
  [duration, s] = parseDuration(s);
  [remind, s] = parseRemind(s);
  [period, s] = parsePeriod(s, today);
  let date: string | undefined, time: string | undefined;
  [date, s] = parseDate(s, today);
  [time, s] = parseTime(s);

  let kind: Kind | undefined;
  for (const [pattern, k] of KIND_RULES) {
    if (pattern.test(s)) { kind = k; break; }
  }
  // Поиск времени: либо прямо попросили, либо «хотим что-то на следующей неделе» без точного дня.
  // Для покупок, дел и желаний время не ищем — там это не нужно.
  const calLike = !kind || kind === 'cal' || kind === 'recipe' || kind === 'place';
  const findtime = askedTime || (!!period && !date && !time && wants && calLike);

  if ((project || urgent) && !findtime) kind = 'task';
  if (findtime) kind = 'findtime';
  else if (!kind && (date || time || remind !== undefined)) kind = 'cal';
  else if (!kind) kind = url ? 'wish' : 'shopping';
  // «приготовить суши в субботу» — это встреча, а не карточка рецепта
  if (kind === 'recipe' && (date || time)) kind = 'cal';
  // «надо записаться к врачу на следующей неделе» — дело со сроком
  if ((kind === 'chore' || kind === 'task') && period && !date) date = period.to;

  let title = s;
  for (const f of FILLERS) title = title.replace(f, ' ');
  title = trimEdges(title.replace(/\s{2,}/g, ' '));
  if (!title) title = DEFAULT_TITLE[kind];
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const out: Parsed = { kind, title, date, time, remind_min: remind, duration_min: duration, url, instead, raw: text };
  if (kind === 'task') { out.place = place; out.project = project; out.urgent = urgent; }
  if (together) out.together = true;
  if (findtime) {
    const base = startOfDay(today);
    out.from = period?.from ?? date ?? iso(base);
    out.to = period?.to ?? date ?? iso(shift(base, 13));
    out.duration_min = duration ?? 120;
  }
  return out;
}

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
