/**
 * The dock — a Liquid Glass pill on the left edge, after macOS.
 *
 * Icons magnify under the pointer: each icon's size follows its distance from
 * the pointer through a spring, so neighbours swell with it and the column
 * breathes open along its length. Running apps carry a dot on the screen-edge
 * side, unread counts a red badge, and an app's first launch bounces its icon
 * once, outward — the direction a left-edge Dock bounces.
 *
 * Magnification only under a fine pointer that can hover; touch and Reduce
 * Motion get fixed-size icons.
 *
 * Split-screen drag uses pointer events with window listeners and hit testing
 * against the stage. This avoids HTML5 DnD issues with Electron webviews.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useAnimate, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { KeyRound, LayoutGrid } from 'lucide-react';
import { Mark } from '../finance/components/Glyphs';
import { SOCIAL_APPS, type SocialAppId } from './apps';
import { appIcons } from './icons';

const BASE = 44;
const PEAK = 66;
const REACH = 128;
/** Minimum px the pointer must move before a drag gesture starts. */
const DRAG_THRESHOLD = 8;

function useFinePointer() {
  const [fine, setFine] = useState(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  useEffect(() => {
    const q = matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setFine(q.matches);
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  return fine;
}

export type SplitSide = 'left' | 'right';

interface IconProps {
  id: SocialAppId;
  name: string;
  pointerY: MotionValue<number>;
  magnify: boolean;
  state: 'active' | 'open' | 'sleeping' | 'idle';
  badge: number;
  bounce: number;
  /** The panel is growing out of this icon, so the icon itself gives way. */
  launching: boolean;
  onOpen: () => void;
  onSplitDrop: (id: SocialAppId, side: SplitSide, at: { x: number; y: number }) => void;
  onSplitDrag: (id: SocialAppId | null, side: SplitSide | null, cursor: { x: number; y: number } | null) => void;
  stageRef: React.RefObject<HTMLElement | null>;
  onMenu: (e: React.MouseEvent) => void;
  onHover: (id: SocialAppId | null, el: HTMLElement | null) => void;
}

function DockIcon({
  id,
  name,
  pointerY,
  magnify,
  state,
  badge,
  bounce,
  launching,
  onOpen,
  onSplitDrop,
  onSplitDrag,
  stageRef,
  onMenu,
  onHover,
}: IconProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const distance = useTransform(pointerY, (y) => {
    const el = ref.current;
    if (!el || !Number.isFinite(y)) return REACH * 2;
    const r = el.getBoundingClientRect();
    return y - (r.top + r.height / 2);
  });
  const target = useTransform(distance, [-REACH, 0, REACH], [BASE, PEAK, BASE], { clamp: true });
  const size = useSpring(target, { mass: 0.1, stiffness: 190, damping: 14 });

  // One outward bounce per launch (`bounce` counts launches).
  const [icon, animate] = useAnimate<HTMLSpanElement>();
  useEffect(() => {
    if (!bounce || !icon.current) return;
    void animate(icon.current, { x: [0, 14, 0, 6, 0] }, { duration: 0.72, times: [0, 0.28, 0.56, 0.78, 1], ease: ['easeOut', 'easeIn', 'easeOut', 'easeIn'] });
  }, [bounce, animate, icon]);

  // Pointer-event drag for split-screen.
  const origin = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const suppressClick = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return; // Only left button
      origin.current = { x: e.clientX, y: e.clientY };
      isDragging.current = false;
      suppressClick.current = false;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - origin.current.x;
        const dy = ev.clientY - origin.current.y;
        if (!isDragging.current) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          isDragging.current = true;
          suppressClick.current = true;
        }

        const stage = stageRef.current;
        let side: SplitSide | null = null;
        if (stage) {
          const r = stage.getBoundingClientRect();
          if (
            ev.clientX >= r.left &&
            ev.clientX <= r.right &&
            ev.clientY >= r.top &&
            ev.clientY <= r.bottom
          ) {
            side = ev.clientX < r.left + r.width / 2 ? 'left' : 'right';
          }
        }

        onSplitDrag(id, side, { x: ev.clientX, y: ev.clientY });
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        if (!isDragging.current) return; // Normal click handled by onClick
        isDragging.current = false;

        const stage = stageRef.current;
        let side: SplitSide | null = null;
        if (stage) {
          const r = stage.getBoundingClientRect();
          if (
            ev.clientX >= r.left &&
            ev.clientX <= r.right &&
            ev.clientY >= r.top &&
            ev.clientY <= r.bottom
          ) {
            side = ev.clientX < r.left + r.width / 2 ? 'left' : 'right';
          }
        }

        onSplitDrag(null, null, null);
        if (side) {
          onSplitDrop(id, side, { x: ev.clientX, y: ev.clientY });
        }

        // Keep suppressClick active momentarily to swallow the synthesized click
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 120);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [id, stageRef, onSplitDrag, onSplitDrop],
  );

  const handleClick = useCallback(() => {
    if (suppressClick.current) return;
    onOpen();
  }, [onOpen]);

  return (
    <motion.button
      ref={ref}
      type="button"
      className="soc-dock__app"
      data-app={id}
      data-active={state === 'active'}
      data-launching={launching}
      aria-label={`${name}, ${state === 'active' ? 'active' : state === 'open' ? 'open' : state === 'sleeping' ? 'sleeping' : 'not opened'}${badge > 0 ? `, ${badge} unread` : ''}`}
      aria-current={state === 'active' ? 'page' : undefined}
      style={magnify ? { width: size, height: size } : undefined}
      onClick={handleClick}
      onPointerDown={onPointerDown}
      onContextMenu={onMenu}
      onPointerEnter={() => onHover(id, ref.current)}
      onFocus={() => onHover(id, ref.current)}
      onBlur={() => onHover(null, null)}
      whileTap={{ scale: 0.92 }}
    >
      <span ref={icon} className="soc-icon">
        <img src={appIcons[id]} alt="" draggable={false} />
      </span>
      {state !== 'idle' && <span className="soc-dock__state" data-state={state} aria-hidden="true" />}
      <AnimatePresence>
        {badge > 0 && (
          <motion.span
            key="badge"
            className="soc-badge"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
          >
            {badge > 99 ? '99+' : badge}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export interface DockProps {
  active: SocialAppId | null;
  splitApp: SocialAppId | null;
  running: Set<SocialAppId>;
  sleeping: Set<SocialAppId>;
  badges: Partial<Record<SocialAppId, number>>;
  bounces: Partial<Record<SocialAppId, number>>;
  /** The app whose launch panel is growing out of its icon. */
  launching?: SocialAppId | null;
  overview: boolean;
  passwordsOpen: boolean;
  onOpen: (id: SocialAppId) => void;
  onMenu: (id: SocialAppId, x: number, y: number) => void;
  onSplitDrop: (id: SocialAppId, side: SplitSide, at: { x: number; y: number }) => void;
  onSplitDrag: (id: SocialAppId | null, side: SplitSide | null, cursor: { x: number; y: number } | null) => void;
  stageRef: React.RefObject<HTMLElement | null>;
  onOverview: () => void;
  onPasswords: () => void;
  onAxonix: () => void;
}

export default function Dock(props: DockProps) {
  const { active, splitApp, running, sleeping, badges, bounces, overview, passwordsOpen } = props;
  const fine = useFinePointer();
  const pointerY = useMotionValue(Number.POSITIVE_INFINITY);

  // Tooltip: the first one waits, then it follows from icon to icon at once
  // until the pointer leaves the dock — the way the Dock's labels behave.
  const [label, setLabel] = useState<{ text: string; y: number } | null>(null);
  const warm = useRef(false);
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const hover = (text: string | null, el: HTMLElement | null) => {
    clearTimer();
    if (!text || !el) {
      setLabel(null);
      return;
    }
    const show = () => {
      const r = el.getBoundingClientRect();
      warm.current = true;
      setLabel({ text, y: r.top + r.height / 2 });
    };
    if (warm.current) show();
    else timer.current = window.setTimeout(show, 420);
  };

  return (
    <nav
      className="soc-dock"
      aria-label="Apps"
      onPointerMove={(e) => pointerY.set(e.clientY)}
      onPointerLeave={() => {
        pointerY.set(Number.POSITIVE_INFINITY);
        clearTimer();
        setLabel(null);
        timer.current = window.setTimeout(() => (warm.current = false), 300);
      }}
    >
      <div className="soc-dock__shelf">
        <div className="soc-dock__glass" aria-hidden="true" />
        <div className="soc-dock__column">
          <button
            type="button"
            className="soc-dock__tool soc-dock__home"
            aria-label="Axonix"
            onClick={props.onAxonix}
            onPointerEnter={(e) => hover('Axonix', e.currentTarget)}
          >
            <Mark />
          </button>
          <span className="soc-dock__sep" aria-hidden="true" />
          {SOCIAL_APPS.map((a, i) => (
            <DockIcon
              key={a.id}
              id={a.id}
              name={a.name}
              pointerY={pointerY}
              magnify={fine}
              state={
                (a.id === active || a.id === splitApp) && !overview
                  ? 'active'
                  : running.has(a.id)
                    ? 'open'
                    : sleeping.has(a.id)
                      ? 'sleeping'
                      : 'idle'
              }
              badge={badges[a.id] ?? 0}
              bounce={bounces[a.id] ?? 0}
              launching={props.launching === a.id}
              onOpen={() => props.onOpen(a.id)}
              onSplitDrop={props.onSplitDrop}
              onSplitDrag={props.onSplitDrag}
              stageRef={props.stageRef}
              onMenu={(e) => {
                e.preventDefault();
                props.onMenu(a.id, e.clientX, e.clientY);
              }}
              onHover={(id, el) => hover(id ? `${a.name}  Ctrl+${i + 1}` : null, el)}
            />
          ))}
          <span className="soc-dock__sep" aria-hidden="true" />
          <button
            type="button"
            className="soc-dock__tool"
            data-on={overview}
            aria-label="Overview"
            aria-pressed={overview}
            onClick={props.onOverview}
            onPointerEnter={(e) => hover('Overview  Ctrl+↑', e.currentTarget)}
          >
            <LayoutGrid size={18} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className="soc-dock__tool"
            data-on={passwordsOpen}
            aria-label="Passwords"
            aria-pressed={passwordsOpen}
            onClick={props.onPasswords}
            onPointerEnter={(e) => hover('Passwords', e.currentTarget)}
          >
            <KeyRound size={18} strokeWidth={1.6} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {label && (
          <motion.div
            className="soc-tip"
            role="tooltip"
            // It slides between icons on `y`, never on `top`: a transform is
            // composited, while `top` re-lays out the dock on every frame.
            initial={{ opacity: 0, x: -6, scale: 0.96, y: label.y }}
            animate={{ opacity: 1, x: 0, scale: 1, y: label.y }}
            exit={{ opacity: 0, x: -4, transition: { duration: 0.1 } }}
            transition={{
              duration: 0.16,
              ease: [0.16, 1, 0.3, 1],
              y: { type: 'spring', stiffness: 700, damping: 45 },
            }}
          >
            {label.text.split('  ').map((part, i) => (i === 0 ? <span key={i}>{part}</span> : <kbd key={i}>{part}</kbd>))}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
