/** What the door draws over the page: the agents' cursor, and whichever panel is open. */
import AgentCursor from './AgentCursor';
import AgentPanel from './AgentPanel';
import AgentsSurface from './AgentsSurface';
import { useDoor } from './DoorContext';

export default function DoorLayer() {
  const { active, panel } = useDoor();
  if (!active) return null;
  return (
    <>
      <AgentCursor />
      {panel?.kind === 'agent' && <AgentPanel agent={panel.id} />}
      {panel?.kind === 'agents' && <AgentsSurface />}
    </>
  );
}
