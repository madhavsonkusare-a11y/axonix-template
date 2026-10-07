/**
 * The library: every note as a card, when no note is open.
 *
 * New in this version. The first Notes showed a welcome message in this space
 * and kept the notes in a narrow list beside it. Here the page is the list:
 * cards you can scan, gathered by how recently they were touched, each saying
 * what kind of note it is, which project it belongs to and, if it holds a
 * checklist, how far through it you are. Right-click a card to pin it or
 * delete it without opening it.
 */
import { useMemo, type ReactNode } from 'react';
import { FileText, Pin, Trash2 } from 'lucide-react';
import type { TrashedNote } from '../../notes/backend';
import { KIND_LABEL, parseNote, type Note } from '../../notes/notefile';
import { ProjectDot } from '../../tasks/components/bits';
import { liftAttrs, noteThing } from '../lift/things';

export type NoteSort = 'edited' | 'title' | 'oldest';

const DAY = 86_400_000;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** When a note was last touched: the time today, then the day, then the date. */
export function whenLabel(time: number): string {
  const start = midnight();
  const d = new Date(time);
  if (time >= start) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (time >= start - DAY) return 'Yesterday';
  if (time >= start - 6 * DAY) return WEEKDAY[d.getDay()];
  const date = `${d.getDate()} ${MONTH[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

function groupsOf(notes: Note[], sort: NoteSort, pinnedApart: boolean): { label: string; list: Note[] }[] {
  if (sort !== 'edited') return [{ label: '', list: notes }];
  const start = midnight();
  const pinned = pinnedApart ? notes.filter((n) => n.pinned) : [];
  const rest = pinnedApart ? notes.filter((n) => !n.pinned) : notes;
  const bands: [string, (t: number) => boolean][] = [
    ['Today', (t) => t >= start],
    ['This week', (t) => t < start && t >= start - 6 * DAY],
    ['This month', (t) => t < start - 6 * DAY && t >= start - 30 * DAY],
    ['Earlier', (t) => t < start - 30 * DAY],
  ];
  return [{ label: 'Pinned', list: pinned }, ...bands.map(([label, test]) => ({ label, list: rest.filter((n) => test(n.mtime)) }))].filter((g) => g.list.length > 0);
}

export type NoteMenu = (note: Note, at: { x: number; y: number }, trigger: HTMLElement) => void;

export function NoteCard({ note, onOpen, onMenu }: { note: Note; onOpen: (path: string) => void; onMenu?: NoteMenu }) {
  const { done, total } = note.checks;
  return (
    <button
      type="button"
      className="nxn-card"
      {...liftAttrs(noteThing(note))}
      onClick={() => onOpen(note.path)}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          onMenu(note, { x: e.clientX, y: e.clientY }, e.currentTarget);
        })
      }
      data-kind={note.kind}
    >
      <span className="nxn-card__top">
        <span className="nxn-card__kind">{KIND_LABEL[note.kind]}</span>
        {note.pinned && <Pin size={12} strokeWidth={1.8} aria-label="Pinned" />}
      </span>
      <strong>{note.title || 'Untitled'}</strong>
      <span className="nxn-card__text">{note.excerpt || 'No text yet'}</span>
      <span className="nxn-card__foot">
        {note.project ? (
          <span className="nxn-card__project">
            <ProjectDot name={note.project} />
            <span>{note.project}</span>
          </span>
        ) : (
          <span className="nxn-card__project">Personal</span>
        )}
        {total > 0 && (
          <span className="nxn-card__checks fin-num" data-done={done === total || undefined} title={`${done} of ${total} checked`}>
            <i>
              <b style={{ width: `${(done / total) * 100}%` }} />
            </i>
            {done}/{total}
          </span>
        )}
        <span className="nxn-card__when fin-num">{whenLabel(note.mtime)}</span>
      </span>
    </button>
  );
}

export default function Library({ notes, sort, pinnedApart, onOpen, onMenu, empty }: { notes: Note[]; sort: NoteSort; pinnedApart: boolean; onOpen: (path: string) => void; onMenu?: NoteMenu; empty: ReactNode }) {
  const groups = useMemo(() => groupsOf(notes, sort, pinnedApart), [notes, sort, pinnedApart]);
  if (notes.length === 0) return <>{empty}</>;
  return (
    <>
      {groups.map((g) => (
        <section className="nxn-group" key={g.label || 'all'}>
          {g.label && (
            <h3 className="nxn-group__label">
              {g.label} <span className="fin-num">{g.list.length}</span>
            </h3>
          )}
          <div className="nxn-cards">
            {g.list.map((n) => (
              <NoteCard key={n.path} note={n} onOpen={onOpen} onMenu={onMenu} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** Notes that were deleted, each with the way back. */
export function Deleted({ items, busy, onRestore }: { items: TrashedNote[]; busy: string | null; onRestore: (item: TrashedNote) => void }) {
  if (items.length === 0) {
    return (
      <section className="nxf-card">
        <div className="fin-empty fin-empty--tall">
          <Trash2 size={22} strokeWidth={1.4} aria-hidden="true" />
          <p className="fin-empty__text">Nothing here. A note you delete can be brought back from this page.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="nxf-card nxn-deleted">
      {items.map((item) => {
        const n = parseNote(item.originalPath, item.text, item.mtime);
        return (
          <div className="nxn-deleted__row" key={item.path}>
            <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong>{n.title}</strong>
              <span>{n.excerpt || 'No text'}</span>
            </div>
            <span className="nxn-deleted__when fin-num">{whenLabel(item.deletedAt)}</span>
            <button type="button" className="fin-pill fin-pill--sm" disabled={busy === item.path} onClick={() => onRestore(item)}>
              Restore
            </button>
          </div>
        );
      })}
    </section>
  );
}
