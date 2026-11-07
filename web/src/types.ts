import type { User } from './components/ui';

export type Boot = {
  me: User;
  partner: User | null;
  couple: { id: number; invite_code: string; start_date: string | null } | null;
  start_param: string | null;
  bot_username: string | null;
  today: string;
};

export type Today = {
  day: string;
  days_together: number | null;
  start_date: string | null;
  mood: { me: string | null; partner: string | null };
  question: { text: string; my_answer: string | null; partner_answered: boolean; partner_answer: string | null };
  upcoming: { title: string; date: string; time: string | null; kind: string | null; in_days: number }[];
  activity: { id: number; kind: string; text: string; created_at: number; name: string; user_id: number; photo_url: string | null; mine: boolean }[];
};

export type Place = {
  id: number; title: string; category: string | null; note: string | null; status: 'want' | 'visited';
  rating: number | null; want_return: number; visited_at: string | null; review: string | null;
  added_by: number; added_by_name: string; mine: boolean;
};
export type Shop = { id: number; title: string; category: string | null; done: number; done_by: number | null; done_by_name: string | null };
export type Chore = { id: number; title: string; done: number; due_date: string | null; repeat_days: number | null };
export type Recipe = { id: number; title: string; note: string | null };
export type Wish = { id: number; kind: 'gift' | 'watch' | 'dream'; title: string; price: string | null; url: string | null; image_url: string | null; mine: boolean; claimed_by_me: boolean };
export type Note = { id: number; mine: boolean; from_name: string; text: string | null; locked: boolean; open_at: number | null; created_at: number };
export type EventT = { id: number; title: string; date: string; time: string | null; kind: string | null; yearly: number };
