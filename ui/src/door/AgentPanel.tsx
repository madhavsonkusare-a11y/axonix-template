/**
 * One agent, opened from its sidebar row: a panel on the right edge that stays
 * beside the module, so the agent's words and its cursor are on screen together.
 *
 * - **Terminal** (Claude Code only): the real `claude` program in a real
 *   console. This is the way to talk to Claude inside Axonix.
 * - **Chat** (Claude Code only, and only once turned on under Setup): the same
 *   program driven by Axonix, drawn in Axonix's own design. Experimental.
 * - **Steps**: every call this agent made through the door in this window's
 *   life. A change carries its Undo.
 * - **Setup**: how it is connected, Follow, and the chat panel's switch.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { KIND_ICON } from '../next/lift/things';
import { door } from './backend';
import { ClaudeMark } from './AgentsSide';
import { useDoor, type DoorStep } from './DoorContext';

type Tab = 'terminal' | 'chat' | 'steps' | 'setup';

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/* ------------------------------------------------------------------ */
/* terminal                                                            */
/* ------------------------------------------------------------------ */

function ClaudeTerminal() {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !door) return;
    const d = door;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: false,
      allowProposedApi: false,
      scrollback: 4000,
      theme: { background: '#0c0c0d', foreground: '#f2f2f0', cursor: '#f2f2f0', selectionBackground: 'rgba(124, 196, 255, 0.3)' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    let ended = false;
    let live = true;

    const start = () => {
      fit.fit();
      ended = false;
      void d.termStart(term.cols, term.rows).then((r) => {
        if (!live) return;
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        // It was already running behind a closed panel: a resize makes it draw itself again.
        if (r.running) {
          d.termResize(Math.max(20, term.cols - 1), term.rows);
          window.setTimeout(() => d.termResize(term.cols, term.rows), 60);
        }
        term.focus();
      });
    };
    const offData = d.onTermData((data) => term.write(data));
    const offExit = d.onTermExit(() => {
      ended = true;
      term.write('\r\n\x1b[2mClaude Code has ended. Press Enter to start it again.\x1b[0m\r\n');
    });
    const typed = term.onData((data) => {
      if (ended) {
        if (data === '\r') start();
        return;
      }
      d.termInput(data);
    });
    const resized = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      fit.fit();
      d.termResize(term.cols, term.rows);
    });
    resized.observe(el);
    start();
    return () => {
      live = false;
      resized.disconnect();
      typed.dispose();
      offData();
      offExit();
      term.dispose();
    };
  }, []);

  return (
    <div className="door-term">
      {error && (
        <p className="door-note door-note--att" role="alert">
          <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
          {error}
        </p>
      )}
      <div ref={box} className="door-term__box" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

function StepRow({ step, onUndo, onOpen }: { step: DoorStep; onUndo: () => void; onOpen?: () => void }) {
  const Icon = step.thing ? KIND_ICON[step.thing.kind] : null;
  return (
    <li className="door-step" data-failed={step.failed || undefined} data-undone={step.undone || undefined}>
      <span className="door-step__tick" aria-hidden="true">
        {step.failed ? <TriangleAlert size={12} strokeWidth={2} /> : <Check size={12} strokeWidth={2.4} />}
      </span>
      <span className="door-step__label">{step.label}</span>
      <span className="door-step__at">{clock(step.at)}</span>
      {step.thing && Icon && onOpen && !step.undone && (
        <button type="button" className="door-step__open" onClick={onOpen} title={`Open ${step.thing.title}`} aria-label={`Open ${step.thing.title}`}>
          <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
        </button>
      )}
      {step.changed && step.undo && (
        <button type="button" className="fin-pill fin-pill--sm" disabled={step.undone} onClick={onUndo}>
          {step.undone ? 'Undone' : 'Undo'}
        </button>
      )}
    </li>
  );
}

function Steps({ agent }: { agent: string }) {
  const d = useDoor();
  const mine = d.steps.filter((s) => s.agent === agent);
  if (mine.length === 0) return <p className="door-empty">Nothing yet. Each call this agent makes through the door shows here as it happens.</p>;
  return (
    <ol className="door-steps">
      {[...mine].reverse().map((s) => (
        <StepRow key={s.id} step={s} onUndo={() => d.undo(s.id)} onOpen={s.thing ? () => d.open(s.thing!) : undefined} />
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* chat (experimental)                                                 */
/* ------------------------------------------------------------------ */

type Part = { kind: 'you' | 'claude'; text: string } | { kind: 'tool'; tool: string; id: string } | { kind: 'error'; text: string };
/** The conversation outlives the panel being closed, like the program it is drawn from. */
let chatParts: Part[] = [];

function Chat() {
  const d = useDoor();
  const [parts, setParts] = useState<Part[]>(chatParts);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  chatParts = parts;

  useEffect(() => {
    if (!door) return;
    return door.onChatEvent((event) => {
      const add = (...more: Part[]) => setParts((all) => [...all, ...more]);
      if (event.type === 'assistant') {
        const content = ((event.message as { content?: unknown } | undefined)?.content ?? []) as { type?: string; text?: string; name?: string; id?: string }[];
        for (const c of content) {
          if (c.type === 'text' && c.text?.trim()) add({ kind: 'claude', text: c.text.trim() });
          else if (c.type === 'tool_use' && c.name) add({ kind: 'tool', tool: c.name.replace(/^mcp__axonix__/, ''), id: c.id ?? '' });
        }
      } else if (event.type === 'result') {
        setBusy(false);
        if (event.is_error === true) add({ kind: 'error', text: String(event.result ?? 'Claude Code reported an error.').slice(0, 400) });
      } else if (event.type === 'axonix_exit') {
        setBusy(false);
        if (typeof event.error === 'string' && event.error) add({ kind: 'error', text: event.error.slice(0, 400) });
      }
    });
  }, []);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [parts]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const said = text.trim();
    if (!said || busy || !door) return;
    setText('');
    setBusy(true);
    setParts((all) => [...all, { kind: 'you', text: said }]);
    void door.chatSend(said).then((r) => {
      if (r.ok) return;
      setBusy(false);
      setParts((all) => [...all, { kind: 'error', text: r.error }]);
    });
  };

  // A tool row is tied to the door's own record of that call, in order, which is where its Undo lives.
  const mine = d.steps.filter((s) => s.agent === 'claude');
  const used = new Map<string, number>();
  const stepFor = (tool: string): DoorStep | undefined => {
    const n = used.get(tool) ?? 0;
    used.set(tool, n + 1);
    const matching = mine.filter((s) => s.tool === tool);
    const calls = parts.filter((p) => p.kind === 'tool' && p.tool === tool).length;
    return matching[matching.length - calls + n];
  };

  return (
    <div className="door-chat">
      <div className="door-chat__scroll">
        {parts.length === 0 && <p className="door-empty">Claude Code, started by Axonix and drawn here. It has the door’s tools and no others.</p>}
        {parts.map((p, i) => {
          if (p.kind === 'tool') {
            const step = stepFor(p.tool);
            return (
              <div key={i} className="door-chat__tool" data-failed={step?.failed || undefined}>
                <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                <span>{step?.label ?? p.tool.replace(/_/g, ' ')}</span>
                {step?.changed && step.undo && (
                  <button type="button" className="fin-pill fin-pill--sm" disabled={step.undone} onClick={() => d.undo(step.id)}>
                    {step.undone ? 'Undone' : 'Undo'}
                  </button>
                )}
              </div>
            );
          }
          return (
            <p key={i} className="door-chat__msg" data-kind={p.kind}>
              {p.text}
            </p>
          );
        })}
        {busy && <p className="door-chat__busy">Working</p>}
        <div ref={end} />
      </div>
      <form className="door-chat__form" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          rows={1}
          placeholder="Ask Claude Code"
          aria-label="Ask Claude Code"
        />
        {busy ? (
          <button
            type="button"
            className="nx-iconbtn"
            aria-label="Stop"
            onClick={() => {
              door?.chatStop();
              setBusy(false);
            }}
          >
            <Square size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="nx-iconbtn" aria-label="Send" disabled={!text.trim()}>
            <ArrowUp size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
        {parts.length > 0 && !busy && (
          <button
            type="button"
            className="nx-iconbtn"
            aria-label="New conversation"
            title="New conversation"
            onClick={() => {
              door?.chatStop();
              setParts([]);
            }}
          >
            <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

const WHEN = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'never');

function Setup({ agent }: { agent: string }) {
  const d = useDoor();
  const me = d.status?.agents.find((a) => a.id === agent);
  if (!me || !d.status) return null;
  return (
    <div className="door-setup">
      <dl className="door-facts">
        <dt>Runs in</dt>
        <dd>
          {me.harness}, on your Claude {me.plan} plan
        </dd>
        <dt>Last call</dt>
        <dd>{WHEN(me.lastSeen)}</dd>
        <dt>Door</dt>
        <dd>{d.status.url ?? 'closed'}</dd>
        <dt>Token</dt>
        <dd>{me.hasToken ? `In Windows Credential Manager (${me.id}.Axonix Door)` : 'Could not be kept; this agent cannot connect'}</dd>
        <dt>May</dt>
        <dd>Read and change tasks, read the calendar, read and write notes, read money. Not: record money, see identity documents, delete.</dd>
      </dl>
      <label className="door-switch">
        <input type="checkbox" checked={d.follow} onChange={(e) => d.setFollow(e.target.checked)} />
        <span>
          <b>Follow</b>
          Open each task or note this agent touches, as it touches it.
        </span>
      </label>
      {agent === 'claude' && (
        <label className="door-switch">
          <input type="checkbox" checked={d.status.chatPanel} onChange={(e) => void d.setChatPanel(e.target.checked)} />
          <span>
            <b>Chat panel (experimental)</b>
            Axonix starts Claude Code itself and draws the conversation. It is Anthropic’s own program with your own sign-in, but whether an app driving it counts as you using it is not settled. Read Anthropic’s Claude Code terms before turning this on; the Terminal is always allowed.
          </span>
        </label>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the panel                                                           */
/* ------------------------------------------------------------------ */

export default function AgentPanel({ agent }: { agent: string }) {
  const d = useDoor();
  const me = d.status?.agents.find((a) => a.id === agent);
  const row = d.agents.find((a) => a.id === agent);
  const isCode = agent === 'claude';
  const chatOn = isCode && d.status?.chatPanel === true;
  const [tab, setTab] = useState<Tab>(isCode ? 'terminal' : 'steps');
  // The chat tab goes when its switch does.
  const showing: Tab = tab === 'chat' && !chatOn ? 'terminal' : (tab === 'terminal' || tab === 'chat') && !isCode ? 'steps' : tab;

  useEffect(() => setTab(isCode ? 'terminal' : 'steps'), [agent, isCode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the terminal while it has the keyboard.
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.('.door-term')) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      d.closePanel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [d]);

  const tabs: { id: Tab; label: string }[] = [...(isCode ? [{ id: 'terminal' as const, label: 'Terminal' }] : []), ...(chatOn ? [{ id: 'chat' as const, label: 'Chat' }] : []), { id: 'steps', label: 'Steps' }, { id: 'setup', label: 'Setup' }];

  return (
    <aside className="door-panel" aria-label={me?.name ?? 'Agent'} data-lift-none data-wide={showing === 'terminal' || undefined}>
      <header className="door-panel__head">
        <span className="door-agent__mark">
          <ClaudeMark />
        </span>
        <span className="door-panel__title">
          <b>{me?.name ?? agent}</b>
          <span data-state={row?.state ?? 'idle'}>{row?.state === 'acting' ? (row.doing ?? 'Acting') : row?.state === 'waiting' ? 'Waiting on you' : 'Idle'}</span>
        </span>
        <button type="button" className="nx-iconbtn" onClick={d.closePanel} aria-label="Close">
          <X size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>
      <div className="door-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={showing === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="door-panel__body" data-tab={showing}>
        {showing === 'terminal' && <ClaudeTerminal />}
        {showing === 'chat' && <Chat />}
        {showing === 'steps' && <Steps agent={agent} />}
        {showing === 'setup' && <Setup agent={agent} />}
      </div>
    </aside>
  );
}
