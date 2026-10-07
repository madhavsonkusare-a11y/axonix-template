/**
 * One of the calendar's own events, opened: a small pane of glass beside it.
 *
 * Events are Google's and are only read here, so the card says when and where
 * and offers the one thing that can be done with it: open it in Google.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, MapPin } from 'lucide-react';
import type { CalEvent } from '../../calendar/backend';
import { addDays, shortDate } from '../../finance/format';
import { desktop } from '../../finance/desktop';
import { clamp } from './time';

export default function EventCard({ event, rect, onClose }: { event: CalEvent; rect: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.right + 8;
    if (left + w > innerWidth - 8) left = rect.left - w - 8;
    setPos({ left: clamp(left, 8, innerWidth - w - 8), top: clamp(rect.top, 8, innerHeight - h - 8) });
  }, [rect]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const lastDay = event.allDay ? addDays(event.end, -1) : event.end.slice(0, 10);
  const when = event.allDay
    ? lastDay > event.start
      ? `${shortDate(event.start)} – ${shortDate(lastDay)}, all day`
      : `${shortDate(event.start)}, all day`
    : `${shortDate(event.start.slice(0, 10))} · ${event.start.slice(11)} – ${event.end.slice(11)}`;
  return (
    <div ref={ref} className="nxc-pop" role="dialog" aria-label={event.title} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}>
      <div className="nxc-pop__head">
        <i style={{ background: event.color }} aria-hidden="true" />
        <strong>{event.title}</strong>
      </div>
      <p className="nxc-pop__when fin-num">{when}</p>
      {event.location && (
        <p className="nxc-pop__where">
          <MapPin size={12} strokeWidth={1.8} aria-hidden="true" />
          {event.location}
        </p>
      )}
      {event.htmlLink && (
        <button type="button" className="fin-link nxc-pop__open" onClick={() => (desktop ? desktop.openExternal(event.htmlLink!) : window.open(event.htmlLink, '_blank', 'noopener'))}>
          <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
          Open in Google Calendar
        </button>
      )}
    </div>
  );
}
