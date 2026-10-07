/**
 * Small shared pieces: state glyphs, project colours, priority flags, and the
 * round checkbox every task carries.
 */
import { useEffect, useRef, useState } from 'react';
import { Circle, CircleCheck, CircleDashed, CircleDot, CircleSlash, Flag, type LucideIcon } from 'lucide-react';
import { PRIORITY_LABEL, type Priority, type TaskState } from '../types';

export const STATE_ICON: Record<TaskState, LucideIcon> = {
  backlog: CircleDashed,
  todo: Circle,
  doing: CircleDot,
  blocked: CircleSlash,
  done: CircleCheck,
};

export function StateGlyph({ state, size = 13 }: { state: TaskState; size?: number }) {
  const Icon = STATE_ICON[state];
  return <Icon className="tsk-glyph" data-state={state} size={size} strokeWidth={2} aria-hidden="true" />;
}

/**
 * A project's colour: picked from a fixed set by its name, so it never changes
 * between runs and needs nothing stored. Ten hues, all readable as a dot on
 * the dark ground.
 */
const PROJECT_COLOURS = ['#7cc4ff', '#5b8cff', '#5fe0a2', '#ffc496', '#6fd3e8', '#e0b089', '#ff8f8f', '#ffd479', '#f7a8c8', '#b8e36b'];

/** FNV-1a over the lower-cased name: spreads short names well, so projects rarely share a colour. */
export function projectColour(name: string): string {
  if (!name) return 'rgba(226, 234, 252, 0.45)';
  let h = 0x811c9dc5;
  for (const ch of name.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return PROJECT_COLOURS[h % PROJECT_COLOURS.length];
}

export function ProjectDot({ name }: { name: string }) {
  return <span className="tsk-dot" style={{ background: projectColour(name) }} aria-hidden="true" />;
}

export function PriorityFlag({ priority, label = true }: { priority: Priority; label?: boolean }) {
  return (
    <span className="tsk-prio" data-p={priority} title={PRIORITY_LABEL[priority]}>
      <Flag size={11} strokeWidth={2.2} aria-hidden="true" />
      {label && <span className="fin-num">P{priority}</span>}
    </span>
  );
}

/**
 * The round checkbox. Ticking it plays the check before the task leaves its
 * column, so the change is seen where it was made; `onDone` runs after that.
 */
export function TaskCheck({
  done,
  priority,
  onToggle,
  label,
}: {
  done: boolean;
  priority?: Priority;
  onToggle: () => void;
  label: string;
}) {
  const [ticking, setTicking] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const shown = done || ticking;
  return (
    <button
      type="button"
      className="tsk-check"
      data-on={shown || undefined}
      data-ticking={ticking || undefined}
      data-p={priority}
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      // The card underneath is draggable; a press here is a tick, not a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (ticking) return;
        if (done) {
          onToggle();
          return;
        }
        setTicking(true);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          onToggle();
          setTicking(false);
        }, 360);
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.2 8.4 6.8 11 11.8 5.6" pathLength={1} />
      </svg>
    </button>
  );
}
