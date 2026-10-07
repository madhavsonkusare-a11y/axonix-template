/**
 * Alerts: a short question that needs an answer before anything else.
 *
 * Built after the macOS alert in Apple's Human Interface Guidelines, in
 * Axonix's styling: a compact panel with a left-aligned title, one line of
 * explanation, and full-width capsule buttons stacked with the action first.
 * For a destructive action the button is red and focus starts on Cancel, so
 * Enter never deletes by accident.
 *
 * `confirmAlert()` can be called from anywhere — a menu item, a sheet — and
 * resolves to true only for the action button. It is a native modal <dialog>,
 * so it stacks above an open sheet and makes it inert.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface AlertOptions {
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type Pending = AlertOptions & { resolve: (ok: boolean) => void };

let present: ((request: Pending) => void) | null = null;

export function confirmAlert(options: AlertOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (present) present({ ...options, resolve });
    else resolve(false);
  });
}

/** Mounted once, near the root. */
export function AlertHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    present = (request) =>
      setPending((current) => {
        // One alert at a time; a second request is answered "no".
        if (current) {
          request.resolve(false);
          return current;
        }
        return request;
      });
    return () => {
      present = null;
    };
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (pending && !el.open) {
      el.showModal();
      // showModal focuses the first button; the safe one is the default here.
      el.querySelector<HTMLButtonElement>('[data-default]')?.focus();
    }
    if (!pending && el.open) el.close();
    if (!pending) return;
    // Capture phase, ahead of the sheet's own Escape handler underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finishRef.current(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending]);

  return (
    <dialog
      ref={dialog}
      className="fin-alert"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        finish(false);
      }}
    >
      {pending && (
        <div className="fin-alert__panel" role="alertdialog" aria-labelledby={titleId}>
          <h2 id={titleId}>{pending.title}</h2>
          {pending.message && <p>{pending.message}</p>}
          <div className="fin-alert__actions">
            <button
              type="button"
              className={pending.destructive ? 'fin-alert__btn fin-alert__btn--danger' : 'fin-alert__btn fin-alert__btn--primary'}
              data-default={!pending.destructive || undefined}
              onClick={() => finish(true)}
            >
              {pending.confirmLabel}
            </button>
            <button type="button" className="fin-alert__btn" data-default={pending.destructive || undefined} onClick={() => finish(false)}>
              {pending.cancelLabel ?? 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
