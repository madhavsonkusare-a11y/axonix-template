/**
 * Menus: context menus and pop-up buttons.
 *
 * Built after the menus Apple shows in its Human Interface Guidelines (menus,
 * context menus, pop-up buttons), in Axonix's own styling — no Apple assets:
 *
 * - One leading column for a checkmark and one for icons, reserved for every
 *   item as soon as any item uses it, so labels always line up.
 * - The highlighted item is an inset rounded pill; destructive items are red.
 * - A pop-up button opens with the current choice sitting exactly over the
 *   button, so the pointer is already on it.
 * - Keyboard: arrows, Home/End, Enter/Space, Escape, Tab, and type-ahead.
 *
 * A menu renders into the open <dialog> when its trigger is inside one: a modal
 * dialog makes the rest of the page inert, so a menu outside it could not be
 * clicked.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown } from 'lucide-react';

export interface MenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A keyboard shortcut or short note, shown trailing and muted. */
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Defined for toggled items: true shows the checkmark. */
  checked?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuAction | { separator: true; id: string };

const isAction = (e: MenuEntry): e is MenuAction => !('separator' in e);

export type MenuPlacement =
  /** Context menu: at the pointer. */
  | { at: { x: number; y: number } }
  /** Pop-up button: the chosen item over the button. */
  | { over: DOMRect; selectedId?: string };

const EDGE = 8;

export function Menu({
  entries,
  placement,
  onClose,
  label,
  trigger,
  minWidth,
}: {
  entries: MenuEntry[];
  placement: MenuPlacement;
  onClose: () => void;
  label?: string;
  /** Gets focus back on close, and decides which dialog (if any) hosts the menu. */
  trigger?: HTMLElement | null;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = entries.filter(isAction);
  const [host] = useState<HTMLElement>(() => (trigger?.closest('dialog[open]') as HTMLElement | null) ?? document.body);
  const [active, setActive] = useState(() => ('over' in placement ? actions.findIndex((a) => a.id === placement.selectedId) : -1));
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const typed = useRef({ text: '', at: 0 });
  const activeRef = useRef(active);
  activeRef.current = active;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = () => {
    closeRef.current();
    trigger?.focus({ preventScroll: true });
  };
  const choose = (a: MenuAction) => {
    if (a.disabled) return;
    close();
    a.onSelect();
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if ('at' in placement) {
      left = placement.at.x + w > innerWidth - EDGE ? placement.at.x - w : placement.at.x;
      top = placement.at.y + h > innerHeight - EDGE ? placement.at.y - h : placement.at.y;
    } else {
      const r = placement.over;
      const item = el.querySelector<HTMLElement>(`[data-id="${CSS.escape(placement.selectedId ?? '')}"]`);
      const label = item?.querySelector<HTMLElement>('.fin-menu__label');
      // Line the chosen item's label up with the button's text.
      left = r.left - (label ? label.offsetLeft : 10) + 10;
      top = item ? r.top - item.offsetTop - (item.offsetHeight - r.height) / 2 : r.bottom + 4;
    }
    const at = {
      left: Math.round(Math.min(Math.max(EDGE, left), innerWidth - w - EDGE)),
      top: Math.round(Math.min(Math.max(EDGE, top), innerHeight - h - EDGE)),
    };
    // Grow out of what opened it: the pointer, or the chosen item over the button.
    const origin =
      'at' in placement
        ? `${Math.min(w, Math.max(0, placement.at.x - at.left))}px ${Math.min(h, Math.max(0, placement.at.y - at.top))}px`
        : `${Math.max(0, placement.over.left - at.left + 12)}px ${Math.min(h, Math.max(0, placement.over.top + placement.over.height / 2 - at.top))}px`;
    setPos({ ...at, origin });
    // Placement is fixed for the life of the menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Focus once placed: while hidden for measuring, the menu cannot take it.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && (ref.current?.contains(t) || trigger?.contains(t));
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      const step = (from: number, dir: 1 | -1) => {
        for (let i = 1; i <= actions.length; i++) {
          const n = (from + dir * i + actions.length) % actions.length;
          if (!actions[n].disabled) return n;
        }
        return from;
      };
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const a = activeRef.current;
        setActive(step(a < 0 && e.key === 'ArrowUp' ? 0 : a, e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setActive(e.key === 'Home' ? step(-1, 1) : step(0, -1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (activeRef.current >= 0) choose(actions[activeRef.current]);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = performance.now();
        typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
        const hit = actions.findIndex((a) => !a.disabled && a.label.toLowerCase().startsWith(typed.current.text));
        if (hit >= 0) setActive(hit);
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
    // The entries are fixed while the menu is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withCheck = actions.some((a) => a.checked !== undefined);
  const withIcon = actions.some((a) => a.icon);
  let n = -1;

  return createPortal(
    <div
      ref={ref}
      className="fin-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-check={withCheck}
      data-icon={withIcon}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, minWidth, transformOrigin: pos?.origin, opacity: pos ? undefined : 0, pointerEvents: pos ? undefined : 'none' }}
      // Portals keep the React tree: without these, a click here would also
      // reach the row or button the menu was opened from.
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {entries.map((e) => {
        if (!isAction(e)) return <div key={e.id} role="separator" className="fin-menu__sep" />;
        const i = ++n;
        return (
          <div
            key={e.id}
            data-id={e.id}
            role={e.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={e.checked}
            aria-disabled={e.disabled || undefined}
            className="fin-menu__item"
            data-active={i === active}
            data-destructive={e.destructive || undefined}
            onPointerMove={() => !e.disabled && setActive(i)}
            onPointerLeave={() => setActive(-1)}
            onClick={() => choose(e)}
          >
            {withCheck && <span className="fin-menu__check">{e.checked && <Check size={13} strokeWidth={2.4} />}</span>}
            {withIcon && <span className="fin-menu__icon">{e.icon}</span>}
            <span className="fin-menu__label">{e.label}</span>
            {e.hint && <span className="fin-menu__hint">{e.hint}</span>}
          </div>
        );
      })}
    </div>,
    host,
  );
}

export interface PopUpOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/**
 * A pop-up button: shows the current choice and opens a menu of the others with
 * the current one over the button. Stands in for native <select>, whose
 * dropdown is drawn by Windows and ignores the app's look.
 */
export function PopUpButton<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: PopUpOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  const show = () => {
    const el = button.current;
    if (el) setOpen(el.getBoundingClientRect());
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={['fin-popup', className].filter(Boolean).join(' ')}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => (open ? setOpen(null) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
      >
        {current?.icon && <span className="fin-popup__icon">{current.icon}</span>}
        <span className="fin-popup__label">{current?.label}</span>
        <ChevronsUpDown className="fin-popup__chev" size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <Menu
          label={label}
          trigger={button.current}
          placement={{ over: open, selectedId: value }}
          minWidth={Math.round(open.width) + 16}
          onClose={() => setOpen(null)}
          entries={options.map((o) => ({ id: o.value, label: o.label, icon: o.icon, checked: o.value === value, onSelect: () => onChange(o.value) }))}
        />
      )}
    </>
  );
}
