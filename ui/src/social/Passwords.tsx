/**
 * Saved sign-ins: the "Save password?" bubble, the "Sign in as …" chip, and the
 * Passwords panel. None of these ever holds a password — the main process
 * keeps it in Windows Credential Manager and fills the page itself.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { KeyRound, X as Close } from 'lucide-react';
import { appById, SOCIAL_APPS, type SocialAppId } from './apps';
import { bridge, type PasswordList, type SavePrompt } from './bridge';
import { appIcons } from './icons';

const EASE = [0.16, 1, 0.3, 1] as const;

/** Grows from the top-right corner of the page, where the chip lives. */
export function SaveBubble({ prompt, onDone }: { prompt: SavePrompt; onDone: () => void }) {
  const app = appById(prompt.app);
  const saveRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => saveRef.current?.focus({ preventScroll: true }), [prompt.token]);

  const decide = async (decision: 'save' | 'never' | 'dismiss') => {
    setBusy(true);
    await bridge?.decideSave(prompt.token, decision);
    onDone();
  };

  return (
    <motion.div
      className="soc-bubble"
      role="dialog"
      aria-label="Save password"
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      transition={{ duration: 0.22, ease: EASE }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') void decide('dismiss');
      }}
    >
      <div className="soc-bubble__head">
        <span className="soc-bubble__key">
          <KeyRound size={16} strokeWidth={1.7} />
        </span>
        <div>
          <p className="soc-bubble__title">
            {prompt.replaces && prompt.replaces !== prompt.username
              ? `Replace the saved sign-in for ${app?.name}?`
              : prompt.replaces
                ? `Update the saved password for ${app?.name}?`
                : `Save password for ${app?.name}?`}
          </p>
          <p className="soc-bubble__user">{prompt.username}</p>
          <p className="soc-bubble__note">Kept in Windows Credential Manager, encrypted to your Windows account.</p>
        </div>
      </div>
      <div className="soc-bubble__actions">
        <button type="button" className="soc-link" disabled={busy} onClick={() => void decide('never')}>
          Never for {app?.name}
        </button>
        <span className="soc-spacer" />
        <button type="button" className="soc-pill" disabled={busy} onClick={() => void decide('dismiss')}>
          Not now
        </button>
        <button ref={saveRef} type="button" className="soc-pill soc-pill--action" disabled={busy} onClick={() => void decide('save')}>
          {prompt.replaces ? 'Update' : 'Save'}
        </button>
      </div>
    </motion.div>
  );
}

export function SignInChip({ username, onFill }: { username: string; onFill: () => void }) {
  return (
    <motion.button
      type="button"
      className="soc-chip"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 32 }}
      whileTap={{ scale: 0.96 }}
      onClick={onFill}
      title="Fill the saved sign-in"
    >
      <KeyRound size={13} strokeWidth={1.8} />
      <span>
        Sign in as <b>{username}</b>
      </span>
    </motion.button>
  );
}

/** Anchored beside the dock's Passwords button. */
export function PasswordsPanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<PasswordList | null>(null);
  const [confirm, setConfirm] = useState<SocialAppId | null>(null);
  const refresh = () => void bridge?.listPasswords().then(setList);
  useEffect(refresh, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.section
      className="soc-panel"
      aria-label="Passwords"
      initial={{ opacity: 0, scale: 0.95, x: -8 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.97, x: -4, transition: { duration: 0.14 } }}
      transition={{ duration: 0.2, ease: EASE }}
    >
      <header className="soc-panel__head">
        <h2>Passwords</h2>
        <button type="button" className="soc-icon-btn" aria-label="Close" onClick={onClose}>
          <Close size={14} strokeWidth={1.8} />
        </button>
      </header>
      <p className="soc-panel__note">Saved when you sign in, filled when you ask. Stored in Windows Credential Manager.</p>
      {!bridge && <p className="soc-panel__note">Available in the desktop app.</p>}
      <ul className="soc-panel__list">
        {SOCIAL_APPS.map((a) => {
          const saved = list?.saved.find((s) => s.app === a.id);
          const never = list?.never.includes(a.id);
          return (
            <li key={a.id} className="soc-panel__row">
              <img className="soc-panel__icon" src={appIcons[a.id]} alt="" />
              <span className="soc-panel__name">
                {a.name}
                <span className="soc-panel__sub">{saved ? saved.username : never ? 'Never saves' : 'Nothing saved'}</span>
              </span>
              {confirm === a.id ? (
                <span className="soc-panel__confirm">
                  Remove?
                  <button
                    type="button"
                    className="soc-link soc-link--danger"
                    onClick={() => {
                      void bridge?.removePassword(a.id).then(refresh);
                      setConfirm(null);
                    }}
                  >
                    Remove
                  </button>
                  <button type="button" className="soc-link" onClick={() => setConfirm(null)}>
                    Keep
                  </button>
                </span>
              ) : saved ? (
                <button type="button" className="soc-link" onClick={() => setConfirm(a.id)}>
                  Remove
                </button>
              ) : never ? (
                <button type="button" className="soc-link" onClick={() => void bridge?.allowSaving(a.id).then(refresh)}>
                  Allow saving
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
