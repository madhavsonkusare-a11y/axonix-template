/**
 * Sheet — the one overlay surface in the tracker.
 *
 * A native <dialog> for focus trapping, inertness behind it and Escape, with a
 * liquid-glass panel. Replaces the first build's Modal, which had two defects
 * visible on first use: Tailwind's preflight zeroes <dialog>'s `margin: auto`,
 * so every modal rendered pinned to the top-left corner; and Escape bubbled to
 * the window, so closing a modal also threw the user back to the launcher.
 *
 * Children mount only while open, so every opening starts from fresh state.
 *
 * Closing a sheet that holds unsaved typing does not throw it away: the close
 * button (or Cancel, or Escape, or a click outside) raises a small bubble at
 * the button, the way Mail asks before dropping a draft, with "Discard" and
 * "Keep editing". Forms opt in with `useUnsavedChanges(dirty)`.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { GlassSurface, useLiquidGlass } from './Liquid';

/** The element under the scrolling body where a form's action bar is rendered. */
const FooterSlot = createContext<HTMLElement | null>(null);

interface CloseGuard {
  setDirty: (dirty: boolean, discardLabel?: string) => void;
  requestClose: (from?: HTMLElement | null) => void;
}
const Guard = createContext<CloseGuard | null>(null);

/**
 * Tell the sheet whether the form holds changes that closing would lose, and
 * get a close function that asks first. Use it for the form's Cancel button,
 * passing the button so the question appears beside it.
 */
export function useUnsavedChanges(dirty: boolean, discardLabel?: string): (from?: HTMLElement | null) => void {
  const guard = useContext(Guard);
  useEffect(() => {
    guard?.setDirty(dirty, discardLabel);
  }, [guard, dirty, discardLabel]);
  useEffect(() => () => guard?.setDirty(false), [guard]);
  return useCallback((from?: HTMLElement | null) => guard?.requestClose(from), [guard]);
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Extra class on the panel, for sheets that restyle their body. */
  className?: string;
}

const SHEET_GLASS = {
  material: 'thick' as const,
  borderRadius: 24,
  blur: 26,
  saturation: 1.35,
  tintOpacity: 0.44,
  refractionStrength: 22,
  bezelWidth: 26,
  thickness: 22,
  chromaticAberration: 0.2,
  edgeHighlight: 0.7,
  specularStrength: 0.2,
  elevation: 1.2,
};

/**
 * Under the new shell (`next/`) a sheet is a panel standing on the right edge,
 * so what it was opened from stays in view. Its glass is thinner and clearer
 * there; the placement itself is CSS (`styles/next.css`).
 */
const SIDE_GLASS = {
  material: 'regular' as const,
  borderRadius: 20,
  blur: 30,
  saturation: 1.55,
  tintOpacity: 0.2,
  refractionStrength: 26,
  bezelWidth: 18,
  thickness: 20,
  chromaticAberration: 0.14,
  edgeHighlight: 0.78,
  specularStrength: 0.24,
  elevation: 1.3,
};

export default function Sheet({ open, onClose, title, subtitle, children, footer, width = 560, className }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Unsaved-changes guard. `asking` is where the discard bubble points.
  const dirty = useRef<{ on: boolean; label?: string }>({ on: false });
  const [asking, setAsking] = useState<{ rect: DOMRect; label: string } | null>(null);
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const keptAt = useRef(0);
  // Where focus was when the bubble appeared, so Keep editing puts it back.
  const resumeFocus = useRef<HTMLElement | null>(null);
  const requestClose = useCallback((from?: HTMLElement | null) => {
    if (!dirty.current.on) {
      closeRef.current();
      return;
    }
    const anchor = from ?? closeButton.current;
    if (!askingRef.current) resumeFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (anchor) setAsking({ rect: anchor.getBoundingClientRect(), label: dirty.current.label ?? 'Discard changes' });
    else closeRef.current();
  }, []);
  const guard = useMemo<CloseGuard>(
    () => ({
      setDirty: (on, label) => {
        dirty.current = { on, label };
      },
      requestClose,
    }),
    [requestClose],
  );

  // Leaving is animated (faster than arriving), so for that moment the sheet
  // keeps showing what it last showed: once closed, its owner's title and
  // children describe nothing.
  const [closing, setClosing] = useState(false);
  // Decided during render, not in an effect: a render with the panel gone
  // would unmount it (and its form state) before the exit could start.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    setClosing(!open);
  }
  const last = useRef({ title, subtitle, children, footer, width, className });
  if (open) last.current = { title, subtitle, children, footer, width, className };
  const shown = open ? { title, subtitle, children, footer, width, className } : last.current;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
      return;
    }
    setAsking(null);
    dirty.current = { on: false };
    if (!el.open) {
      setClosing(false);
      return;
    }
    const finish = () => {
      if (el.open) el.close();
      setClosing(false);
    };
    // No exit when another sheet is taking over (a details sheet handing off
    // to its editor) — one sheet at a time.
    const handoff = requestAnimationFrame(() => {
      if (document.querySelectorAll('dialog.fin-sheet[open]').length > 1) finish();
    });
    const timer = window.setTimeout(finish, 170);
    return () => {
      cancelAnimationFrame(handoff);
      window.clearTimeout(timer);
    };
  }, [open]);

  // While something is held (next/lift), the panel stops being modal, so a
  // thing can be carried out of it to the page or the dock behind. It is modal
  // again the moment the thing is let go. Its contents never unmount.
  useEffect(() => {
    if (!open) return;
    const el = dialog.current;
    if (!el) return;
    const aside = () => {
      if (!el.open || el.dataset.aside !== undefined) return;
      el.dataset.aside = '';
      el.close();
      el.show();
    };
    const back = () => {
      if (el.dataset.aside === undefined) return;
      delete el.dataset.aside;
      if (!el.open) return;
      el.close();
      el.showModal();
    };
    window.addEventListener('axonix:lift-begin', aside);
    window.addEventListener('axonix:lift-end', back);
    return () => {
      window.removeEventListener('axonix:lift-begin', aside);
      window.removeEventListener('axonix:lift-end', back);
      delete el.dataset.aside;
    };
  }, [open]);

  // Escape is handled here rather than through the dialog's `cancel` event:
  // Chromium's close-watcher rules skip `cancel` in some focus states (e.g.
  // after the focused button unmounts), which left a sheet impossible to
  // dismiss from the keyboard. With the discard bubble up, Escape answers it
  // with "Keep editing".
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (askingRef.current) {
        setAsking(null);
        resumeFocus.current?.focus({ preventScroll: true });
      } else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  const onEdge = typeof document !== 'undefined' && document.documentElement.dataset.nx === 'true';
  // On the right edge (the new shell) the panel is frosted by CSS and no engine is mounted: refracting,
  // it redrew itself on every frame of its way in, and that entrance was the app's one janky move.
  useLiquidGlass(panel, onEdge ? SIDE_GLASS : SHEET_GLASS, (open || closing) && !onEdge);

  return (
    <dialog
      ref={dialog}
      className="fin-sheet"
      data-closing={closing || undefined}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: close through React state, not the browser, so `open` and
        // the element never disagree.
        e.preventDefault();
        requestClose();
      }}
      onMouseDown={(e) => {
        // A click outside that has just answered the bubble with "Keep
        // editing" must not raise it again on the way through.
        if (e.target === dialog.current && performance.now() - keptAt.current > 400) requestClose();
      }}
    >
      {(open || closing) && (
        <div ref={panel} className={['fin-sheet__panel', shown.className].filter(Boolean).join(' ')} style={{ width: shown.width }}>
          <div className="ql-content fin-sheet__inner">
            <header className="fin-sheet__head">
              <div className="fin-sheet__titles">
                <h2 id={titleId}>{shown.title}</h2>
                {shown.subtitle && <p>{shown.subtitle}</p>}
              </div>
              <button ref={closeButton} type="button" className="fin-icon-btn" onClick={(e) => requestClose(e.currentTarget)} aria-label="Close">
                <X size={15} strokeWidth={1.8} />
              </button>
            </header>
            <Guard.Provider value={guard}>
              <GlassSurface.Provider value={true}>
                <FooterSlot.Provider value={footerSlot}>
                  <div className="fin-sheet__body">{shown.children}</div>
                </FooterSlot.Provider>
              </GlassSurface.Provider>
            </Guard.Provider>
            <div ref={setFooterSlot} className="fin-sheet__footslot" />
            {shown.footer && <footer className="fin-sheet__foot">{shown.footer}</footer>}
          </div>
        </div>
      )}
      {open && asking && (
        <DiscardBubble
          anchor={asking.rect}
          label={asking.label}
          onKeep={() => {
            keptAt.current = performance.now();
            setAsking(null);
            resumeFocus.current?.focus({ preventScroll: true });
          }}
          onDiscard={() => {
            setAsking(null);
            dirty.current = { on: false };
            closeRef.current();
          }}
        />
      )}
    </dialog>
  );
}

/**
 * The question raised when closing would lose typing — after Mail's "Delete
 * Draft / Save Draft" bubble, which grows out of the button that was pressed.
 * It sits beside that button (below it, or above when there is no room), and
 * a click anywhere else keeps editing.
 */
function DiscardBubble({ anchor, label, onDiscard, onKeep }: { anchor: DOMRect; label: string; onDiscard: () => void; onKeep: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean; origin: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const above = anchor.bottom + 8 + h > innerHeight - 8;
    const left = Math.round(Math.min(Math.max(8, anchor.right - w), innerWidth - w - 8));
    // It grows out of the button that asked: that button's centre is the origin.
    const ox = Math.min(w, Math.max(0, anchor.left + anchor.width / 2 - left));
    setPos({ left, top: Math.round(above ? anchor.top - h - 8 : anchor.bottom + 8), above, origin: `${ox}px ${above ? '100%' : '0%'}` });
  }, [anchor]);
  // After it is placed: a hidden element cannot take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) keep.current?.focus({ preventScroll: true });
  }, [placed]);

  const keepRef = useRef(onKeep);
  keepRef.current = onKeep;
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) keepRef.current();
    };
    // Registered after the click that raised the bubble has finished.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onPointer, true), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fin-discard"
      role="alertdialog"
      aria-label="Unsaved changes"
      data-above={pos?.above}
      // Transparent, not visibility:hidden, while measuring: a still-hidden
      // element cannot take focus.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, transformOrigin: pos?.origin, opacity: pos ? undefined : 0, pointerEvents: pos ? undefined : 'none' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="fin-discard__btn fin-discard__btn--danger" onClick={onDiscard}>
        {label}
      </button>
      <button ref={keep} type="button" className="fin-discard__btn" onClick={onKeep}>
        Keep editing
      </button>
    </div>
  );
}

/**
 * A form's action bar (Cancel / Save …), pinned under the sheet's scrolling body.
 *
 * Rendered through a portal into a slot OUTSIDE the scroll area, so it needs
 * no background of its own. Its first two versions sat inside the scroller as
 * a sticky bar: one a dark blurred box, one a fade. Either way it covered the
 * glass bezel the engine draws along the panel's edges, so on a real GPU every
 * sheet showed a rectangle cut into its bottom. Out here it covers nothing.
 * React events still bubble through the form (portals keep the React tree),
 * so Ctrl+Enter handlers on the form keep working.
 */
export function SheetFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  return slot ? createPortal(<div className="fin-txform__foot">{children}</div>, slot) : null;
}

/** Uppercase field label + its control, the building block of every sheet. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={['fin-field', className].filter(Boolean).join(' ')}>
      <div className="fin-field__label">
        <span>{label}</span>
        {hint && <span className="fin-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
