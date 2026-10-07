/**
 * Date picking in the app's own material.
 *
 * Replaces <input type="date">, whose calendar Windows draws in a different
 * style from every other surface here. After the compact date picker in
 * Apple's HIG: a month grid with today ringed and the chosen day filled, and
 * the month title opens a month-and-year view for jumps (a passport's expiry is
 * years away; nobody should click "next month" sixty times).
 *
 * Keyboard: arrows move by day and week, Page Up/Down by month (with Shift, by
 * year), Home/End to the week's ends, Enter picks, Escape closes. Like menus,
 * the calendar renders inside the open <dialog> so a sheet does not make it
 * inert.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dateOf, todayIso } from '../format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EDGE = 8;

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
};
const isoFrom = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** `14 Sep 2026` — how a picked date reads in a field. */
export const dateFieldLabel = (iso: string) => {
  const { y, m, d } = parts(iso);
  return `${d} ${MONTHS[m].slice(0, 3)} ${y}`;
};
const spoken = (iso: string) => {
  const { y, m, d } = parts(iso);
  return `${WEEKDAYS[dateOf(iso).getDay()]}, ${d} ${MONTHS[m]} ${y}`;
};

/** Move by whole months, keeping the day where the month allows (31 Jan → 28 Feb). */
function addMonths(iso: string, months: number): string {
  const { y, m, d } = parts(iso);
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return isoFrom(ny, nm, Math.min(d, daysIn(ny, nm)));
}

export function CalendarPopover({
  anchor,
  trigger,
  value,
  onPick,
  onClose,
  min,
  max,
  clearable,
  label,
}: {
  anchor: DOMRect;
  trigger: HTMLElement | null;
  value?: string;
  onPick: (iso: string | undefined) => void;
  onClose: () => void;
  min?: string;
  max?: string;
  clearable?: boolean;
  label: string;
}) {
  const today = todayIso();
  const clamp = (iso: string) => (max && iso > max ? max : min && iso < min ? min : iso);
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState<HTMLElement>(() => (trigger?.closest('dialog[open]') as HTMLElement | null) ?? document.body);
  const [focus, setFocus] = useState(() => clamp(value || today));
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [yearShown, setYearShown] = useState(() => parts(focus).y);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const allowed = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => {
    closeRef.current();
    trigger?.focus({ preventScroll: true });
  };
  const pick = (iso: string | undefined) => {
    if (iso && !allowed(iso)) return;
    onPick(iso);
    close();
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const below = anchor.bottom + 6 + h <= innerHeight - EDGE || anchor.top - 6 - h < EDGE;
    const left = Math.round(Math.min(Math.max(EDGE, anchor.left), innerWidth - w - EDGE));
    const top = Math.round(below ? anchor.bottom + 6 : anchor.top - 6 - h);
    // Grows out of the field that opened it.
    const ox = Math.min(w, Math.max(0, anchor.left + Math.min(anchor.width, 60) / 2 - left));
    setPos({ left, top: Math.max(EDGE, top), origin: `${ox}px ${below ? '0%' : '100%'}` });
  }, [anchor]);

  // The focused day follows the keyboard, and the grid follows the focused day.
  useEffect(() => {
    if (!pos || mode !== 'days') return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus, pos, mode]);

  const live = useRef({ focus, mode, pick, close });
  live.current = { focus, mode, pick, close };
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && (ref.current?.contains(t) || trigger?.contains(t));
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      const { focus: f, mode: m, pick: choose, close: shut } = live.current;
      const move = (to: string) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        setFocus(to);
      };
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        shut();
        return;
      }
      if (m !== 'days' || !(document.activeElement instanceof HTMLElement && ref.current?.contains(document.activeElement))) return;
      const day = dateOf(f).getDay();
      if (e.key === 'ArrowLeft') move(addDays(f, -1));
      else if (e.key === 'ArrowRight') move(addDays(f, 1));
      else if (e.key === 'ArrowUp') move(addDays(f, -7));
      else if (e.key === 'ArrowDown') move(addDays(f, 7));
      else if (e.key === 'PageUp') move(addMonths(f, e.shiftKey ? -12 : -1));
      else if (e.key === 'PageDown') move(addMonths(f, e.shiftKey ? 12 : 1));
      else if (e.key === 'Home') move(addDays(f, -day));
      else if (e.key === 'End') move(addDays(f, 6 - day));
      else if ((e.key === 'Enter' || e.key === ' ') && (document.activeElement as HTMLElement).dataset.iso) {
        e.preventDefault();
        e.stopImmediatePropagation();
        choose(f);
      }
    };
    const onResize = () => closeRef.current();
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
    // Listeners read the latest state through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { y, m } = parts(focus);
  const lead = new Date(y, m, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(isoFrom(y, m, 1), i - lead));
  const prevMonthOk = !min || addMonths(isoFrom(y, m, 1), -1) >= isoFrom(parts(min).y, parts(min).m, 1);
  const nextMonthOk = !max || isoFrom(y, m, 1) < isoFrom(parts(max).y, parts(max).m, 1);
  const showMonth = (months: number) => setFocus(clamp(addMonths(focus, months)));

  return createPortal(
    <div
      ref={ref}
      className="fin-cal"
      role="dialog"
      aria-label={label}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, transformOrigin: pos?.origin, opacity: pos ? undefined : 0, pointerEvents: pos ? undefined : 'none' }}
      // Portals keep the React tree: keep clicks and keys from reaching the field's form.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="fin-cal__head">
        <button
          type="button"
          className="fin-cal__title"
          aria-label={mode === 'days' ? `${MONTHS[m]} ${y}, choose month and year` : 'Back to days'}
          onClick={() => {
            setYearShown(y);
            setMode(mode === 'days' ? 'months' : 'days');
          }}
        >
          {mode === 'days' ? `${MONTHS[m]} ${y}` : yearShown}
          <ChevronRight size={13} strokeWidth={2.2} className="fin-cal__title-chev" data-open={mode === 'months'} aria-hidden="true" />
        </button>
        <span className="fin-spacer" />
        <button
          type="button"
          className="fin-cal__nav"
          aria-label={mode === 'days' ? 'Previous month' : 'Previous year'}
          disabled={mode === 'days' ? !prevMonthOk : !!min && yearShown - 1 < parts(min).y}
          onClick={() => (mode === 'days' ? showMonth(-1) : setYearShown(yearShown - 1))}
        >
          <ChevronLeft size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="fin-cal__nav"
          aria-label={mode === 'days' ? 'Next month' : 'Next year'}
          disabled={mode === 'days' ? !nextMonthOk : !!max && yearShown + 1 > parts(max).y}
          onClick={() => (mode === 'days' ? showMonth(1) : setYearShown(yearShown + 1))}
        >
          <ChevronRight size={15} strokeWidth={2} />
        </button>
      </div>

      {mode === 'days' ? (
        <>
          <div className="fin-cal__weekdays" aria-hidden="true">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w.slice(0, 1)}</span>
            ))}
          </div>
          <div className="fin-cal__grid" role="grid" aria-label={`${MONTHS[m]} ${y}`}>
            {cells.map((iso) => {
              const outside = parts(iso).m !== m;
              return (
                <button
                  key={iso}
                  type="button"
                  className="fin-cal__day fin-num"
                  data-iso={iso}
                  data-outside={outside || undefined}
                  data-today={iso === today || undefined}
                  aria-pressed={iso === value}
                  aria-label={spoken(iso)}
                  tabIndex={iso === focus ? 0 : -1}
                  disabled={!allowed(iso)}
                  onClick={() => pick(iso)}
                >
                  {parts(iso).d}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="fin-cal__months">
          {MONTHS.map((name, i) => {
            const first = isoFrom(yearShown, i, 1);
            const last = isoFrom(yearShown, i, daysIn(yearShown, i));
            const ok = (!min || last >= min) && (!max || first <= max);
            return (
              <button
                key={name}
                type="button"
                className="fin-cal__month"
                aria-pressed={yearShown === y && i === m}
                disabled={!ok}
                onClick={() => {
                  const { d } = parts(focus);
                  setFocus(clamp(isoFrom(yearShown, i, Math.min(d, daysIn(yearShown, i)))));
                  setMode('days');
                }}
              >
                {name.slice(0, 3)}
              </button>
            );
          })}
        </div>
      )}

      <div className="fin-cal__foot">
        {allowed(today) && (
          <button type="button" className="fin-link" onClick={() => pick(today)}>
            Today
          </button>
        )}
        <span className="fin-spacer" />
        {clearable && value && (
          <button type="button" className="fin-link" onClick={() => pick(undefined)}>
            Clear
          </button>
        )}
      </div>
    </div>,
    host,
  );
}

/** A date field: shows the date in the field's own style and opens the calendar. */
export function DateField({
  value,
  onChange,
  label,
  min,
  max,
  clearable,
  placeholder = 'Pick a date',
  className,
}: {
  value?: string;
  onChange: (iso: string | undefined) => void;
  label: string;
  min?: string;
  max?: string;
  clearable?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const show = () => button.current && setOpen(button.current.getBoundingClientRect());

  return (
    <>
      <button
        ref={button}
        type="button"
        className={['fin-input fin-datefield', className].filter(Boolean).join(' ')}
        aria-haspopup="dialog"
        aria-expanded={open !== null}
        aria-label={`${label}: ${value ? spoken(value) : 'not set'}`}
        onClick={() => (open ? setOpen(null) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            show();
          }
        }}
      >
        <span className={value ? 'fin-num' : 'fin-datefield__placeholder'}>{value ? dateFieldLabel(value) : placeholder}</span>
        <CalendarDays size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <CalendarPopover
          anchor={open}
          trigger={button.current}
          value={value}
          min={min}
          max={max}
          clearable={clearable}
          label={label}
          onPick={onChange}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

