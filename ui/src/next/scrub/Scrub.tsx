/**
 * Scrub: one day that every module shows itself as of.
 *
 * At rest that day is today and nothing is different. Drag the ruler back and
 * each module shows how things stood at the end of that day; drag it ahead and
 * each shows what is expected by then, in blue, because it has not happened.
 *
 * While the day is not today, the workspace is for looking, not changing: the
 * lenses each module reads through refuse changes and say why. The past cannot
 * be edited by accident, and a forecast is never written down as fact.
 *
 * Keys: T opens and closes the ruler. On the ruler, ← → move a day, Shift a
 * week, Home is today. Alt + scroll over the page moves a day at a time.
 * Escape closes the ruler, then returns to today.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { addDays, dateOf, daysBetween, isoOf } from '../../finance/format';

/** How far the ruler reaches, in days. The past is known; a forecast thins out quickly. */
export const BACK = 60;
export const AHEAD = 30;

export interface AsOf {
  /** The day being shown. */
  day: string;
  /** The real today. */
  today: string;
  /** `day` is today: nothing is being scrubbed. */
  live: boolean;
  past: boolean;
  future: boolean;
}

interface ScrubValue extends AsOf {
  open: boolean;
  setOpen: (open: boolean) => void;
  setDay: (day: string) => void;
  /** Back to today, ruler closed. */
  reset: () => void;
}

const Ctx = createContext<ScrubValue | null>(null);

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

function useRealToday(): string {
  const [today, setToday] = useState(() => isoOf(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setToday(isoOf(new Date())), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

export function ScrubProvider({ children }: { children: ReactNode }) {
  const today = useRealToday();
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const day = picked ?? today;

  const setDay = useCallback(
    (next: string) => {
      const lo = addDays(today, -BACK);
      const hi = addDays(today, AHEAD);
      const clamped = next < lo ? lo : next > hi ? hi : next;
      setPicked(clamped === today ? null : clamped);
    },
    [today],
  );
  const reset = useCallback(() => {
    setPicked(null);
    setOpen(false);
  }, []);

  const state = useRef({ day, open, picked });
  state.current = { day, open, picked };

  useEffect(() => {
    const inShell = () => document.documentElement.dataset.nx === 'true';
    const busy = () => Boolean(document.querySelector('dialog[open], .palette, .fin-menu, .nxc-pop, .ax-ask'));
    const onKey = (e: KeyboardEvent) => {
      if (!inShell() || e.defaultPrevented) return;
      const s = state.current;
      if (e.key === 'Escape' && (s.open || s.picked) && !busy()) {
        // One press does one thing: the ruler closes first, then the day returns.
        e.preventDefault();
        e.stopPropagation();
        if (s.open) setOpen(false);
        else setPicked(null);
        return;
      }
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target) && !busy()) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(!s.open);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || !inShell() || busy()) return;
      if (!(e.target instanceof Element) || !e.target.closest('.nx-sheet')) return;
      e.preventDefault();
      setOpen(true);
      setDay(addDays(state.current.day, e.deltaY > 0 ? 1 : -1));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel);
    };
  }, [setDay]);

  const value = useMemo<ScrubValue>(
    () => ({ day, today, live: day === today, past: day < today, future: day > today, open, setOpen, setDay, reset }),
    [day, today, open, setDay, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const nothing = () => {};

export function useScrub(): ScrubValue {
  const v = useContext(Ctx);
  if (v) return v;
  // Outside a provider (the Storeroom's own window) there is no other day to show.
  const real = isoOf(new Date());
  return { day: real, today: real, live: true, past: false, future: false, open: false, setOpen: nothing, setDay: nothing, reset: nothing };
}

/** The day to show things as of. Outside a provider (a first-version screen) it is today. */
export function useAsOf(): AsOf {
  const v = useContext(Ctx);
  const real = isoOf(new Date());
  return v ?? { day: real, today: real, live: true, past: false, future: false };
}

/** The day a view should treat as "today". */
export const useDay = () => useAsOf().day;

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `Friday 18 September`. */
export function longDay(iso: string): string {
  const d = dateOf(iso);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}
/** `Fri 18 Sep`. */
export function shortDay(iso: string): string {
  const d = dateOf(iso);
  return `${WEEKDAY[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTH[d.getMonth()].slice(0, 3)}`;
}
/** `14 days ago`, `yesterday`, `in 3 days`. */
export function relDay(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

/** Said when something tries to change the workspace while it is showing another day. */
let lastSaid = 0;
const REFUSAL = 'scrub-refusal';
export function refuseChange(day: string) {
  // A screen that asked for the change may go on to say "Deleted" or
  // "Confirmed" as if it had happened. Whatever is said in the same breath is
  // taken back: a refused change is never followed by its success.
  const before = new Set(toast.getToasts().map((t) => t.id));
  window.setTimeout(() => {
    for (const t of toast.getToasts()) if (!before.has(t.id) && t.id !== REFUSAL) toast.dismiss(t.id);
  }, 0);
  // One toast, not one for each key of a blocked gesture.
  if (Date.now() - lastSaid < 1500) return;
  lastSaid = Date.now();
  toast(`You are looking at ${shortDay(day)}.`, { id: REFUSAL, description: 'Go back to today to change anything. Press Esc, or Today on the ruler.' });
}
