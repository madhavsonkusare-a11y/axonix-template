/**
 * Google Calendar, from the page's side.
 *
 * The desktop app talks to Google only in the main process (`electron/gcal.ts`,
 * exposed as `window.axonixCalendar`): tokens and the client secret never reach
 * the page. In a plain browser (the Vite dev server) a stand-in with made-up
 * events lets the calendar be clicked through; it is never used by the app.
 */

export interface CalStatus {
  configured: boolean;
  clientId: string | null;
  connected: boolean;
  account: string | null;
  axonixCalendarId: string | null;
  shown: string[];
  lastSync: number | null;
  error: string | null;
  signingIn: boolean;
}

export interface CalEvent {
  id: string;
  calendarId: string;
  title: string;
  /** `YYYY-MM-DD` when all-day, else local `YYYY-MM-DDTHH:mm`. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  htmlLink?: string;
  color: string;
}

export interface CalInfo {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  axonix: boolean;
  shown: boolean;
}

export interface Block {
  taskId: string;
  title: string;
  start: string;
  end: string;
  done: boolean;
  path: string;
}

export type Remote = { taskId: string; start: string; end: string } | { taskId: string; removed: true };

export interface CalendarBridge {
  status(): Promise<CalStatus>;
  setClient(id: string, secret: string): Promise<CalStatus>;
  connect(): Promise<CalStatus>;
  disconnect(forgetClient: boolean): Promise<CalStatus>;
  calendars(): Promise<CalInfo[]>;
  setShown(ids: string[]): Promise<CalStatus>;
  events(fromDay: string, toDay: string): Promise<{ events: CalEvent[]; stale: boolean; fetchedAt: number }>;
  syncBlocks(blocks: Block[], keep: string[]): Promise<{ remote: Remote[]; created: number; updated: number; deleted: number }>;
}

export const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

/* ------------------------------------------------------------------ */
/* the browser stand-in                                                */
/* ------------------------------------------------------------------ */

const KEY = 'axonix:gcal:demo';
const read = (): { client?: string; connected?: boolean; shown?: string[] } => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
};
const write = (v: object) => localStorage.setItem(KEY, JSON.stringify(v));
const DEMO_CALS: CalInfo[] = [
  { id: 'me@example.com', name: 'Personal', color: '#5b8cff', primary: true, axonix: false, shown: true },
  { id: 'work', name: 'Work', color: '#5fe0a2', primary: false, axonix: false, shown: true },
  { id: 'axonix', name: 'Axonix', color: '#7cc4ff', primary: false, axonix: true, shown: false },
];

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function demoEvents(fromDay: string, toDay: string, shown: string[]): CalEvent[] {
  const out: CalEvent[] = [];
  const from = new Date(`${fromDay}T00:00`);
  const to = new Date(`${toDay}T00:00`);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const day = dayOf(d);
    const wd = d.getDay();
    if (wd >= 1 && wd <= 5 && shown.includes('work')) {
      out.push({ id: `standup-${day}`, calendarId: 'work', title: 'Standup', start: `${day}T10:00`, end: `${day}T10:15`, allDay: false, color: '#5fe0a2', htmlLink: 'https://calendar.google.com' });
    }
    if (wd === 2 && shown.includes('work')) out.push({ id: `review-${day}`, calendarId: 'work', title: 'Design review', start: `${day}T14:00`, end: `${day}T15:30`, allDay: false, location: 'Meet', color: '#5fe0a2' });
    if (wd === 4 && shown.includes('me@example.com')) out.push({ id: `gym-${day}`, calendarId: 'me@example.com', title: 'Gym', start: `${day}T18:30`, end: `${day}T19:30`, allDay: false, color: '#5b8cff' });
    if (wd === 6 && shown.includes('me@example.com')) {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      out.push({ id: `bday-${day}`, calendarId: 'me@example.com', title: 'Aai’s birthday', start: day, end: dayOf(next), allDay: true, color: '#5b8cff' });
    }
  }
  return out;
}

const browser: CalendarBridge = {
  async status() {
    const v = read();
    return {
      configured: !!v.client,
      clientId: v.client ?? null,
      connected: !!v.connected,
      account: v.connected ? 'me@example.com' : null,
      axonixCalendarId: v.connected ? 'axonix' : null,
      shown: v.shown ?? ['me@example.com', 'work'],
      lastSync: v.connected ? Date.now() : null,
      error: null,
      signingIn: false,
    };
  },
  async setClient(id) {
    write({ ...read(), client: id });
    return this.status();
  },
  async connect() {
    await new Promise((r) => setTimeout(r, 900));
    write({ ...read(), connected: true });
    return this.status();
  },
  async disconnect(forget) {
    write(forget ? {} : { client: read().client });
    return this.status();
  },
  async calendars() {
    const shown = read().shown ?? ['me@example.com', 'work'];
    return DEMO_CALS.map((c) => ({ ...c, shown: shown.includes(c.id) }));
  },
  async setShown(ids) {
    write({ ...read(), shown: ids });
    return this.status();
  },
  async events(fromDay, toDay) {
    if (!read().connected) throw new Error('Google Calendar is not connected.');
    return { events: demoEvents(fromDay, toDay, read().shown ?? ['me@example.com', 'work']), stale: false, fetchedAt: Date.now() };
  },
  async syncBlocks() {
    return { remote: [], created: 0, updated: 0, deleted: 0 };
  },
};

const desktopBridge: CalendarBridge | null =
  typeof window !== 'undefined' ? ((window as unknown as { axonixCalendar?: CalendarBridge }).axonixCalendar ?? null) : null;

export const calendar: CalendarBridge = desktopBridge ?? browser;
export const isDesktopCalendar = desktopBridge !== null;
