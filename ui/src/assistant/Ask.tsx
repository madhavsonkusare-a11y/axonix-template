/**
 * Axonix on the mark: the assistant's panel.
 *
 * Glass, because it floats: it stands off the dock, by the mark it grows out
 * of. It follows the approved mockup: the mark at work, the steps as they
 * happen, then the answer. Each step is a tool the model really called; a
 * step that changed something carries its Undo.
 *
 * It opens from the command bar ("Ask Axonix…"), from a thing dropped on the
 * mark, and with Ctrl+J. Escape closes it.
 *
 * OpenAI's guidelines for apps on a ChatGPT plan are followed as written: the
 * button says "Continue with ChatGPT", the first sign-in is confirmed once,
 * "Using ChatGPT plan" with Manage usage stays by the field, and a usage
 * limit's first action is Manage usage.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUp, Check, ExternalLink, RotateCcw, Settings2, Square, SquarePen, TriangleAlert, X } from 'lucide-react';
import { Mark } from '../finance/components/Glyphs';
import { PopUpButton } from '../finance/components/Menu';
import { useLift } from '../next/lift/Lift';
import { KIND_ICON } from '../next/lift/things';
import { useScrub } from '../next/scrub/Scrub';
import { useAssistant, type Turn } from './AssistantContext';
import type { ModelChoice } from './backend';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** A toast's width and a gap. */
const TOAST_ROOM = 384;

const STARTERS = ['What is on today?', 'How is this month going?', 'What is late, and what is due this week?'];

export default function Ask() {
  const a = useAssistant();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const [text, setText] = useState('');
  const [settings, setSettings] = useState(false);

  // One thing floats by the dock at a time: this panel, or the time ruler.
  const scrub = useScrub();
  const { open: rulerOpen, setOpen: setRuler } = scrub;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (a.open && !wasOpen.current && rulerOpen) setRuler(false);
    else if (a.open && wasOpen.current && rulerOpen) a.setOpen(false);
    wasOpen.current = a.open;
  }, [a, rulerOpen, setRuler]);

  // Stands off the dock by 12px, by the mark; with no dock on screen (a first version), low and centred.
  useLayoutEffect(() => {
    if (!a.open) return;
    const place = () => {
      const el = box.current;
      if (!el) return;
      const root = document.documentElement;
      const dock = document.querySelector('.nx-dock')?.getBoundingClientRect();
      const edge = root.dataset.nxDock;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = clamp(innerWidth / 2 - w / 2, 12, innerWidth - w - 12);
      let low = true;
      if (!dock || !edge || edge === 'none') setPos({ left, bottom: 28 });
      else if (edge === 'bottom' || edge === 'top') {
        left = clamp(dock.right - w, 12, innerWidth - w - 12);
        low = edge === 'bottom';
        setPos(low ? { left, bottom: innerHeight - dock.top + 12 } : { left, top: dock.bottom + 12 });
      } else {
        const top = clamp(dock.bottom - h, 12, innerHeight - h - 12);
        left = edge === 'left' ? dock.right + 12 : dock.left - 12 - w;
        low = top + h > innerHeight - 160;
        setPos(edge === 'left' ? { left, top } : { right: innerWidth - dock.left + 12, top });
      }
      // Toasts carry Undo: they stand beside the panel, never under it.
      if (low && left >= TOAST_ROOM) {
        root.dataset.axToasts = 'beside';
        root.style.setProperty('--ax-toast-left', `${left - TOAST_ROOM + 12}px`);
      } else if (low) root.dataset.axToasts = 'top';
      else delete root.dataset.axToasts;
    };
    place();
    window.addEventListener('resize', place);
    const seen = new ResizeObserver(place);
    if (box.current) seen.observe(box.current);
    return () => {
      window.removeEventListener('resize', place);
      seen.disconnect();
      delete document.documentElement.dataset.axToasts;
    };
  }, [a.open]);

  // Ctrl+J opens and closes it; Escape closes it before anything behind it hears the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        if (document.querySelector('dialog[open], .palette')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        a.setOpen(!a.open);
        return;
      }
      if (e.key === 'Escape' && a.open && !document.querySelector('dialog[open], .palette, .fin-menu')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (settings && a.status?.connected) setSettings(false);
        else a.setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [a, settings]);

  useEffect(() => {
    if (a.open) window.setTimeout(() => field.current?.focus({ preventScroll: true }), 60);
    else setSettings(false);
  }, [a.open, a.attached]);
  const connected = Boolean(a.status?.connected);
  useEffect(() => {
    if (!connected) setSettings(false);
  }, [connected]);

  // The newest words stay in view while they arrive.
  const last = a.turns[a.turns.length - 1];
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [a.turns.length, last?.answer, last?.steps.length, last?.state]);

  if (!a.open) return null;

  const status = a.status;
  const ready = Boolean(status?.connected && status.sharing);
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || a.busy || !ready) return;
    a.ask(text, a.attached ?? undefined);
    setText('');
  };
  const AttachedIcon = a.attached ? KIND_ICON[a.attached.kind] : null;

  return (
    <div ref={box} className="ax-ask" role="dialog" aria-label="Axonix assistant" style={{ ...pos, visibility: pos ? undefined : 'hidden' }}>
      <header className="ax-ask__head">
        <span className="ax-ask__mark">
          <Mark state={a.busy ? 'working' : undefined} />
        </span>
        <b>Axonix</b>
        <span className="ax-ask__space" />
        {ready && a.turns.length > 0 && !settings && (
          <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={a.clear} aria-label="New conversation" title="New conversation. This one is forgotten.">
            <SquarePen size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
        )}
        {status?.connected && (
          <button type="button" className="nx-iconbtn nx-iconbtn--sm" aria-pressed={settings} onClick={() => setSettings((v) => !v)} aria-label="Assistant settings" title="Account, model and usage">
            <Settings2 size={14} strokeWidth={1.7} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="nx-iconbtn nx-iconbtn--sm" onClick={() => a.setOpen(false)} aria-label="Close" title="Close · Esc">
          <X size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </header>

      {settings && status?.connected ? (
        <Settings onDone={() => setSettings(false)} />
      ) : !ready ? (
        <Connect />
      ) : (
        <>
          <div ref={scroller} className="ax-ask__body">
            {!status?.welcomed && (
              <div className="ax-note">
                <b>You’re using your ChatGPT plan</b>
                <p>Requests Axonix makes for you count against your ChatGPT plan. Manage usage in your ChatGPT settings.</p>
                <button type="button" className="fin-pill fin-pill--sm" onClick={a.acknowledge}>
                  Got it
                </button>
              </div>
            )}
            {a.turns.length === 0 ? (
              <div className="ax-start">
                <p>Ask about your money, tasks, calendar or notes, or tell me what to do. Every change I make can be undone.</p>
                <div className="ax-start__list">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" className="ax-start__one" onClick={() => a.ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              a.turns.map((t) => <TurnView key={t.id} turn={t} />)
            )}
          </div>

          <form className="ax-ask__form" onSubmit={submit}>
            {a.attached && AttachedIcon && (
              <span className="ax-chip" title={a.attached.title}>
                <AttachedIcon size={12} strokeWidth={1.8} aria-hidden="true" />
                <span>{a.attached.title}</span>
                <button type="button" onClick={a.detach} aria-label="Ask without this">
                  <X size={10} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            )}
            <div className="ax-ask__field">
              <textarea
                ref={field}
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={a.attached ? 'Ask about this' : 'Ask, or say what to do'}
                aria-label="Ask Axonix"
                spellCheck={false}
              />
              {a.busy ? (
                <button type="button" className="ax-send" onClick={a.stop} aria-label="Stop" title="Stop">
                  <Square size={11} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" className="ax-send" disabled={!text.trim()} aria-label="Send" title="Send · Enter">
                  <ArrowUp size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              )}
            </div>
            <p className="ax-plan">
              {a.real ? (
                <>
                  Using ChatGPT plan
                  <button type="button" className="fin-link" onClick={a.openUsage}>
                    Manage usage
                  </button>
                </>
              ) : (
                'Stand-in model, dev server only. Not ChatGPT.'
              )}
            </p>
          </form>
        </>
      )}
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const a = useAssistant();
  const lift = useLift();
  const Icon = turn.thing ? KIND_ICON[turn.thing.kind] : null;
  const waiting = turn.state === 'working' && !turn.answer;
  return (
    <article className="ax-turn" data-state={turn.state}>
      <p className="ax-turn__q">
        {turn.thing && Icon && (
          <span className="ax-chip ax-chip--quiet">
            <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>{turn.thing.title}</span>
          </span>
        )}
        {turn.question}
      </p>
      {turn.steps.length > 0 && (
        <ul className="ax-steps">
          {turn.steps.map((s) => (
            <li key={s.key} className="ax-step" data-failed={s.failed || undefined} data-undone={s.undone || undefined} data-changed={s.changed || undefined}>
              {s.failed ? <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" /> : <Check size={12} strokeWidth={2.4} aria-hidden="true" />}
              <span>{s.label}</span>
              {s.changed && !s.undone && s.thing && (
                <button type="button" className="fin-link" onClick={() => lift.open(s.thing!)}>
                  Open
                </button>
              )}
              {s.changed && s.undo && !s.undone && (
                <button type="button" className="fin-link" onClick={() => a.undoStep(turn.id, s.key)}>
                  Undo
                </button>
              )}
              {s.undone && <em>Undone</em>}
            </li>
          ))}
        </ul>
      )}
      {waiting && <i className="ax-pulse" aria-label="Working" />}
      {turn.answer && <div className="ax-answer">{turn.answer}</div>}
      {turn.state === 'stopped' && <p className="ax-turn__end">Stopped.</p>}
      {turn.error && (
        <div className="ax-error" role="alert">
          <p>{turn.error.message}</p>
          <div className="ax-error__acts">
            {turn.error.recovery === 'usage' && (
              <button type="button" className="fin-pill fin-pill--sm fin-pill--action" onClick={a.openUsage}>
                Manage usage
                <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            {turn.error.recovery === 'sign-in' && (
              <button type="button" className="fin-pill fin-pill--sm fin-pill--action" onClick={() => void a.signIn()}>
                Continue with ChatGPT
              </button>
            )}
            {(turn.error.recovery === 'retry' || turn.error.recovery === 'none') && (
              <button type="button" className="fin-pill fin-pill--sm" onClick={() => a.ask(turn.question, turn.thing)} disabled={a.busy}>
                <RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** Before sign-in, or when the sign-in has ended, or when the plan was not shared. */
function Connect() {
  const a = useAssistant();
  const s = a.status;
  const signedInWithoutPlan = Boolean(s?.connected && !s.sharing);
  return (
    <div className="ax-connect">
      <h3>{s?.expired ? 'Sign in again' : signedInWithoutPlan ? 'Allow your ChatGPT plan' : 'Use your ChatGPT plan'}</h3>
      <p>
        {s?.expired
          ? 'The ChatGPT sign-in ended: it expired, or Axonix was disconnected in ChatGPT’s settings.'
          : signedInWithoutPlan
            ? `You are signed in${s?.email ? ` as ${s.email}` : ''}, but ChatGPT plan usage was not allowed for Axonix, so it cannot answer. Sign in again and allow it.`
            : 'Axonix’s assistant runs on the ChatGPT plan you already have: no API key, no second bill. It needs ChatGPT Plus or Pro.'}
      </p>
      {s?.signingIn ? (
        <div className="ax-connect__wait">
          <i className="ax-pulse" aria-hidden="true" />
          <p>Finish signing in in your browser. This panel updates by itself.</p>
          <button type="button" className="fin-pill fin-pill--sm" onClick={a.cancelSignIn}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="ax-chatgpt" onClick={() => void a.signIn()}>
          Continue with ChatGPT
        </button>
      )}
      {a.signInError && (
        <p className="ax-connect__error" role="alert">
          {a.signInError}
        </p>
      )}
      <ul className="ax-connect__facts">
        <li>Sign-in happens in your browser, on OpenAI’s page. Axonix never sees your password.</li>
        <li>When you ask something, your question and what Axonix reads to answer it (figures, task titles, note text) are sent to OpenAI. Your ChatGPT conversations are not shared with Axonix.</li>
        <li>ID numbers, card numbers and saved passwords kept in Finance and Social are never sent. A note is sent as written if Axonix reads it to answer you.</li>
        <li>You can limit or remove Axonix in ChatGPT’s settings at any time.</li>
      </ul>
      {!a.real && <p className="ax-plan">Dev server: this button connects a stand-in, not ChatGPT.</p>}
    </div>
  );
}

function Settings({ onDone }: { onDone: () => void }) {
  const a = useAssistant();
  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [test, setTest] = useState<{ name: string; ok: boolean; detail: string }[] | 'running' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [left, setLeft] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    a.models()
      .then((list) => live && setModels(list))
      .catch((e) => live && setModelError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // Loaded once each time the settings open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = a.status;
  const chosen = models?.find((m) => m.slug === s?.model)?.slug ?? models?.[0]?.slug ?? '';
  return (
    <div className="ax-settings">
      <dl>
        <div>
          <dt>Account</dt>
          <dd>{s?.email ?? s?.name ?? 'Signed in'}</dd>
        </div>
        <div>
          <dt>ChatGPT plan usage</dt>
          <dd>
            {s?.sharing ? 'Enabled' : 'Not allowed'}
            <button type="button" className="fin-link" onClick={a.openUsage}>
              Manage usage
            </button>
          </dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            {models && models.length > 0 ? (
              <PopUpButton label="Model" value={chosen} onChange={(slug) => void a.setModel(slug)} options={models.map((m) => ({ value: m.slug, label: m.name }))} />
            ) : modelError ? (
              <span className="ax-settings__error">{modelError}</span>
            ) : (
              'Loading…'
            )}
          </dd>
        </div>
      </dl>

      <div className="ax-settings__test">
        <button type="button" className="fin-pill fin-pill--sm" disabled={test === 'running'} onClick={() => { setTest('running'); void a.selfTest().then(setTest).catch((e) => setTest([{ name: 'Test', ok: false, detail: e instanceof Error ? e.message : String(e) }])); }}>
          {test === 'running' ? 'Testing…' : 'Test the connection'}
        </button>
        <span>Three small requests: list models, stream a sentence, call a tool and use its answer.</span>
      </div>
      {Array.isArray(test) && (
        <ul className="ax-steps ax-settings__result">
          {test.map((t) => (
            <li key={t.name} className="ax-step" data-failed={!t.ok || undefined}>
              {t.ok ? <Check size={12} strokeWidth={2.4} aria-hidden="true" /> : <TriangleAlert size={12} strokeWidth={2} aria-hidden="true" />}
              <span>
                <b>{t.name}.</b> {t.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="ax-settings__foot">
        <button
          type="button"
          className="fin-link fin-link--danger"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void a
              .signOut()
              .then((r) => setLeft(r.revoked ? null : 'Signed out here. OpenAI did not confirm the session was ended; you can remove Axonix in ChatGPT’s settings.'))
              .finally(() => setLeaving(false));
          }}
        >
          {leaving ? 'Signing out…' : 'Sign out of ChatGPT'}
        </button>
        <span className="ax-ask__space" />
        <button type="button" className="fin-pill fin-pill--sm" onClick={onDone}>
          Done
        </button>
      </div>
      {left && <p className="ax-settings__error">{left}</p>}
    </div>
  );
}
