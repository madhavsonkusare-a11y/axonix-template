/**
 * The rail — where you are, and what you are carrying.
 *
 * It was a glass dock floating over the page until 2026-10-07, when the owner
 * drew it as a column on the left edge instead ("i want this left sidebar, no
 * more dock", pen.dev frame "Axonix / Home"). It stands on the ground beside
 * the page and takes its own strip of the window, so the page is whole: there
 * is no strip to keep clear and nothing to drag. The class names still say
 * `nx-dock`, because Lift, the time ruler and the ask panel find it by them.
 *
 * Tiles are one neutral material. The module you are in is the inverted one.
 * Below them, at the foot:
 *
 * - **The Pocket** holds things lifted off a page, to carry into another
 *   module. It shows what is in it and, always, the slot a thing is dropped on
 *   to keep it: nothing in the rail moves when something is picked up.
 * - **The clock** opens the time ruler (T). It is lit while the day being
 *   shown is not today.
 * - **The mark** opens search: find, jump, or add (Ctrl K). It was also the
 *   assistant's seat until the assistant left the screen on 2026-10-07.
 *
 * **The tiles take a drop**: Tasks makes a task about the thing, Notes a note,
 * Calendar blocks time for it, the Storeroom keeps a link or a picture,
 * Finance imports a statement. The mark takes one too: it searches for it.
 */
import { Clock, Plus, X, type LucideIcon } from 'lucide-react';
import { Mark } from '../finance/components/Glyphs';
import { useLift } from './lift/Lift';
import { useLiveThing } from './lift/Links';
import { KIND_ICON, keyOf, liftAttrs } from './lift/things';
import { useWorkspace } from './lift/Workspace';
import { useScrub } from './scrub/Scrub';
import Count from './motion/Count';

export interface DockApp {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Something waiting there, e.g. transactions to review. */
  badge?: number;
}

/** How many kept things the Pocket shows before it counts the rest. */
const POCKET_SHOWN = 3;
/** The modules that take a drop, and what the drop is called (see lift/Lift.tsx). */
const DROP: Record<string, string> = { finance: 'mod:finance', tasks: 'mod:tasks', notes: 'mod:notes', calendar: 'mod:calendar', storeroom: 'mod:storeroom' };

export default function Dock({ apps, current, onOpen, onAsk }: { apps: DockApp[]; current: string; onOpen: (id: string) => void; onAsk: () => void }) {
  const ws = useWorkspace();
  const lift = useLift();
  const scrub = useScrub();
  const fresh = useLiveThing();
  const kept = ws.pocket.map(fresh);

  return (
    <div className="nx-dockzone" data-edge="left">
      <div className="nx-dock" data-edge="left" role="navigation" aria-label="Modules">
        <div className="nx-dock__row">
          <div className="nx-dock__apps">
            {apps.map((a) => {
              const on = a.id === current;
              return (
                <button key={a.id} type="button" className="nx-dock__app" aria-current={on ? 'page' : undefined} aria-label={a.label} data-drop={DROP[a.id]} onClick={() => onOpen(a.id)}>
                  <span className={on ? 'nx-tile nx-tile--on' : 'nx-tile'}>
                    <a.icon size={19} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  {a.badge ? (
                    <span className="nx-dock__badge fin-num">
                      <Count value={a.badge} />
                    </span>
                  ) : null}
                  <span className="nx-dock__tip">{a.label}</span>
                </button>
              );
            })}
          </div>
          <div className="nx-dock__foot">
            <div className="nx-pocket" data-drop="pocket" data-empty={kept.length === 0 || undefined} aria-label="Pocket">
              {kept.slice(0, POCKET_SHOWN).map((thing) => {
                const Icon = KIND_ICON[thing.kind];
                return (
                  <div
                    key={keyOf(thing)}
                    className="nx-pocket__chip"
                    role="button"
                    tabIndex={0}
                    title={`${thing.title}. Press to open, or drag it onto a page.`}
                    {...liftAttrs(thing)}
                    data-lift-from="pocket"
                    data-gone={thing.gone || undefined}
                    onClick={() => !thing.gone && lift.open(thing)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.target === e.currentTarget && !thing.gone) lift.open(thing);
                    }}
                  >
                    <span className="nx-pocket__tile">{thing.kind === 'image' && thing.url ? <img src={thing.url} alt="" draggable={false} /> : <Icon size={14} strokeWidth={1.7} aria-hidden="true" />}</span>
                    <span className="nx-pocket__title">{thing.title}</span>
                    {thing.amount && <span className="nx-pocket__amount fin-num">{thing.amount.replace(/^[−-]/, '')}</span>}
                    <button
                      type="button"
                      className="nx-pocket__x"
                      aria-label={`Take ${thing.title} out of the Pocket`}
                      title="Take out"
                      onClick={(e) => {
                        e.stopPropagation();
                        ws.release(thing);
                      }}
                    >
                      <X size={11} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              {kept.length > POCKET_SHOWN && (
                <span className="nx-pocket__more fin-num" title={kept.slice(POCKET_SHOWN).map((t) => t.title).join(', ')}>
                  +{kept.length - POCKET_SHOWN}
                </span>
              )}
              {/* The place to keep something. Always there, so the rail does not shift when a thing is picked up. */}
              <span className="nx-pocket__keep" title="The Pocket. Hold anything and drop it here to carry it.">
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              </span>
            </div>
            <button type="button" className="nx-dock__btn" aria-label="Scrub through time" aria-pressed={scrub.open} data-off-today={!scrub.live || undefined} onClick={() => scrub.setOpen(!scrub.open)}>
              <Clock size={17} strokeWidth={1.7} aria-hidden="true" />
              <span className="nx-dock__tip">
                Scrub <span className="fin-key">T</span>
              </span>
            </button>
            <button type="button" className="nx-dock__mark" aria-label="Search, jump, or add" data-drop="mark" onClick={onAsk}>
              <Mark />
              <span className="nx-dock__tip">
                Search, jump, or add <span className="fin-key">Ctrl K</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
