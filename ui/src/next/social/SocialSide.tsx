/**
 * Social's sidebar: the six apps.
 *
 * In the first Social these were a dock of their own on the left edge. Axonix
 * has one dock now, for its modules, so the apps are this module's views. Each
 * keeps its own icon and colour (that is how you tell them apart), says whether
 * it is open or asleep, and carries its unread count.
 *
 * An app can still be dragged onto the page to stand beside another, and
 * right-clicked for the same menu the dock had.
 */
import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { KeyRound, LayoutGrid } from 'lucide-react';
import { LiquidLens, useLiquidIndicator } from '../../finance/components/Liquid';
import type { MenuEntry } from '../../finance/components/Menu';
import { SOCIAL_APPS, type SocialAppId } from '../../social/apps';
import type { SplitSide } from '../../social/Dock';
import { appIcons } from '../../social/icons';

/** Minimum px the pointer must move before a drag starts. */
const DRAG_THRESHOLD = 8;

export interface SocialSideProps {
  active: SocialAppId | null;
  /** The app in the other pane of split view. */
  other: SocialAppId | null;
  running: ReadonlySet<SocialAppId>;
  sleeping: ReadonlySet<SocialAppId>;
  badges: Partial<Record<SocialAppId, number>>;
  overview: boolean;
  passwordsOpen: boolean;
  stageRef: RefObject<HTMLElement | null>;
  onOpen: (id: SocialAppId) => void;
  onMenu: (id: SocialAppId, x: number, y: number, trigger: HTMLElement) => void;
  onSplitDrop: (id: SocialAppId, side: SplitSide, at: { x: number; y: number }) => void;
  onSplitDrag: (id: SocialAppId | null, side: SplitSide | null, cursor: { x: number; y: number } | null) => void;
  onOverview: () => void;
  onPasswords: () => void;
}

export default function SocialSide(props: SocialSideProps) {
  const { active, other, running, sleeping, badges, overview, passwordsOpen, stageRef, onOpen, onSplitDrag, onSplitDrop } = props;
  const host = useRef<HTMLElement>(null);
  const lens = useRef<HTMLSpanElement>(null);
  useLiquidIndicator(host, lens, active && !overview ? active : undefined, 'y');

  // A press that travels becomes a drag onto one half of the page (pointer
  // events, not HTML drag and drop, which a <webview> swallows).
  const suppressClick = useRef(false);
  const sideAt = useCallback(
    (x: number, y: number): SplitSide | null => {
      const r = stageRef.current?.getBoundingClientRect();
      if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
      return x < r.left + r.width / 2 ? 'left' : 'right';
    },
    [stageRef],
  );
  const press = (e: ReactPointerEvent<HTMLButtonElement>, id: SocialAppId) => {
    if (e.button !== 0) return;
    const origin = { x: e.clientX, y: e.clientY };
    let dragging = false;
    suppressClick.current = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_THRESHOLD) return;
        dragging = true;
        suppressClick.current = true;
      }
      onSplitDrag(id, sideAt(ev.clientX, ev.clientY), { x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!dragging) return;
      const side = sideAt(ev.clientX, ev.clientY);
      onSplitDrag(null, null, null);
      if (side) onSplitDrop(id, side, { x: ev.clientX, y: ev.clientY });
      // The click the browser makes from this release is not a press.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 120);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
    <>
      <nav className="nx-nav nxo-nav" ref={host} aria-label="Apps">
        <LiquidLens lensRef={lens} radius={10} />
        {SOCIAL_APPS.map((a, i) => {
          const badge = badges[a.id] ?? 0;
          const state = running.has(a.id) ? 'open' : sleeping.has(a.id) ? 'sleeping' : 'idle';
          const on = a.id === active && !overview;
          return (
            <button
              key={a.id}
              type="button"
              data-liquid-key={a.id}
              data-app={a.id}
              data-shown={(a.id === other && !overview) || undefined}
              className="nx-nav__item nxo-app"
              aria-current={on ? 'page' : undefined}
              aria-label={`${a.name}, ${on ? 'showing' : state === 'open' ? 'open' : state === 'sleeping' ? 'sleeping' : 'not opened'}${badge > 0 ? `, ${badge} unread` : ''}`}
              title={`${a.name} · Ctrl ${i + 1}`}
              onPointerDown={(e) => press(e, a.id)}
              onClick={() => !suppressClick.current && onOpen(a.id)}
              onContextMenu={(e: ReactMouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
                props.onMenu(a.id, e.clientX, e.clientY, e.currentTarget);
              }}
            >
              <span className="nxo-app__icon">
                <img src={appIcons[a.id]} alt="" draggable={false} />
              </span>
              <span className="nxt-nav__name">{a.name}</span>
              {badge > 0 ? (
                <span className="nx-nav__badge fin-num">{badge > 99 ? '99+' : badge}</span>
              ) : state !== 'idle' ? (
                <span className="nxo-app__state" data-state={state} title={state === 'open' ? 'Open' : 'Asleep: opens where you left it'} />
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="nx-side__more">
        <button type="button" className="nx-row nxn-switch" aria-pressed={overview} onClick={props.onOverview}>
          <span className="nx-row__icon">
            <LayoutGrid size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Overview</span>
          <span className="nx-row__hint">Ctrl ↑</span>
        </button>
        <button type="button" className="nx-row nxn-switch" aria-pressed={passwordsOpen} onClick={props.onPasswords}>
          <span className="nx-row__icon">
            <KeyRound size={14} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span className="nx-row__label">Passwords</span>
        </button>
        <p className="nxc-side__note">Drag an app onto the page to see two side by side.</p>
      </div>

    </>
  );
}

/** With the sidebar put away: what is left of it, as the menu on the module's name. */
export function socialMenu(onOverview: () => void, onPasswords: () => void): MenuEntry[] {
  const glyph = { size: 14, strokeWidth: 1.6 } as const;
  return [
    { id: 'overview', label: 'Overview', hint: 'Ctrl ↑', icon: <LayoutGrid {...glyph} />, onSelect: onOverview },
    { id: 'passwords', label: 'Passwords', icon: <KeyRound {...glyph} />, onSelect: onPasswords },
  ];
}
