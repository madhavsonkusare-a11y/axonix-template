/**
 * Agents: who works in Axonix, what they were asked, what they did, what it
 * cost. Opened from the sidebar's Agents heading; not a module.
 *
 * The roster is the door's (who has really connected) joined with Paperclip's
 * (the background workers). Work orders, runs and spend are read from
 * Paperclip's own local API, so its window never has to be opened: a work
 * order is assigned here, and a comment to a worker is written here.
 *
 * Nothing is invented: with Paperclip stopped the surface says so and offers
 * to start it; a run's steps are the door's own log of that run's calls.
 */
import { useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { door, type LoggedCall, type PaperclipAgent, type PaperclipRun, type WorkOrder } from './backend';
import { ClaudeMark } from './AgentsSide';
import { useDoor } from './DoorContext';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const took = (run: PaperclipRun) => {
  if (!run.startedAt || !run.finishedAt) return run.startedAt ? 'running' : '';
  const s = Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
  return s < 90 ? `${s}s` : `${Math.round(s / 60)} min`;
};
const thousands = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const isWorker = (a: PaperclipAgent) => /^claude worker$/i.test(a.name);

function RunRow({ run, agent, door: isDoorAgent }: { run: PaperclipRun; agent?: PaperclipAgent; door: boolean }) {
  const [calls, setCalls] = useState<LoggedCall[] | null>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen((now) => !now);
    if (calls === null && run.startedAt) void door?.calls('claude-worker', run.startedAt, run.finishedAt ?? '').then(setCalls);
  };
  return (
    <li className="door-run" data-status={run.status}>
      <button type="button" className="door-run__row" onClick={show} aria-expanded={open} disabled={!isDoorAgent}>
        <span className="door-run__status">{run.status}</span>
        <span className="door-run__who">{agent?.name ?? 'An agent'}</span>
        <span className="door-run__when">
          {when(run.startedAt)} · {took(run)}
        </span>
        <span className="door-run__cost">{run.tokensIn + run.tokensOut > 0 ? `${thousands(run.tokensIn)} in · ${thousands(run.tokensOut)} out${run.onPlan ? ' · on plan' : ''}` : ''}</span>
      </button>
      {run.error && <p className="door-run__error">{run.error}</p>}
      {open &&
        (calls === null ? (
          <p className="door-run__calls">Reading the door’s log</p>
        ) : calls.length === 0 ? (
          <p className="door-run__calls">This run made no calls through the door.</p>
        ) : (
          <ol className="door-run__calls">
            {calls.map((c, i) => (
              <li key={i} data-result={c.result}>
                {c.label || c.tool.replace(/_/g, ' ')}
              </li>
            ))}
          </ol>
        ))}
    </li>
  );
}

function Order({ order, agents, onAssign, onComment }: { order: WorkOrder; agents: PaperclipAgent[]; onAssign: (agent: string) => void; onComment: (body: string) => void }) {
  const [text, setText] = useState('');
  const assignee = agents.find((a) => a.id === order.assignee);
  const worker = agents.find(isWorker);
  return (
    <li className="door-order" data-waiting={(order.open && !order.assignee) || undefined} data-closed={!order.open || undefined}>
      <div className="door-order__head">
        <span className="door-order__name">{order.name}</span>
        <span className="door-order__title">{order.title}</span>
      </div>
      <div className="door-order__meta">
        <span>{order.status.replace(/_/g, ' ')}</span>
        <span>{assignee ? `${order.open ? 'Assigned to' : 'Done by'} ${assignee.name}` : order.open ? 'Not assigned: nothing runs until you assign it' : when(order.updatedAt)}</span>
        {order.open && !order.assignee && worker && (
          <button type="button" className="fin-pill fin-pill--sm fin-pill--action" onClick={() => onAssign(worker.id)} title="Starts one run of the worker, on your Claude plan">
            Assign to {worker.name}
          </button>
        )}
      </div>
      {order.thread.length > 0 && (
        <ol className="door-thread">
          {order.thread.map((said, i) => (
            <li key={i}>
              <span className="door-thread__who">
                {said.from} · {when(said.at)}
              </span>
              <p>{said.text}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="door-order__say"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onComment(text.trim());
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={!assignee ? 'Comment' : order.open ? `Comment to ${assignee.name}: it answers on its next run` : `Comment to reopen it: ${assignee.name} runs again`} aria-label={`Comment on ${order.name}`} />
        <button type="submit" className="fin-pill fin-pill--sm" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </li>
  );
}

export default function AgentsSurface() {
  const d = useDoor();
  const { overview, overviewError, refreshOverview, setOverview } = d;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read on opening, then every 15s while it is open: a run changes on Paperclip's side.
  useEffect(() => {
    void refreshOverview();
    const timer = window.setInterval(() => void refreshOverview(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      d.closePanel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [d]);

  const act = async (run: () => Promise<{ ok: true; value: NonNullable<typeof overview> } | { ok: false; error: string }> | undefined) => {
    setBusy(true);
    setError(null);
    const reply = await run();
    setBusy(false);
    if (!reply) return;
    if (reply.ok) setOverview(reply.value);
    else setError(reply.error);
  };

  const start = async () => {
    setBusy(true);
    await refreshOverview(true);
    setBusy(false);
  };

  const paperclip = overview?.running ? overview : null;
  const failed = error ?? overviewError;

  return (
    <aside className="door-panel door-panel--agents" aria-label="Agents" data-lift-none>
      <header className="door-panel__head">
        <span className="door-panel__title">
          <b>Agents</b>
          <span>Who works in Axonix, and what they did</span>
        </span>
        <button type="button" className="nx-iconbtn" onClick={() => void refreshOverview()} aria-label="Read again" title="Read again">
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" className="nx-iconbtn" onClick={d.closePanel} aria-label="Close">
          <X size={16} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <div className="door-panel__body door-agents">
        {failed && (
          <p className="door-note door-note--att" role="alert">
            <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
            {failed}
          </p>
        )}

        <h3 className="door-h">At the door</h3>
        <ul className="door-roster">
          {(d.status?.agents ?? []).map((a) => {
            const row = d.agents.find((r) => r.id === a.id);
            const calls = d.steps.filter((s) => s.agent === a.id).length;
            return (
              <li key={a.id}>
                <button type="button" className="door-roster__row" onClick={() => d.openAgent(a.id)} data-state={row?.state ?? 'never'}>
                  <span className="door-agent__mark">
                    <ClaudeMark />
                  </span>
                  <span className="door-agent__text">
                    <span className="door-agent__name">{a.name}</span>
                    <span className="door-agent__sub">
                      {a.harness} · {a.plan}
                    </span>
                  </span>
                  <span className="door-roster__fact">{a.lastSeen ? `${calls} ${calls === 1 ? 'call' : 'calls'} this session · last ${when(a.lastSeen)}` : 'Has not connected yet'}</span>
                  <span className="door-agent__state">{row ? (row.state === 'acting' ? 'Acting' : row.state === 'waiting' ? 'Waiting on you' : 'Idle') : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className="door-h">Paperclip</h3>
        {!overview ? (
          <p className="door-empty">Reading Paperclip</p>
        ) : !paperclip ? (
          <div className="door-empty">
            <p>Paperclip is not running, so there are no work orders, runs or spend to show. Once started it keeps running after Axonix closes, until you sign out of Windows.</p>
            <button type="button" className="fin-pill fin-pill--sm" disabled={busy} onClick={() => void start()}>
              {busy ? 'Starting. A first start can take a few minutes' : 'Start Paperclip'}
            </button>
          </div>
        ) : (
          <>
            <ul className="door-workers">
              {paperclip.agents.map((a) => (
                <li key={a.id}>
                  <span className="door-agent__name">{a.name}</span>
                  <span className="door-agent__sub">
                    {a.adapter.replace(/_/g, ' ')} · {a.status} · heartbeat {a.heartbeat ? 'on' : 'off'}
                  </span>
                  <span className="door-workers__spend">
                    {a.runs} {a.runs === 1 ? 'run' : 'runs'} · {thousands(a.tokensIn)} in, {thousands(a.tokensOut)} out · {a.budgetCents ? `${money(a.spentCents)} of ${money(a.budgetCents)} a month` : 'no budget set'}
                  </span>
                </li>
              ))}
            </ul>

            <h3 className="door-h">Work orders</h3>
            {paperclip.orders.length === 0 ? (
              <p className="door-empty">None open, and none finished this week. Ask Claude to “file a work order for the worker”.</p>
            ) : (
              <ul className="door-orders">
                {paperclip.orders.map((o) => (
                  <Order key={o.id} order={o} agents={paperclip.agents} onAssign={(agent) => void act(() => door?.agentsAssign(o.id, agent))} onComment={(body) => void act(() => door?.agentsComment(o.id, body))} />
                ))}
              </ul>
            )}

            <h3 className="door-h">Runs</h3>
            {paperclip.runs.length === 0 ? (
              <p className="door-empty">No run yet.</p>
            ) : (
              <ol className="door-runs">
                {paperclip.runs.map((r) => {
                  const agent = paperclip.agents.find((a) => a.id === r.agent);
                  return <RunRow key={r.id} run={r} agent={agent} door={Boolean(agent && isWorker(agent))} />;
                })}
              </ol>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
