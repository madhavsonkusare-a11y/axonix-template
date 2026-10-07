/**
 * New task, in full: a big title, notes, and every property as a chip.
 *
 * The one-line field is for a thought caught mid-flow; this is for a task that
 * needs saying properly — notes, subtasks, a time block — the way Linear and
 * Things open a whole composer. It opens from the field's expand button or
 * Shift+Enter there, carrying whatever the line already said (`fri 3pm #home`
 * arrives as chips, not text).
 *
 * Enter in the title moves to the notes; Ctrl+Enter creates. "Create more"
 * keeps the sheet open with the project, state, day and priority kept, for a
 * run of related tasks. Closing with typing in it asks first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock, Flag, Hash, Timer, X } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { SheetFooter, useUnsavedChanges } from '../../finance/components/Sheet';
import { CalendarPopover } from '../../finance/components/DatePicker';
import { Menu, type MenuEntry } from '../../finance/components/Menu';
import { useTasks } from '../TasksContext';
import { projectLabel, todayIso } from '../derive';
import { dueWords, parseClock } from '../quickadd';
import { formatEstimate, parseEstimate } from '../taskfile';
import { PRIORITY_LABEL, STATES, STATE_LABEL, type Priority, type TaskState } from '../types';
import Editor, { type EditorHandle } from '../../notes/editor/Editor';
import { vault } from '../../notes/backend';
import { useVaultIndex } from '../../notes/useVaultIndex';
import { PriorityFlag, ProjectDot, StateGlyph } from './bits';

/** What the composer opens with. `n` makes each opening new. */
export interface ComposerSeed {
  n: number;
  title?: string;
  project?: string;
  state?: TaskState;
  priority?: Priority;
  due?: string;
  scheduled?: string;
  estimate?: number;
  tags?: string[];
}

export default function Composer({ seed, onClose, onOpenNote }: { seed: ComposerSeed | null; onClose: () => void; onOpenNote: (target: string) => void }) {
  // Keep the last seed while the sheet animates out.
  const last = useRef<ComposerSeed | null>(seed);
  if (seed) last.current = seed;
  return (
    <Sheet open={seed !== null} onClose={onClose} title="New task" width={680} className="tsk-sheet tsk-compose-sheet">
      {last.current && <Form key={last.current.n} seed={last.current} onClose={onClose} onOpenNote={onOpenNote} />}
    </Sheet>
  );
}

type Chip = 'state' | 'project' | 'priority';

function Form({ seed, onClose, onOpenNote }: { seed: ComposerSeed; onClose: () => void; onOpenNote: (target: string) => void }) {
  const { create, projects, undo } = useTasks();
  const today = todayIso();
  const [title, setTitle] = useState(seed.title ?? '');
  const [body, setBody] = useState('');
  const [bodyRevision, setBodyRevision] = useState(0);
  const [state, setState] = useState<TaskState>(seed.state ?? 'todo');
  const [project, setProject] = useState(seed.project ?? '');
  const [priority, setPriority] = useState<Priority | undefined>(seed.priority);
  const [due, setDue] = useState<string | undefined>(seed.due);
  // A time on its own (`3pm`) is today's; with a day it is that day's.
  const [timeDay] = useState(seed.scheduled?.slice(0, 10));
  const [time, setTime] = useState(seed.scheduled?.slice(11, 16) ?? '');
  const [estimate, setEstimate] = useState(seed.estimate ? formatEstimate(seed.estimate) : '');
  const [tags, setTags] = useState((seed.tags ?? []).map((t) => `#${t}`).join(' '));
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ kind: Chip; at: { x: number; y: number }; trigger: HTMLElement } | null>(null);
  const [calendar, setCalendar] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editor = useRef<EditorHandle>(null);
  const index = useVaultIndex();

  // The chips only nod for values chosen after the sheet has settled.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 260);
    return () => window.clearTimeout(id);
  }, []);

  // The dialog opens after this mounts and gives focus to its first button; take it back.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = titleRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const dirty = title.trim() !== '' || body.trim() !== '';
  const requestClose = useUnsavedChanges(dirty && !busy, 'Discard task');

  // Projects to choose from: the Inbox, the folders, and a new one the line named.
  const choices = useMemo(() => {
    const list = ['', ...projects];
    if (seed.project && !list.includes(seed.project)) list.push(seed.project);
    return list;
  }, [projects, seed.project]);
  const newProject = project !== '' && !projects.includes(project);

  const menuEntries = (): MenuEntry[] => {
    if (menu?.kind === 'state') {
      return STATES.filter((s) => s.id !== 'done').map((s) => ({
        id: `s:${s.id}`,
        label: s.label,
        icon: <StateGlyph state={s.id} />,
        checked: s.id === state,
        onSelect: () => setState(s.id),
      }));
    }
    if (menu?.kind === 'project') {
      return choices.map((p) => ({
        id: `p:${p}`,
        label: p && !projects.includes(p) ? `${p} (new)` : projectLabel(p),
        icon: <ProjectDot name={p} />,
        checked: p === project,
        onSelect: () => setProject(p),
      }));
    }
    return [
      ...([1, 2, 3, 4] as Priority[]).map((p) => ({
        id: `pr:${p}`,
        label: PRIORITY_LABEL[p],
        icon: <PriorityFlag priority={p} label={false} />,
        checked: priority === p,
        onSelect: () => setPriority(p),
      })),
      { separator: true as const, id: 'sep' },
      { id: 'pr:none', label: 'No priority', checked: priority === undefined, onSelect: () => setPriority(undefined) },
    ];
  };
  const openMenu = (kind: Chip) => (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ kind, at: { x: r.left, y: r.bottom + 6 }, trigger: e.currentTarget });
  };

  const submit = async () => {
    if (busy) return;
    const name = title.trim();
    if (!name) {
      setError('Give the task a title.');
      titleRef.current?.focus();
      return;
    }
    let scheduled: string | undefined;
    if (time.trim()) {
      const clock = parseClock(time);
      if (!clock) {
        setError('Type the time like 15:00 or 3pm.');
        return;
      }
      scheduled = `${due ?? timeDay ?? today}T${clock}`;
    }
    let minutes: number | undefined;
    if (estimate.trim()) {
      minutes = parseEstimate(estimate);
      if (!minutes) {
        setError('Type the estimate like 30m or 1h30m.');
        return;
      }
    }
    const tagList = [...new Set(tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];
    setError(null);
    setBusy(true);
    const change = await create({
      title: name,
      project,
      state,
      priority,
      due,
      scheduled,
      estimate: minutes,
      tags: tagList,
      body: body.trim() ? `${body.trimEnd()}\n` : undefined,
    });
    setBusy(false);
    if (change === null) return;
    toast(`Added ${name}`, {
      description: `${STATE_LABEL[state]} · ${projectLabel(project)}`,
      action: { label: 'Undo', onClick: () => undo(change) },
    });
    if (!more) {
      onClose();
      return;
    }
    // Ready for the next one: same project, state, day and priority.
    setTitle('');
    setBody('');
    setBodyRevision((r) => r + 1);
    setTime('');
    setEstimate('');
    setTags('');
    titleRef.current?.focus();
  };

  return (
    <div
      className="tsk-compose"
      data-ready={ready || undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <input
        ref={titleRef}
        className="tsk-compose__title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            editor.current?.focus();
          }
        }}
        placeholder="Task title"
        aria-label="Title"
        spellCheck={false}
        autoComplete="off"
      />

      <div className="tsk-compose__chips" role="group" aria-label="Properties">
        <button type="button" className="tsk-chip" onClick={openMenu('state')} aria-haspopup="menu" aria-label={`State: ${STATE_LABEL[state]}`}>
          {/* Keyed by the value: the chip nods when a new one lands in it. */}
          <span className="tsk-chip__value" key={state}>
            <StateGlyph state={state} />
            {STATE_LABEL[state]}
          </span>
        </button>
        <button type="button" className="tsk-chip" onClick={openMenu('project')} aria-haspopup="menu" aria-label={`Project: ${projectLabel(project)}`}>
          <span className="tsk-chip__value" key={project}>
            <ProjectDot name={project} />
            {projectLabel(project)}
            {newProject && <span className="tsk-chip__note">new</span>}
          </span>
        </button>
        <span className="tsk-chip" data-set={due ? '' : undefined}>
          <button
            type="button"
            className="tsk-chip__hit"
            onClick={(e) => setCalendar({ rect: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget })}
            aria-haspopup="dialog"
            aria-label={due ? `Due ${dueWords(due, today)}` : 'Set a due day'}
          >
            <span className="tsk-chip__value" key={due ?? 'none'}>
              <CalendarDays size={13} strokeWidth={1.9} aria-hidden="true" />
              {due ? dueWords(due, today) : 'Due'}
            </span>
          </button>
          {due && (
            <button type="button" className="tsk-chip__clear" onClick={() => setDue(undefined)} aria-label="Clear the due day">
              <X size={11} strokeWidth={2.2} />
            </button>
          )}
        </span>
        <button type="button" className="tsk-chip" data-set={priority ? '' : undefined} onClick={openMenu('priority')} aria-haspopup="menu" aria-label={priority ? `Priority: ${PRIORITY_LABEL[priority]}` : 'Set a priority'}>
          <span className="tsk-chip__value" key={priority ?? 'none'}>
            {priority ? <PriorityFlag priority={priority} label={false} /> : <Flag size={13} strokeWidth={1.9} aria-hidden="true" />}
            {priority ? PRIORITY_LABEL[priority] : 'Priority'}
          </span>
        </button>
        <label className="tsk-chip tsk-chip--input" data-set={time.trim() ? '' : undefined}>
          <Clock size={13} strokeWidth={1.9} aria-hidden="true" />
          <input className="fin-num" value={time} onChange={(e) => setTime(e.target.value)} placeholder="Time" aria-label="Time block start" size={5} />
        </label>
        <label className="tsk-chip tsk-chip--input" data-set={estimate.trim() ? '' : undefined}>
          <Timer size={13} strokeWidth={1.9} aria-hidden="true" />
          <input className="fin-num" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Estimate" aria-label="Estimate" size={7} />
        </label>
        <label className="tsk-chip tsk-chip--input tsk-chip--grow" data-set={tags.trim() ? '' : undefined}>
          <Hash size={13} strokeWidth={1.9} aria-hidden="true" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags" aria-label="Tags" size={6} />
        </label>
      </div>

      <Editor
        ref={editor}
        value={body}
        revision={bodyRevision}
        onChange={setBody}
        mode="live"
        notes={() => index?.files.map((f) => f.path) ?? []}
        imageUrl={(target) => (/^(https?:|data:)/i.test(target) ? target : null)}
        onOpenLink={(link) => (link.kind === 'url' ? vault.openUrl(link.target) : onOpenNote(link.target))}
        placeholder="Notes. - [ ] makes a subtask, [[ links a note."
        className="tsk-compose__notes"
      />

      {error && (
        <p className="fin-error" role="alert">
          {error}
        </p>
      )}

      {menu && (
        <Menu
          label={menu.kind === 'state' ? 'State' : menu.kind === 'project' ? 'Project' : 'Priority'}
          trigger={menu.trigger}
          placement={{ at: menu.at }}
          minWidth={180}
          onClose={() => setMenu(null)}
          entries={menuEntries()}
        />
      )}
      {calendar && (
        <CalendarPopover
          anchor={calendar.rect}
          trigger={calendar.trigger}
          value={due}
          clearable
          label="Due"
          onPick={(iso) => setDue(iso)}
          onClose={() => setCalendar(null)}
        />
      )}

      <SheetFooter>
        <label className="fin-toggle tsk-compose__more">
          <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
          <span className="fin-toggle__track" aria-hidden="true" />
          <span>Create more</span>
        </label>
        <span className="fin-spacer" />
        <span className="fin-key tsk-compose__key" aria-hidden="true">
          Ctrl ↵
        </span>
        <button type="button" className="fin-pill" onClick={(e) => requestClose(e.currentTarget)}>
          Cancel
        </button>
        <button type="button" className="fin-pill fin-pill--action" onClick={() => void submit()} disabled={busy}>
          Create task
        </button>
      </SheetFooter>
    </div>
  );
}
