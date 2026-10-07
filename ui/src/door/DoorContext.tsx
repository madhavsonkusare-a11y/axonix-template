/**
 * Guests at the door: what outside agents do in Axonix, as the page sees it.
 *
 * An agent (Claude Code, the Claude desktop app, a Paperclip worker) calls a
 * tool through the main process (`electron/door.ts`). The call arrives here
 * and is run with the assistant's own `runTool`, against the same state the
 * screens use, so a guest's change is made the way the app makes it, carries
 * its Undo and is stamped machine-made.
 *
 * Everything shown about an agent comes from a call that really happened: the
 * sidebar row's state, the cursor, the steps. Nothing is drawn for an agent
 * that has never connected.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useFinance } from '../finance/FinanceContext';
import { useNotes } from '../notes/NotesContext';
import { useTasks } from '../tasks/TasksContext';
import { TOOL_SPECS, runTool, type World } from '../assistant/tools';
import type { Thing } from '../next/lift/things';
import { useAsOf } from '../next/scrub/Scrub';
import { door, type DoorCall, type DoorEvent, type DoorStatus, type DoorThing, type Overview } from './backend';
import '../styles/door.css';

export type AgentState = 'idle' | 'acting' | 'waiting';

export interface AgentRow {
  id: string;
  name: string;
  harness: string;
  plan: string;
  state: AgentState;
  /** What it is doing, or last did, in the tool's own words. */
  doing?: string;
  lastSeen: string | null;
}

/** One call a guest made, kept for this window's life. A change keeps its Undo. */
export interface DoorStep {
  id: string;
  agent: string;
  tool: string;
  label: string;
  at: number;
  changed?: boolean;
  failed?: boolean;
  thing?: Thing;
  undo?: () => void | Promise<void>;
  undone?: boolean;
}

export type DoorPanel = { kind: 'agent'; id: string } | { kind: 'agents' } | null;

interface DoorValue {
  /** False in the dev server and the Storeroom's own window: there is no door. */
  active: boolean;
  status: DoorStatus | null;
  agents: AgentRow[];
  steps: DoorStep[];
  undo: (id: string) => void;
  panel: DoorPanel;
  openAgent: (id: string) => void;
  openAgents: () => void;
  closePanel: () => void;
  /** Go where the agent's calls go. */
  follow: boolean;
  setFollow: (on: boolean) => void;
  setChatPanel: (on: boolean) => Promise<void>;
  /** Paperclip, as last read. Null until the Agents surface (or a Paperclip call) asked. */
  overview: Overview | null;
  overviewError: string | null;
  refreshOverview: (start?: boolean) => Promise<void>;
  setOverview: (next: Overview) => void;
  /** Every door event as it arrives, for the cursor. */
  subscribe: (cb: (event: DoorEvent) => void) => () => void;
  open: (thing: Thing) => void;
}

const Ctx = createContext<DoorValue | null>(null);

/** Read from the assistant's own list, so the two can never describe a tool differently. */
const SPECS = TOOL_SPECS.flatMap((group) => group.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })));
const KNOWN = new Set(SPECS.map((s) => s.name));
const nameOf = (status: DoorStatus | null, id: string) => status?.agents.find((a) => a.id === id)?.name ?? id;

export function DoorProvider({ onOpen, children }: { /** Opens a thing where it lives. */ onOpen: (thing: Thing) => void; children: ReactNode }) {
  const finance = useFinance();
  const tasks = useTasks();
  const notes = useNotes();
  const asOf = useAsOf();
  // A call outlives renders: it reads what is current through this.
  const world = useRef<World>({ finance, tasks, notes, asOf });
  world.current = { finance, tasks, notes, asOf };
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const [status, setStatus] = useState<DoorStatus | null>(null);
  const [acting, setActing] = useState<Record<string, string | true>>({});
  const [steps, setSteps] = useState<DoorStep[]>([]);
  const [panel, setPanel] = useState<DoorPanel>(null);
  const [follow, setFollowState] = useState(false);
  const [overview, setOverviewState] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const kept = useRef<DoorStep[]>([]);
  kept.current = steps;
  const statusRef = useRef(status);
  statusRef.current = status;
  const followRef = useRef(follow);
  followRef.current = follow;
  const listeners = useRef(new Set<(event: DoorEvent) => void>());

  const refreshStatus = useCallback(() => {
    void door
      ?.status()
      .then((s) => {
        if (!s) return;
        setStatus(s);
        setActing((now) => {
          const next = { ...now };
          for (const a of s.agents) if (a.acting && !next[a.id]) next[a.id] = true;
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  const refreshOverview = useCallback(async (start = false) => {
    if (!door) return;
    const reply = await (start ? door.agentsStart() : door.agentsOverview()).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (reply.ok) {
      setOverviewState(reply.value);
      setOverviewError(null);
    } else setOverviewError(reply.error);
  }, []);

  const undo = useCallback((id: string) => {
    const step = kept.current.find((s) => s.id === id);
    if (!step?.undo || step.undone) return;
    void Promise.resolve(step.undo()).catch(() => toast('That could not be undone.'));
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, undone: true } : s)));
    // Its toast may still be up, offering an Undo that has now been used (the agent took it back itself).
    toast.dismiss(id);
  }, []);

  useEffect(() => {
    if (!door) return;
    const d = door;
    d.ready(SPECS);
    refreshStatus();
    // Whether a work order is waiting for the owner is worth knowing from the start; this never starts Paperclip.
    void refreshOverview();

    const record = (step: DoorStep) => setSteps((all) => [...all.slice(-199), step]);
    const answer = (call: DoorCall, output: string, step: { label: string; changed?: boolean; failed?: boolean; thing?: DoorThing }) => d.result(call.id, { output, step });

    const offCall = d.onCall((call) => {
      void (async () => {
        if (!KNOWN.has(call.tool)) {
          answer(call, JSON.stringify({ error: `there is no tool called ${call.tool}` }), { label: 'Asked for something Axonix cannot do', failed: true });
          return;
        }
        const done = await runTool(call.tool, call.args, () => world.current);
        let output = done.output;
        const undoable = Boolean(done.step.changed && done.step.undo);
        if (undoable) {
          // The agent is told how its own change can be taken back.
          try {
            output = JSON.stringify({ ...(JSON.parse(output) as object), change_id: call.id });
          } catch {
            /* sent as it is */
          }
        }
        const thing = done.step.thing;
        record({ id: call.id, agent: call.agent, tool: call.tool, label: done.step.label, at: Date.now(), changed: done.step.changed, failed: done.step.failed, thing, undo: done.step.undo });
        answer(call, output, { label: done.step.label, changed: done.step.changed, failed: done.step.failed, thing: thing ? { kind: thing.kind, id: thing.id, title: thing.title } : undefined });
        if (done.step.changed) {
          toast(done.step.label, {
            id: call.id,
            description: `${nameOf(statusRef.current, call.agent)} · machine-made`,
            action: undoable ? { label: 'Undo', onClick: () => undo(call.id) } : undefined,
          });
        }
        if (thing && followRef.current && !done.step.failed && (thing.kind === 'task' || thing.kind === 'note')) openRef.current(thing);
      })();
    });

    // An agent taking back one of its own changes: the owner's Undo, asked for by the one who made it.
    const offUndo = d.onUndo((call) => {
      const id = typeof call.args.change_id === 'string' ? call.args.change_id : '';
      const step = kept.current.find((s) => s.id === id);
      if (!step || step.agent !== call.agent || !step.undo) {
        answer(call, JSON.stringify({ error: 'there is no change of yours with that change_id in this session' }), { label: 'Asked to undo a change that is not its own', failed: true });
        return;
      }
      if (step.undone) {
        answer(call, JSON.stringify({ done: 'That change was already undone.' }), { label: `Already undone: ${step.label}` });
        return;
      }
      undo(id);
      record({ id: call.id, agent: call.agent, tool: call.tool, label: `Undid: ${step.label}`, at: Date.now(), changed: true, thing: step.thing });
      answer(call, JSON.stringify({ done: `Undone: ${step.label}` }), { label: `Undid: ${step.label}`, changed: true, thing: step.thing ? { kind: step.thing.kind, id: step.thing.id, title: step.thing.title } : undefined });
    });

    const offEvent = d.onEvent((event) => {
      if (event.type === 'RUN_STARTED') {
        setActing((now) => ({ ...now, [event.agent]: true }));
        refreshStatus();
      } else if (event.type === 'RUN_FINISHED') {
        setActing(({ [event.agent]: _gone, ...rest }) => rest);
        refreshStatus();
      } else if (event.type === 'TOOL_CALL_START') setActing((now) => ({ ...now, [event.agent]: (event.tool ?? '').replace(/_/g, ' ') }));
      else if (event.type === 'TOOL_CALL_END') {
        setActing((now) => ({ ...now, [event.agent]: event.label ?? true }));
        // The main process answered this one itself (Paperclip's tools): it is a step all the same.
        if (event.tool?.startsWith('paperclip_')) {
          record({ id: event.callId ?? `e-${event.at}`, agent: event.agent, tool: event.tool, label: event.label ?? event.tool, at: event.at, failed: event.failed });
          void refreshOverview();
        }
      }
      // The worker starting or stopping changes what Paperclip has to say.
      if (event.agent === 'claude-worker' && (event.type === 'RUN_STARTED' || event.type === 'RUN_FINISHED')) void refreshOverview();
      for (const cb of listeners.current) cb(event);
    });
    const offChanged = d.onChanged(refreshStatus);
    return () => {
      offCall();
      offUndo();
      offEvent();
      offChanged();
    };
  }, [refreshStatus, refreshOverview, undo]);

  const agents = useMemo<AgentRow[]>(() => {
    if (!status) return [];
    // A work order filed and not yet assigned is the owner's move.
    const waiting = overview?.running ? overview.orders.some((o) => o.open && !o.assignee) : false;
    return status.agents
      .filter((a) => a.lastSeen || acting[a.id] || (a.id === 'claude-worker' && waiting))
      .map((a) => {
        const now = acting[a.id];
        const state: AgentState = now ? 'acting' : a.id === 'claude-worker' && waiting ? 'waiting' : 'idle';
        return { id: a.id, name: a.name, harness: a.harness, plan: a.plan, state, doing: typeof now === 'string' ? now : undefined, lastSeen: a.lastSeen };
      });
  }, [status, acting, overview]);

  const value = useMemo<DoorValue>(
    () => ({
      active: door !== null,
      status,
      agents,
      steps,
      undo,
      panel,
      openAgent: (id) => setPanel({ kind: 'agent', id }),
      openAgents: () => setPanel({ kind: 'agents' }),
      closePanel: () => setPanel(null),
      follow,
      setFollow: setFollowState,
      setChatPanel: async (on) => {
        const next = await door?.setChatPanel(on);
        if (next) setStatus(next);
      },
      overview,
      overviewError,
      refreshOverview,
      setOverview: setOverviewState,
      subscribe: (cb) => {
        listeners.current.add(cb);
        return () => void listeners.current.delete(cb);
      },
      open: (thing) => openRef.current(thing),
    }),
    [status, agents, steps, undo, panel, follow, overview, overviewError, refreshOverview],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const nothing = () => {};
const IDLE: DoorValue = {
  active: false,
  status: null,
  agents: [],
  steps: [],
  undo: nothing,
  panel: null,
  openAgent: nothing,
  openAgents: nothing,
  closePanel: nothing,
  follow: false,
  setFollow: nothing,
  setChatPanel: async () => {},
  overview: null,
  overviewError: null,
  refreshOverview: async () => {},
  setOverview: nothing,
  subscribe: () => nothing,
  open: nothing,
};

/** Outside a provider (the Storeroom's own window) there is no door, and nothing breaks. */
export const useDoor = () => useContext(Ctx) ?? IDLE;
