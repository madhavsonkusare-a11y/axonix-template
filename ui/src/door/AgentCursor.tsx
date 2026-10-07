/**
 * An agent's cursor.
 *
 * It moves only because a real call named a real thing: when a call starts on
 * a task or a note that is on screen, or ends having made or touched one, the
 * cursor sets out from the agent's sidebar row and glides to that row or card,
 * which lights for a moment. A call with nothing on screen to point at (a
 * search, a list, a thing in another module) pulses the agent's row instead.
 *
 * One motion, however often its target changes: the cursor is always a
 * transition towards where it should be now. (A keyframed arrival was tried
 * first; a target that changed mid-arrival made it jump, because a transition
 * does not run on a property an animation holds.) What it touched may still be
 * travelling, like a finished task crossing to Done, so it goes with it for a
 * moment; and it never leaves the window: if the thing has gone below the
 * fold, the cursor waits at the edge it left by.
 *
 * Transform and opacity only. With reduced motion it appears in place.
 */
import { useEffect, useRef, useState } from 'react';
import type { DoorEvent, DoorThing } from './backend';
import { ClaudeMark } from './AgentsSide';
import { useDoor } from './DoorContext';

interface Point {
  x: number;
  y: number;
}

interface Shown extends Point {
  agent: string;
  name: string;
  /** Still at the agent's row, about to set out: `to` is where. */
  leaving: Point | null;
}

const REST_MS = 2600;
/** After landing, look again: the thing may have moved to its new place, or been drawn afresh. */
const FOLLOW_MS = [220, 480, 800, 1200];

function targetEl(thing: DoorThing): HTMLElement | null {
  const key = `${thing.kind}:${thing.id}`;
  for (const el of document.querySelectorAll<HTMLElement>('[data-lift]')) {
    if (el.dataset.lift !== key) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) return el;
  }
  return null;
}

const rowOf = (agent: string) => document.querySelector<HTMLElement>(`[data-agent-row="${agent}"]`);

/** Towards the far side of the row, so its name stays readable under the cursor's tag; and inside the window. */
function place(el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  const x = r.left + Math.min(r.width * 0.7, r.width - 20);
  const y = r.top + Math.min(r.height * 0.55, 30);
  return { x: Math.max(8, Math.min(x, window.innerWidth - 120)), y: Math.max(8, Math.min(y, window.innerHeight - 44)) };
}

function light(el: HTMLElement) {
  if ('agentTouched' in el.dataset) return;
  el.dataset.agentTouched = '';
  window.setTimeout(() => delete el.dataset.agentTouched, 1600);
}

function pulse(agent: string) {
  const row = rowOf(agent);
  if (!row) return;
  delete row.dataset.pulse;
  // Restarting the animation needs the attribute to have been seen gone.
  void row.offsetWidth;
  row.dataset.pulse = '';
  window.setTimeout(() => delete row.dataset.pulse, 900);
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const moved = (a: Point, b: Point) => Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2;

export default function AgentCursor() {
  const d = useDoor();
  const [shown, setShown] = useState<Shown | null>(null);
  const hide = useRef(0);
  const follow = useRef<number[]>([]);
  const names = useRef(new Map<string, string>());
  names.current = new Map(d.status?.agents.map((a) => [a.id, a.name]) ?? []);
  const { subscribe } = d;

  useEffect(() => {
    /** Sends the cursor to a point: from where it is, or, when it is not on screen, from the agent's row. */
    const send = (agent: string, to: Point) =>
      setShown((now) => {
        if (now && now.agent === agent) return now.leaving ? (moved(now.leaving, to) ? { ...now, leaving: to } : now) : moved(now, to) ? { ...now, ...to } : now;
        const name = names.current.get(agent) ?? agent;
        const row = rowOf(agent)?.getBoundingClientRect();
        if (!row || still()) return { agent, name, ...to, leaving: null };
        return { agent, name, x: row.left + 18, y: row.top + row.height / 2, leaving: to };
      });

    const visit = (event: DoorEvent, thing: DoorThing, first: HTMLElement) => {
      const changed = event.type === 'TOOL_CALL_END' && event.changed === true;
      send(event.agent, place(first));
      if (changed) light(first);
      for (const timer of follow.current) window.clearTimeout(timer);
      follow.current = FOLLOW_MS.map((ms) =>
        window.setTimeout(() => {
          const el = first.isConnected ? first : targetEl(thing);
          if (!el) return;
          if (changed) light(el);
          send(event.agent, place(el));
        }, ms),
      );
      window.clearTimeout(hide.current);
      hide.current = window.setTimeout(() => setShown(null), REST_MS);
    };

    return subscribe((event) => {
      if (event.type !== 'TOOL_CALL_START' && event.type !== 'TOOL_CALL_END') return;
      const thing = event.thing;
      if (!thing || event.failed) {
        if (event.type === 'TOOL_CALL_END') pulse(event.agent);
        return;
      }
      const found = targetEl(thing);
      if (found) {
        visit(event, thing, found);
        return;
      }
      if (event.type === 'TOOL_CALL_START') return;
      // Something just made is drawn a moment after the call ends.
      let tries = 0;
      const look = () => {
        const el = targetEl(thing);
        if (el) visit(event, thing, el);
        else if (++tries < 12) window.setTimeout(look, 120);
        else pulse(event.agent);
      };
      window.setTimeout(look, 120);
    });
  }, [subscribe]);

  // Drawn once at the agent's row, then sent on its way: the browser has to have seen it there to move it from there.
  const waiting = shown?.leaving ? shown.agent : null;
  useEffect(() => {
    if (!waiting) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown((now) => (now && now.leaving ? { ...now, ...now.leaving, leaving: null } : now)));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [waiting]);

  useEffect(
    () => () => {
      window.clearTimeout(hide.current);
      for (const timer of follow.current) window.clearTimeout(timer);
    },
    [],
  );

  if (!shown) return null;
  return (
    <div key={shown.agent} className="door-cursor" aria-hidden="true" data-leaving={shown.leaving ? '' : undefined} style={{ transform: `translate3d(${shown.x}px, ${shown.y}px, 0)` }}>
      <svg className="door-cursor__arrow" width="16" height="18" viewBox="0 0 16 18">
        <path d="M1.5 1.5 L1.5 14.5 L5.4 11 L8 16.6 L10.4 15.5 L7.8 10 L13 10 Z" />
      </svg>
      <span className="door-cursor__tag">
        <ClaudeMark size={11} />
        {shown.name}
      </span>
    </div>
  );
}
