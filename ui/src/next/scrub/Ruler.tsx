/**
 * The time ruler: ninety days on one line, with today marked.
 *
 * Glass, because it floats: it stands beside the dock, wherever the dock is.
 * Behind today the track is warm, ahead of it cool, the same two washes the
 * page takes on. Press or drag anywhere on it; the day under the pointer is
 * the day every module shows.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { addDays, dateOf, daysBetween } from '../../finance/format';
import type { DockEdge } from '../layout';
import { AHEAD, BACK, longDay, relDay, useScrub } from './Scrub';

const SPAN = BACK + AHEAD;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Ruler({ edge }: { edge: DockEdge }) {
  const { day, today, live, past, setDay, setOpen } = useScrub();
  const box = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  // Stands off the rail by 12px, level with the clock that opened it.
  useLayoutEffect(() => {
    const place = () => {
      const dock = document.querySelector('.nx-dock')?.getBoundingClientRect();
      const clock = document.querySelector('.nx-dock__btn')?.getBoundingClientRect() ?? dock;
      const el = box.current;
      if (!dock || !clock || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (edge === 'bottom' || edge === 'top') {
        const left = clamp(dock.left + dock.width / 2 - w / 2, 12, innerWidth - w - 12);
        setPos(edge === 'bottom' ? { left, bottom: innerHeight - dock.top + 12 } : { left, top: dock.bottom + 12 });
      } else {
        const top = clamp(clock.top + clock.height / 2 - h / 2, 12, innerHeight - h - 12);
        setPos(edge === 'left' ? { left: dock.right + 12, top } : { right: innerWidth - dock.left + 12, top });
      }
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [edge]);

  useEffect(() => {
    const id = window.setTimeout(() => track.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(id);
  }, []);

  const ticks = useMemo(
    () =>
      Array.from({ length: SPAN + 1 }, (_, i) => {
        const iso = addDays(today, i - BACK);
        const d = dateOf(iso);
        const first = d.getDate() === 1;
        const monday = d.getDay() === 1;
        return { iso, x: (i / SPAN) * 100, kind: first ? 'month' : monday ? 'week' : 'day', label: first ? MONTH[d.getMonth()] : monday ? String(d.getDate()) : '' };
      }),
    [today],
  );

  const offset = daysBetween(today, day);
  const dayAt = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return addDays(today, Math.round(clamp((x - r.left) / r.width, 0, 1) * SPAN) - BACK);
  };
  const dragging = useRef(false);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDay(dayAt(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setDay(dayAt(e.clientX));
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setDay(addDays(day, (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 7 : 1)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setDay(today);
    }
  };

  return (
    <div ref={box} className="nx-ruler" role="dialog" aria-label="Scrub through time" data-time={live ? undefined : past ? 'past' : 'future'} data-edge={edge} style={{ ...pos, visibility: pos ? undefined : 'hidden' }}>
      <div className="nx-ruler__head">
        <span className="nx-ruler__date">{longDay(day)}</span>
        <span className="nx-ruler__rel">{live ? 'Today' : `${relDay(day, today)} · ${past ? 'how things stood' : 'what is expected'}`}</span>
        <span className="fin-spacer" />
        <button type="button" className="fin-pill fin-pill--sm" onClick={() => setDay(today)} disabled={live}>
          Today
        </button>
        <button type="button" className="nx-iconbtn" onClick={() => setOpen(false)} aria-label="Close the ruler" title="Close · T">
          <X size={15} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={track}
        className="nx-ruler__track"
        tabIndex={0}
        role="slider"
        aria-label="Day"
        aria-valuemin={-BACK}
        aria-valuemax={AHEAD}
        aria-valuenow={offset}
        aria-valuetext={`${longDay(day)}, ${relDay(day, today)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      >
        <i className="nx-ruler__past" style={{ width: `${(BACK / SPAN) * 100}%` }} aria-hidden="true" />
        <i className="nx-ruler__future" style={{ width: `${(AHEAD / SPAN) * 100}%` }} aria-hidden="true" />
        {ticks.map((t) => (
          <span key={t.iso} className="nx-ruler__tick" data-kind={t.kind} style={{ left: `${t.x}%` }} aria-hidden="true">
            {t.label && <em className="fin-num">{t.label}</em>}
          </span>
        ))}
        <i className="nx-ruler__today" style={{ left: `${(BACK / SPAN) * 100}%` }} aria-hidden="true" />
        <i className="nx-ruler__knob" style={{ left: `${((offset + BACK) / SPAN) * 100}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}
