/**
 * A "thing": anything in Axonix that can be picked up. Everything can.
 *
 * Three families:
 *
 * - **Records** are what the modules keep: a transaction, a task (a time block
 *   is a task with a time), a calendar event, a note, a Storeroom reference.
 * - **Places** are what records hang on and what pages are made of: an account,
 *   a way to pay, a category, a budget, a subscription, an identity document
 *   (never its number), a project, a tag, a day, and a **part** of a page (a
 *   card, a panel, a chart, a view). A part's id is where it is:
 *   `finance/overview#net-worth`.
 * - **Loose things** have no home in Axonix yet: words (a selection, a figure,
 *   a heading), a link, an image, a file. They come from a page or from
 *   outside the window. They can be carried, asked about and turned into a
 *   task, a note or a reference, but not linked: a link needs both ends to
 *   stay put.
 *
 * A thing is described by its kind and id plus a few words to show for it, so
 * it can be drawn anywhere, including in a module that does not have the
 * thing's own data loaded. `text` is what it says in plain words: what a note
 * made from it holds, and what the assistant is told about it.
 *
 * A row or card names its thing with `liftAttrs(thing)`. Anything that names
 * nothing is still liftable: `resolve.ts` works out what it is from the page.
 * A place that takes a drop carries `data-drop` (see Lift.tsx).
 */
import { Archive, Calendar, CalendarDays, Component, CreditCard, File, Folder, Hash, IdCard, Image, Landmark, Link2, NotebookPen, PiggyBank, Repeat, Shapes, SquareCheck, Type, Wallet, type LucideIcon } from 'lucide-react';
import type { CalEvent } from '../../calendar/backend';
import type { Account, Budget, DigitalId, FinanceData, PaymentMethod, Subscription, Transaction } from '../../finance/types';
import * as L from '../../finance/ledger';
import { dateOf, moneyIn, shortDate } from '../../finance/format';
import { KIND_LABEL, type Note } from '../../notes/notefile';
import type { StoreItem } from '../../storeroom/types';
import { projectLabel } from '../../tasks/derive';
import type { Task } from '../../tasks/types';

export const RECORD_KINDS = ['txn', 'task', 'event', 'note', 'ref'] as const;
export const PLACE_KINDS = ['account', 'method', 'category', 'budget', 'subscription', 'id', 'project', 'tag', 'day', 'part'] as const;
export const LOOSE_KINDS = ['text', 'link', 'image', 'file'] as const;
export type ThingKind = (typeof RECORD_KINDS)[number] | (typeof PLACE_KINDS)[number] | (typeof LOOSE_KINDS)[number];
const KINDS: readonly string[] = [...RECORD_KINDS, ...PLACE_KINDS, ...LOOSE_KINDS];

export interface Thing {
  kind: ThingKind;
  id: string;
  title: string;
  /** One quiet line: where it lives and when. */
  sub?: string;
  /** A figure, already formatted. */
  amount?: string;
  /** The figure is money in. */
  pos?: boolean;
  /** The day it belongs to, `YYYY-MM-DD`, when it has one. */
  day?: string;
  /** What it says, in plain words. */
  text?: string;
  /** A web address: a link, an image's source. */
  url?: string;
  /** A file on this computer. */
  path?: string;
  /** A part of a page: the module and view it is on, `finance/overview`. */
  at?: string;
}

export const KIND_ICON: Record<ThingKind, LucideIcon> = {
  txn: Wallet,
  task: SquareCheck,
  event: CalendarDays,
  note: NotebookPen,
  ref: Archive,
  account: Landmark,
  method: CreditCard,
  category: Shapes,
  budget: PiggyBank,
  subscription: Repeat,
  id: IdCard,
  project: Folder,
  tag: Hash,
  day: Calendar,
  part: Component,
  text: Type,
  link: Link2,
  image: Image,
  file: File,
};
export const KIND_NAME: Record<ThingKind, string> = {
  txn: 'Transaction',
  task: 'Task',
  event: 'Event',
  note: 'Note',
  ref: 'Reference',
  account: 'Account',
  method: 'Way to pay',
  category: 'Category',
  budget: 'Budget',
  subscription: 'Subscription',
  id: 'Document',
  project: 'Project',
  tag: 'Tag',
  day: 'Day',
  part: 'Part of a page',
  text: 'Text',
  link: 'Link',
  image: 'Image',
  file: 'File',
};
/** Where a thing lives, for "Open in …". Loose things live nowhere yet. */
export const KIND_MODULE: Record<ThingKind, string> = {
  txn: 'Finance',
  task: 'Tasks',
  event: 'Calendar',
  note: 'Notes',
  ref: 'Storeroom',
  account: 'Finance',
  method: 'Finance',
  category: 'Finance',
  budget: 'Finance',
  subscription: 'Finance',
  id: 'Finance',
  project: 'Tasks',
  tag: 'Storeroom',
  day: 'Calendar',
  part: 'Axonix',
  text: 'Axonix',
  link: 'your browser',
  image: 'Axonix',
  file: 'this computer',
};

export const keyOf = (t: { kind: string; id: string }) => `${t.kind}:${t.id}`;
export const same = (a: { kind: string; id: string }, b: { kind: string; id: string }) => a.kind === b.kind && a.id === b.id;
/** No home in Axonix yet: it can be carried and converted, but not linked. */
export const isLoose = (t: { kind: string }) => (LOOSE_KINDS as readonly string[]).includes(t.kind);
/** What a thing says, in plain words. */
export const textOf = (t: Thing) => t.text ?? [t.title, t.sub, t.amount].filter(Boolean).join(' · ');

/** A short, stable id for something that has none of its own. */
export function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const slugOf = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'part';

/* ---------- describing each kind ---------- */

export function txnThing(t: Transaction, data: FinanceData): Thing {
  const account = L.accountById(data, t.accountId);
  const currency = account?.currency ?? 'INR';
  return {
    kind: 'txn',
    id: t.id,
    title: t.merchant || (t.kind === 'transfer' ? 'Transfer' : 'Entry'),
    sub: `${t.kind === 'transfer' ? 'Transfer' : t.category} · ${shortDate(t.date)}`,
    amount: t.kind === 'transfer' ? moneyIn(Math.abs(t.amount), currency) : moneyIn(t.amount, currency, { signed: true }),
    pos: t.kind === 'income',
    day: t.date,
  };
}

export function taskThing(t: Task): Thing {
  return {
    kind: 'task',
    id: t.id,
    title: t.title,
    sub: [projectLabel(t.project), t.scheduled ? `${shortDate(t.scheduled.slice(0, 10))} ${t.scheduled.slice(11, 16)}` : t.due ? `due ${shortDate(t.due)}` : ''].filter(Boolean).join(' · '),
    day: t.scheduled?.slice(0, 10) ?? t.due,
  };
}

export function eventThing(e: CalEvent): Thing {
  const day = e.start.slice(0, 10);
  return { kind: 'event', id: `${e.calendarId}/${e.id}`, title: e.title, sub: e.allDay ? `${shortDate(day)} · all day` : `${shortDate(day)} · ${e.start.slice(11, 16)}`, day };
}

export function noteThing(n: Note): Thing {
  return { kind: 'note', id: n.path, title: n.title || 'Untitled', sub: n.project || KIND_LABEL[n.kind] };
}

export function refThing(item: StoreItem): Thing {
  return { kind: 'ref', id: item.id, title: item.title || item.id, sub: `Storeroom · ${item.id}` };
}

export function accountThing(a: Account, data: FinanceData): Thing {
  const set = L.hasBalance(data, a.id);
  return { kind: 'account', id: a.id, title: a.name, sub: L.KIND_LABEL[a.kind], amount: set ? moneyIn(L.balanceOf(data, a.id), a.currency) : undefined };
}

export function methodThing(m: PaymentMethod, data: FinanceData): Thing {
  return { kind: 'method', id: m.id, title: m.name, sub: `Way to pay · ${L.accountById(data, m.accountId)?.name ?? 'no account'}` };
}

/** A spending category, by name. `spent` is what to show beside it, already formatted. */
export function categoryThing(name: string, spent?: string): Thing {
  return { kind: 'category', id: name, title: name, sub: 'Category', amount: spent };
}

export function budgetThing(b: Budget, spent?: string): Thing {
  return { kind: 'budget', id: b.category, title: `${b.category} budget`, sub: spent ? `${spent} spent` : 'Budget', amount: moneyIn(b.limit, 'INR') };
}

export function subscriptionThing(s: Subscription, next?: string): Thing {
  return { kind: 'subscription', id: s.id, title: s.name, sub: next ? `Renews ${shortDate(next)}` : 'Subscription', amount: moneyIn(s.amount, 'INR'), day: next };
}

/** An identity document. Its number is never part of the thing: only what it is and when it ends. */
export function idThing(d: DigitalId): Thing {
  return { kind: 'id', id: d.id, title: d.label, sub: d.expiresOn ? `Expires ${shortDate(d.expiresOn)}` : 'Document', day: d.expiresOn };
}

export function projectThing(name: string, open?: number): Thing {
  return { kind: 'project', id: name || 'Inbox', title: projectLabel(name), sub: open === undefined ? 'Project' : `Project · ${open} open` };
}

export function tagThing(tag: string): Thing {
  return { kind: 'tag', id: tag, title: `#${tag}`, sub: 'Tag' };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function dayThing(iso: string): Thing {
  const d = dateOf(iso);
  return { kind: 'day', id: iso, title: `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`, sub: String(d.getFullYear()), day: iso };
}

/** Words with no home: a selection, a figure, a heading, text dragged in. */
export function textThing(text: string, from?: string): Thing {
  const clean = text.replace(/[ \t]+\n/g, '\n').trim();
  const first = clean.split('\n')[0];
  return { kind: 'text', id: hashOf(clean), title: first.length > 80 ? `${first.slice(0, 79)}…` : first, sub: from, text: clean.slice(0, 12_000) };
}

export function linkThing(url: string, title?: string): Thing {
  let shown = url;
  try {
    const u = new URL(url);
    shown = `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    /* shown as written */
  }
  const named = title?.trim();
  return { kind: 'link', id: hashOf(url), title: named || (shown.length > 60 ? `${shown.slice(0, 59)}…` : shown), sub: named ? shown.slice(0, 60) : 'Link', url, text: named ? `${named}\n${url}` : url };
}

export function imageThing(url: string, title?: string): Thing {
  return { kind: 'image', id: hashOf(url.slice(0, 2000)), title: title?.trim() || 'Image', sub: 'Image', url: url.startsWith('data:') ? undefined : url, text: title?.trim() || undefined };
}

export function fileThing(name: string, path?: string | null, image = false): Thing {
  return { kind: image ? 'image' : 'file', id: hashOf(path ?? name), title: name, sub: image ? 'Image file' : 'File', path: path ?? undefined, text: path ?? name };
}

/* ---------- on the page ---------- */

export interface LiftOptions {
  /** Only a still press lifts it: the element has a drag of its own (a board card, a time block). */
  hold?: boolean;
  /** The element only wraps the row, which is a button of its own (a first-version row reused here). */
  wrap?: boolean;
}

/** Spread on the row or card that stands for `thing`. */
export function liftAttrs(thing: Thing, { hold, wrap }: LiftOptions = {}): Record<string, string | undefined> {
  return {
    'data-lift': keyOf(thing),
    'data-lift-title': thing.title,
    'data-lift-sub': thing.sub,
    'data-lift-amount': thing.amount,
    'data-lift-pos': thing.pos ? '' : undefined,
    'data-lift-day': thing.day,
    'data-lift-text': thing.text,
    'data-lift-url': thing.url,
    'data-lift-at': thing.at,
    'data-lift-hold': hold ? '' : undefined,
    'data-lift-wrap': wrap ? '' : undefined,
  };
}

/** `kind:id` back into its two parts; ids may hold colons and slashes. */
export function parseKey(key: string | undefined): { kind: ThingKind; id: string } | null {
  if (!key) return null;
  const at = key.indexOf(':');
  const kind = key.slice(0, at) as ThingKind;
  const id = key.slice(at + 1);
  return at > 0 && id && KINDS.includes(kind) ? { kind, id } : null;
}

/** The thing an element stands for, read back from `liftAttrs`. */
export function thingOf(el: HTMLElement): Thing | null {
  const ref = parseKey(el.dataset.lift);
  if (!ref) return null;
  const d = el.dataset;
  return {
    ...ref,
    title: d.liftTitle || KIND_NAME[ref.kind],
    sub: d.liftSub || undefined,
    amount: d.liftAmount || undefined,
    pos: d.liftPos !== undefined || undefined,
    day: d.liftDay || undefined,
    text: d.liftText || undefined,
    url: d.liftUrl || undefined,
    at: d.liftAt || undefined,
  };
}
