/**
 * What a thing is linked to, shown on the thing.
 *
 * A link is made by dropping one thing on another. It then shows from both
 * ends: on a task's panel, on an open note, on a transaction's details. Each
 * chip is live where the other thing's data is loaded (a task's title and
 * whether it is done, a payment's amount), opens the thing when pressed, can
 * be lifted again, and can be unlinked.
 */
import { useMemo } from 'react';
import { Link2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useFinance } from '../../finance/FinanceContext';
import { useNotes } from '../../notes/NotesContext';
import { useTasks } from '../../tasks/TasksContext';
import { useLift } from './Lift';
import { KIND_ICON, KIND_MODULE, liftAttrs, noteThing, taskThing, txnThing, type Thing } from './things';
import { useWorkspace } from './Workspace';

/** Refreshes a remembered thing from the module that owns it, where that module's data is in memory. */
export function useLiveThing(): (thing: Thing) => Thing & { gone?: boolean; done?: boolean } {
  const { data } = useFinance();
  const { byId } = useTasks();
  const { byPath } = useNotes();
  return useMemo(
    () => (thing: Thing) => {
      if (thing.kind === 'txn') {
        const t = data.transactions.find((x) => x.id === thing.id);
        return t ? txnThing(t, data) : { ...thing, gone: true };
      }
      if (thing.kind === 'task') {
        const t = byId.get(thing.id);
        return t ? { ...taskThing(t), done: t.state === 'done' } : { ...thing, gone: true };
      }
      if (thing.kind === 'note') {
        const n = byPath.get(thing.id);
        return n ? noteThing(n) : { ...thing, gone: true };
      }
      // Events and references are shown as they were when linked.
      return thing;
    },
    [data, byId, byPath],
  );
}

/** How many links a thing has, for the small mark on its row. */
export function useLinkCount(thing: { kind: string; id: string }): number {
  return useWorkspace().linksOf(thing).length;
}

/** The small two-dot mark a linked row carries. */
export function LinkMark({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="nx-linkmark fin-num" title={`Linked to ${count} ${count === 1 ? 'thing' : 'things'}`}>
      <Link2 size={11} strokeWidth={2} aria-hidden="true" />
      {count > 1 && count}
    </span>
  );
}

export default function Linked({ thing, label = 'Linked', before }: { thing: { kind: string; id: string }; label?: string; /** Runs before a chip opens its thing (close the panel this strip is in). */ before?: () => void }) {
  const ws = useWorkspace();
  const lift = useLift();
  const fresh = useLiveThing();
  const links = ws.linksOf(thing);
  if (links.length === 0) return null;
  return (
    <section className="nx-linked" aria-label={label}>
      <h4 className="nx-linked__label">
        {label} <span className="fin-num">{links.length}</span>
      </h4>
      <div className="nx-linked__chips">
        {links.map(({ link, other }) => {
          const now = fresh(other);
          const Icon = KIND_ICON[now.kind];
          return (
            <div
              key={link.id}
              className="nx-linked__chip"
              role="button"
              tabIndex={0}
              data-gone={now.gone || undefined}
              data-done={now.done || undefined}
              title={now.gone ? `${now.title}: no longer in ${KIND_MODULE[now.kind]}` : `Open in ${KIND_MODULE[now.kind]}`}
              {...liftAttrs(now)}
              onClick={() => {
                if (now.gone) return;
                before?.();
                lift.open(now);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.target !== e.currentTarget || now.gone) return;
                before?.();
                lift.open(now);
              }}
            >
              <span className="nx-linked__tile">
                <Icon size={13} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className="nx-linked__text">
                <b>{now.title}</b>
                {now.sub && <span>{now.sub}</span>}
              </span>
              {now.amount && <span className={now.pos ? 'fin-num nxf-pos' : 'fin-num'}>{now.amount}</span>}
              <button
                type="button"
                className="nx-linked__x"
                aria-label={`Unlink ${now.title}`}
                title="Unlink"
                onClick={(e) => {
                  e.stopPropagation();
                  ws.unlink(link.id);
                  toast('Unlinked', { description: now.title, action: { label: 'Undo', onClick: () => ws.link(link.a, link.b) } });
                }}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
