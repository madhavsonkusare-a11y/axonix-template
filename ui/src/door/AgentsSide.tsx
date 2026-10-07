/**
 * Connected agents, in the left sidebar (and as a chip in the top bar where
 * a module has no sidebar, or it is put away).
 *
 * A row is an agent that has really come through the door: its mark, its
 * name, the program and plan it runs on, and its state. Idle is quiet, Acting
 * is the live blue, "Waiting on you" is amber. Pressing a row opens the agent;
 * the heading opens the Agents surface.
 */
import { Users } from 'lucide-react';
import { useDoor, type AgentRow, type AgentState } from './DoorContext';

const STATE: Record<AgentState, string> = { idle: 'Idle', acting: 'Acting', waiting: 'Waiting on you' };

/** Claude's mark: the spark, in ink like every other mark here. */
export function ClaudeMark({ size = 14 }: { size?: number }) {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      {rays.map((deg, i) => (
        <path key={deg} d={`M0 ${i % 2 ? -3.2 : -2.6} L0 ${i % 2 ? -8.6 : -10.6}`} transform={`rotate(${deg})`} stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" />
      ))}
    </svg>
  );
}

function Row({ agent, onOpen }: { agent: AgentRow; onOpen: () => void }) {
  return (
    <button type="button" className="nx-row door-agent" data-state={agent.state} data-agent-row={agent.id} onClick={onOpen} title={agent.doing ?? `${agent.name} · ${STATE[agent.state]}`}>
      <span className="door-agent__mark">
        <ClaudeMark />
      </span>
      <span className="door-agent__text">
        <span className="door-agent__name">{agent.name}</span>
        <span className="door-agent__sub">
          {agent.harness} · {agent.plan}
        </span>
      </span>
      <span className="door-agent__state" role="status">
        {STATE[agent.state]}
      </span>
    </button>
  );
}

export default function AgentsSide() {
  const d = useDoor();
  if (!d.active) return null;
  return (
    <section className="door-side" aria-label="Agents" data-lift-none>
      <button type="button" className="door-side__head" onClick={d.openAgents}>
        Agents
        <Users size={13} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {d.agents.length === 0 ? (
        <button type="button" className="nx-row door-agent door-agent--none" onClick={d.openAgents}>
          No agent has connected
        </button>
      ) : (
        d.agents.map((a) => <Row key={a.id} agent={a} onOpen={() => d.openAgent(a.id)} />)
      )}
    </section>
  );
}

/** The same, small: for the top bar when there is no sidebar on screen. */
export function AgentsChip() {
  const d = useDoor();
  if (!d.active || d.agents.length === 0) return null;
  const busy = d.agents.find((a) => a.state === 'acting') ?? d.agents.find((a) => a.state === 'waiting') ?? d.agents[0];
  return (
    <button type="button" className="door-chip" data-state={busy.state} data-agent-row={busy.id} data-lift-none onClick={() => d.openAgent(busy.id)} title={busy.doing ?? `${busy.name} · ${STATE[busy.state]}`}>
      <ClaudeMark size={13} />
      <span>
        {busy.name} · {STATE[busy.state]}
      </span>
    </button>
  );
}
