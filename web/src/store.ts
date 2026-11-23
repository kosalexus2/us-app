import { useEffect, useSyncExternalStore } from 'react';
import { WebApp } from './tg';
import { post } from './api';

/**
 * Задачи, проекты и шаблоны хранятся в Telegram человека (CloudStorage Mini App):
 * приватно, синхронизируется между устройствами, диск сервера не используется.
 * На сервер уходит только очередь напоминаний (когда и что напомнить).
 */
export type Repeat = { type: 'days'; every: number } | { type: 'week'; days: number[] }; // days: 0 = пн … 6 = вс
export type Sub = { t: string; d: boolean };
export type Task = {
  id: string; title: string; project: string; kind: 'list' | 'urgent' | 'big';
  due?: string; time?: string; place?: string; note?: string;
  remind?: number | null; // минут до срока; null или нет: без напоминания
  subs: Sub[]; done: boolean; done_at?: string; repeat?: Repeat | null; people: number[]; created: string;
};
export type Project = { id: string; name: string; color: string };
export type Template = { id: string; title: string; project: string; time?: string; place?: string; remind?: number | null; duration?: number; days: number[] };
export type Settings = { remind: number | null; day_hour: number; quiet: [number, number] | null };
export type Doc = { v: 1; projects: Project[]; tasks: Task[]; templates: Template[]; settings: Settings };

export const COLORS = ['#5B4BF2', '#2FA36B', '#E8913A', '#D94F70', '#2D9CDB', '#8A8FA3'];
const EMPTY = (): Doc => ({
  v: 1,
  projects: [{ id: 'main', name: 'Личное', color: COLORS[0] }],
  tasks: [], templates: [],
  settings: { remind: 60, day_hour: 9, quiet: [23, 8] },
});

const TZ = 3; // Минск
const CHUNK = 3500;
const CS = WebApp?.CloudStorage as
  | { getItem: Function; setItem: Function; getItems: Function; removeItems: Function }
  | undefined;

// Единый интерфейс: CloudStorage в Telegram, localStorage в обычном браузере (для разработки).
const kv = {
  get: (keys: string[]) => new Promise<Record<string, string>>((res) => {
    if (CS) CS.getItems(keys, (err: unknown, v: Record<string, string>) => res(err ? {} : v || {}));
    else res(Object.fromEntries(keys.map((k) => [k, localStorage.getItem('cs_' + k) ?? ''])));
  }),
  set: (k: string, v: string) => new Promise<void>((res) => {
    if (CS) CS.setItem(k, v, () => res());
    else { try { localStorage.setItem('cs_' + k, v); } catch {} res(); }
  }),
  del: (keys: string[]) => new Promise<void>((res) => {
    if (!keys.length) return res();
    if (CS) CS.removeItems(keys, () => res());
    else { keys.forEach((k) => localStorage.removeItem('cs_' + k)); res(); }
  }),
};

let doc: Doc = EMPTY();
let ready = false;
let loading = false;
let nChunks = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

async function load() {
  if (loading) return;
  loading = true;
  try {
    const meta = (await kv.get(['dn']))['dn'];
    const n = Number(meta) || 0;
    if (n > 0) {
      const keys = Array.from({ length: n }, (_, i) => 'd' + i);
      const vals = await kv.get(keys);
      const text = keys.map((k) => vals[k] || '').join('');
      const parsed = JSON.parse(text) as Doc;
      if (parsed?.v === 1) {
        doc = { ...EMPTY(), ...parsed, settings: { ...EMPTY().settings, ...parsed.settings } };
        nChunks = n;
      }
    }
    // чистим давно выполненное, чтобы хранилище не пухло
    const cut = new Date(Date.now() - 45 * 86400e3).toISOString().slice(0, 10);
    doc.tasks = doc.tasks.filter((t) => !(t.done && !t.repeat && (t.done_at || '') < cut));
  } catch { /* пустое хранилище */ }
  ready = true;
  emit();
  queueSync();
}

let saveT: number | undefined;
let syncT: number | undefined;
function persist() {
  window.clearTimeout(saveT);
  saveT = window.setTimeout(async () => {
    const text = JSON.stringify(doc);
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    for (let i = 0; i < parts.length; i++) await kv.set('d' + i, parts[i]);
    await kv.set('dn', String(parts.length));
    if (nChunks > parts.length) await kv.del(Array.from({ length: nChunks - parts.length }, (_, i) => 'd' + (parts.length + i)));
    nChunks = parts.length;
  }, 700);
}

const dt = (date: string, hhmm: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d, h, mi) - TZ * 3600e3) / 1000);
};
/** Когда присылать напоминание по задаче (секунды) или null. */
export function fireAt(t: Task, s: Settings): number | null {
  if (t.done || !t.due || t.remind == null) return null;
  const base = dt(t.due, `${String(s.day_hour).padStart(2, '0')}:00`);
  let at = t.time ? dt(t.due, t.time) - t.remind * 60 : t.remind >= 1440 ? base - t.remind * 60 : base; // без времени: утром в день срока
  if (s.quiet) {
    const [from, to] = s.quiet;
    const h = new Date((at + TZ * 3600) * 1000).getUTCHours();
    const inQuiet = from > to ? h >= from || h < to : h >= from && h < to;
    if (inQuiet) {
      const day = new Date((at + TZ * 3600) * 1000).toISOString().slice(0, 10);
      let end = dt(day, `${String(to).padStart(2, '0')}:00`);
      if (end <= at) end += 86400;
      at = end;
    }
  }
  return at;
}
function queueSync() {
  window.clearTimeout(syncT);
  syncT = window.setTimeout(() => {
    const t = Math.floor(Date.now() / 1000);
    const items = doc.tasks
      .map((k) => ({ k, at: fireAt(k, doc.settings) }))
      .filter((x): x is { k: Task; at: number } => x.at != null && x.at > t - 600 && x.at < t + 100 * 86400)
      .map(({ k, at }) => ({
        ref: k.id, at,
        text: `${k.title}${k.time ? ` в ${k.time}` : ''}${k.place ? ` · ${k.place}` : ''}`,
      }));
    post('/reminders/sync', { items }).catch(() => {});
  }, 1500);
}

export function mutate(fn: (d: Doc) => void) {
  const next = structuredClone(doc);
  fn(next);
  doc = next;
  emit();
  persist();
  queueSync();
}

export function useDoc() {
  useEffect(() => { if (!ready) load(); }, []);
  const d = useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => doc);
  return { doc: d, ready };
}

// ---------- действия ----------
export const newTask = (p: Partial<Task> = {}): Task => ({
  id: uid(), title: '', project: doc.projects[0]?.id ?? 'main', kind: 'list', subs: [], done: false, people: [],
  remind: doc.settings.remind, created: new Date().toISOString().slice(0, 10), ...p,
});
export const addTask = (t: Task) => mutate((d) => { d.tasks.unshift(t); });
export const saveTask = (t: Task) => mutate((d) => { const i = d.tasks.findIndex((x) => x.id === t.id); if (i >= 0) d.tasks[i] = t; else d.tasks.unshift(t); });
export const removeTask = (id: string) => mutate((d) => { d.tasks = d.tasks.filter((t) => t.id !== id); });
export const getDoc = () => doc;

const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const wd = (date: string) => (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
/** Следующая дата повтора после `from`. */
export function nextDate(r: Repeat, from: string): string {
  if (r.type === 'days') return addDays(from, Math.max(1, r.every));
  const days = r.days.length ? r.days : [wd(from)];
  for (let i = 1; i <= 7; i++) if (days.includes(wd(addDays(from, i)))) return addDays(from, i);
  return addDays(from, 7);
}
/** Выполнить задачу: повторяющаяся переезжает на следующую дату, обычная закрывается. Возвращает новую дату или null. */
export function completeTask(id: string, today: string): string | null {
  let next: string | null = null;
  mutate((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.done) { t.done = false; delete t.done_at; return; }
    if (t.repeat && t.due) {
      let n = nextDate(t.repeat, t.due);
      while (n <= today && n < addDays(today, 400)) n = nextDate(t.repeat, n);
      t.due = n; t.subs = t.subs.map((s) => ({ ...s, d: false })); next = n;
    } else { t.done = true; t.done_at = today; }
  });
  return next;
}
export const postpone = (id: string, to: string) => mutate((d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.due = to; });

/** Найти проект по названию без создания. */
export function findProject(name?: string): Project | undefined {
  if (!name) return undefined;
  const n = name.trim().toLowerCase();
  return doc.projects.find((p) => p.name.toLowerCase() === n) ||
    doc.projects.find((p) => n.length >= 3 && (p.name.toLowerCase().startsWith(n.slice(0, 4)) || n.startsWith(p.name.toLowerCase().slice(0, 4))));
}
/** Найти проект по названию или создать. Для голосового помощника. */
export function projectByName(name?: string): string {
  if (!name) return doc.projects[0]?.id ?? 'main';
  const f = findProject(name);
  if (f) return f.id;
  const id = uid();
  mutate((d) => { d.projects.push({ id, name: name.trim().charAt(0).toUpperCase() + name.trim().slice(1), color: COLORS[d.projects.length % COLORS.length] }); });
  return id;
}
