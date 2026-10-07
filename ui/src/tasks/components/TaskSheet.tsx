/**
 * One task, opened.
 *
 * Every field is live — a task is edited far more often than it is read, so
 * the sheet does not make you press Edit first. Each change is written to the
 * file at once and can be undone (Ctrl+Z, or the toast). The notes read as
 * formatted text with live checkboxes; Edit turns them into the raw markdown.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Clock, Hash, Timer } from 'lucide-react';
import { toast } from 'sonner';
import Sheet, { SheetFooter, useUnsavedChanges } from '../../finance/components/Sheet';
import { LiquidSegment } from '../../finance/components/Liquid';
import { CalendarPopover } from '../../finance/components/DatePicker';
import { Menu, type MenuEntry } from '../../finance/components/Menu';
import { useTasks } from '../TasksContext';
import { dueLabel, projectLabel, todayIso } from '../derive';
import { dueWords, parseClock } from '../quickadd';
import { addChecklist, formatEstimate, parseEstimate, toggleChecklist } from '../taskfile';
import { PRIORITY_LABEL, STATES, type Priority, type Task, type TaskPatch, type TaskState } from '../types';
import Editor, { fileToBase64 } from '../../notes/editor/Editor';
import Reader from '../../notes/Reader';
import { imageUrl as vaultImageUrl, vault } from '../../notes/backend';
import { resolveImage } from '../../notes/links';
import { useVaultIndex } from '../../notes/useVaultIndex';
import { PriorityFlag, ProjectDot } from './bits';

export default function TaskSheet({ id, onClose, onOpenNote, extra }: { id: string | null; onClose: () => void; onOpenNote: (target: string) => void; /** Shown under the task's details (what it is linked to, in the new shell). */ extra?: ReactNode }) {
  const { byId, resolveId, loading } = useTasks();
  const task = id ? byId.get(resolveId(id)) : undefined;
  // Keep the last task while the sheet animates out.
  const last = useRef<Task | undefined>(task);
  if (task) last.current = task;

  // Gone from the folder (trashed here, deleted or moved away elsewhere): close.
  useEffect(() => {
    if (id && !task && !loading) onClose();
  }, [id, task, loading, onClose]);

  const shown = task ?? last.current;
  return (
    <Sheet
      open={id !== null && task !== undefined}
      onClose={onClose}
      title={shown ? <TitleField task={shown} /> : ''}
      subtitle={shown ? <Where task={shown} /> : undefined}
      width={620}
      className="tsk-sheet"
    >
      {shown && <Details key={shown.id} task={shown} onClose={onClose} onOpenNote={onOpenNote} extra={extra} />}
    </Sheet>
  );
}

function Where({ task }: { task: Task }) {
  return (
    <span className="tsk-sheet__where">
      <ProjectDot name={task.project} />
      {projectLabel(task.project)}
    </span>
  );
}

/**
 * The title, editable in place. Renaming renames the file. It grows with its
 * text through CSS (`field-sizing: content`), never by measuring: the sheet's
 * dialog is still closed when this first renders, so a measured height was 0
 * and the title showed as a flat line (2026-09-28).
 */
function TitleField({ task }: { task: Task }) {
  const { update } = useTasks();
  const [value, setValue] = useState(task.title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setValue(task.title);
  }, [task.title]);
  const commit = () => {
    editing.current = false;
    const next = value.trim();
    if (!next) setValue(task.title);
    else if (next !== task.title) void update(task.id, { title: next });
  };
  return (
    <textarea
      className="tsk-sheet__title"
      rows={1}
      value={value}
      onChange={(e) => {
        editing.current = true;
        setValue(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="Title"
      spellCheck={false}
      disabled={Boolean(task.broken)}
    />
  );
}

function Details({ task, onClose, onOpenNote, extra }: { task: Task; onClose: () => void; onOpenNote: (target: string) => void; extra?: ReactNode }) {
  const { update, trash, undo, projects } = useTasks();
  const today = todayIso();
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [menu, setMenu] = useState<{ kind: 'project' | 'priority'; rect: DOMRect; trigger: HTMLElement } | null>(null);
  const [calendar, setCalendar] = useState<{ rect: DOMRect; trigger: HTMLElement } | null>(null);
  const locked = Boolean(task.broken);

  const set = (patch: TaskPatch, message?: string) =>
    void update(task.id, patch).then((change) => {
      if (change !== null && message) toast(message, { action: { label: 'Undo', onClick: () => undo(change) } });
    });

  /* ---------- menus ---------- */

  const menuEntries = (): MenuEntry[] => {
    if (menu?.kind === 'project') {
      return ['', ...projects].map((p) => ({
        id: `p:${p}`,
        label: projectLabel(p),
        icon: <ProjectDot name={p} />,
        checked: p === task.project,
        onSelect: () => p !== task.project && set({ project: p }, `Moved to ${projectLabel(p)}`),
      }));
    }
    return [
      ...([1, 2, 3, 4] as Priority[]).map((p) => ({
        id: `pr:${p}`,
        label: PRIORITY_LABEL[p],
        icon: <PriorityFlag priority={p} label={false} />,
        checked: task.priority === p,
        onSelect: () => set({ priority: p }),
      })),
      { separator: true as const, id: 'sep' },
      { id: 'pr:none', label: 'No priority', checked: task.priority === undefined, onSelect: () => set({ priority: null }) },
    ];
  };
  const openMenu = (kind: 'project' | 'priority') => (e: React.MouseEvent<HTMLButtonElement>) =>
    setMenu({ kind, rect: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget });

  /* ---------- time, estimate, tags ---------- */

  const [time, setTime] = useState(task.scheduled?.slice(11) ?? '');
  const [estimate, setEstimate] = useState(task.estimate ? formatEstimate(task.estimate) : '');
  const [tags, setTags] = useState(task.tags.map((t) => `#${t}`).join(' '));
  useEffect(() => setTime(task.scheduled?.slice(11) ?? ''), [task.scheduled]);
  useEffect(() => setEstimate(task.estimate ? formatEstimate(task.estimate) : ''), [task.estimate]);
  useEffect(() => setTags(task.tags.map((t) => `#${t}`).join(' ')), [task.tags]);

  const commitTime = () => {
    if (!time.trim()) {
      if (task.scheduled) set({ scheduled: null });
      return;
    }
    const clock = parseClock(time);
    if (!clock) {
      setTime(task.scheduled?.slice(11) ?? '');
      toast('Type a time like 15:00 or 3pm.');
      return;
    }
    const day = task.scheduled?.slice(0, 10) ?? task.due ?? today;
    const next = `${day}T${clock}`;
    setTime(clock);
    if (next !== task.scheduled) set({ scheduled: next });
  };
  const commitEstimate = () => {
    if (!estimate.trim()) {
      if (task.estimate) set({ estimate: null });
      return;
    }
    const minutes = parseEstimate(estimate);
    if (!minutes) {
      setEstimate(task.estimate ? formatEstimate(task.estimate) : '');
      toast('Type an estimate like 30m or 1h30m.');
      return;
    }
    setEstimate(formatEstimate(minutes));
    if (minutes !== task.estimate) set({ estimate: minutes });
  };
  const commitTags = () => {
    const next = [...new Set(tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];
    if (next.join(' ') !== task.tags.join(' ')) set({ tags: next });
  };
  const onEnterBlur = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  /* ---------- notes ---------- */

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.body);
  const [subtask, setSubtask] = useState('');
  const requestClose = useUnsavedChanges(editing && draft !== task.body, 'Discard note changes');
  const index = useVaultIndex();
  // The task file sits at Tasks/<path> in the vault.
  const vaultPath = `Tasks/${task.path}`;
  const imageUrl = (target: string) => {
    if (/^(https?:|data:)/i.test(target)) return target;
    const found = index ? resolveImage(target, index.images, vaultPath) : null;
    return found ? vaultImageUrl(found) : null;
  };
  const openLink = (link: { kind: 'note' | 'url'; target: string }) => {
    if (link.kind === 'url') vault.openUrl(link.target);
    else onOpenNote(link.target);
  };
  const attach = async (file: File) => {
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const name = `Pasted image ${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.${ext}`;
    try {
      const saved = await vault.attach(vaultPath, name, await fileToBase64(file));
      return `![[${saved.slice(saved.lastIndexOf('/') + 1)}]]`;
    } catch (e) {
      toast(`Couldn’t save the image: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const saveNotes = () => {
    setEditing(false);
    if (draft !== task.body) set({ body: draft });
  };

  const due = dueLabel(task, today);
  const done = task.state === 'done';

  return (
    <div className="tsk-detail">
      {task.broken && (
        <p className="fin-error" role="alert">
          {task.broken} This task is locked so its contents stay safe.
        </p>
      )}
      {task.unverified && (
        <div className="tsk-detail__auto">
          <span className="fin-auto">auto</span>
          <span>An agent wrote this task. It stays marked until you confirm it.</span>
          <button type="button" className="fin-link" onClick={() => set({ status: null }, 'Confirmed')} disabled={locked}>
            Confirm
          </button>
        </div>
      )}

      <LiquidSegment<TaskState>
        label="State"
        mono={false}
        className="tsk-detail__states"
        value={task.state}
        onChange={(state) => !locked && state !== task.state && set({ state }, state === 'done' ? `Done: ${task.title}` : undefined)}
        options={STATES.map((s) => ({ value: s.id, label: s.label }))}
      />

      <div className="tsk-facts">
        <button type="button" className="fin-fact fin-fact--button" onClick={openMenu('project')} disabled={locked} aria-haspopup="menu">
          <span className="fin-fact__label">Project</span>
          <span className="fin-fact__value">
            <ProjectDot name={task.project} />
            {projectLabel(task.project)}
          </span>
        </button>
        <button
          type="button"
          className="fin-fact fin-fact--button"
          disabled={locked}
          aria-haspopup="dialog"
          onClick={(e) => setCalendar({ rect: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget })}
        >
          <span className="fin-fact__label">Due</span>
          <span className="fin-fact__value">
            <CalendarDays size={13} strokeWidth={1.8} aria-hidden="true" />
            {task.due ? <span className="tsk-due" data-tone={due?.tone}>{dueWords(task.due, today)}</span> : <span className="tsk-fact__none">No date</span>}
          </span>
        </button>
        <button type="button" className="fin-fact fin-fact--button" onClick={openMenu('priority')} disabled={locked} aria-haspopup="menu">
          <span className="fin-fact__label">Priority</span>
          <span className="fin-fact__value">
            {task.priority ? (
              <>
                <PriorityFlag priority={task.priority} label={false} />
                {PRIORITY_LABEL[task.priority]}
              </>
            ) : (
              <span className="tsk-fact__none">None</span>
            )}
          </span>
        </button>

        <label className="fin-fact tsk-fact--input">
          <span className="fin-fact__label">Time block</span>
          <span className="fin-fact__value">
            <Clock size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              className="tsk-fact__input fin-num"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onBlur={commitTime}
              onKeyDown={onEnterBlur}
              placeholder="15:00"
              disabled={locked}
              aria-label="Time block start"
            />
            {task.scheduled && task.scheduled.slice(0, 10) !== (task.due ?? today) && (
              <span className="tsk-fact__hint">{dueWords(task.scheduled.slice(0, 10), today)}</span>
            )}
          </span>
        </label>
        <label className="fin-fact tsk-fact--input">
          <span className="fin-fact__label">Estimate</span>
          <span className="fin-fact__value">
            <Timer size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              className="tsk-fact__input fin-num"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={commitEstimate}
              onKeyDown={onEnterBlur}
              placeholder="30m"
              disabled={locked}
              aria-label="Estimate"
            />
          </span>
        </label>
        <label className="fin-fact tsk-fact--input">
          <span className="fin-fact__label">Tags</span>
          <span className="fin-fact__value">
            <Hash size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              className="tsk-fact__input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={commitTags}
              onKeyDown={onEnterBlur}
              placeholder="#home"
              disabled={locked}
              aria-label="Tags"
            />
          </span>
        </label>
      </div>

      <section className="fin-detail__section tsk-notes-section">
        <div className="fin-field__label">
          <span>Notes</span>
          {task.checklist.total > 0 && (
            <span className="tsk-notes__progress fin-num">
              {task.checklist.done}/{task.checklist.total} subtasks
            </span>
          )}
          {!editing && !locked && (
            <button
              type="button"
              className="fin-link"
              onClick={() => {
                setDraft(task.body);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <div
            className="tsk-notes__edit"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveNotes();
              }
            }}
          >
            <Editor
              value={draft}
              revision={0}
              onChange={setDraft}
              mode="live"
              notes={() => index?.files.map((f) => f.path) ?? []}
              imageUrl={imageUrl}
              onOpenLink={openLink}
              onImage={attach}
              autoFocus
              placeholder="Write notes. - [ ] makes a subtask, [[ links a note."
              className="tsk-notes__cm"
            />
            <div className="tsk-notes__actions">
              <span className="fin-hint">Formatting and links are supported. Ctrl ↵ saves.</span>
              <button
                type="button"
                className="fin-pill fin-pill--sm"
                onClick={() => {
                  setDraft(task.body);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button type="button" className="fin-pill fin-pill--sm tsk-notes__save" onClick={saveNotes}>
                Save notes
              </button>
            </div>
          </div>
        ) : task.body.trim() ? (
          <Reader
            text={task.body}
            showProperties={false}
            onToggleTask={locked ? undefined : (line) => set({ body: toggleChecklist(task.body, line) })}
            onOpenLink={openLink}
            imageUrl={imageUrl}
            className="tsk-notes"
          />
        ) : (
          <p className="fin-hint">No notes yet.</p>
        )}
        {!editing && !locked && (
          <div className="tsk-subtask">
            <input
              className="fin-input fin-input--sm"
              value={subtask}
              onChange={(e) => setSubtask(e.target.value)}
              placeholder="Add a subtask"
              aria-label="Add a subtask"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && subtask.trim()) {
                  e.preventDefault();
                  set({ body: addChecklist(task.body, subtask) });
                  setSubtask('');
                }
              }}
            />
          </div>
        )}
        {!editing && !locked && task.checklist.total > 0 && task.checklist.done === task.checklist.total && !done && (
          <p className="fin-hint">
            Every subtask is ticked.{' '}
            <button type="button" className="fin-link" onClick={() => set({ state: 'done' }, `Done: ${task.title}`)}>
              Finish the task
            </button>
          </p>
        )}
      </section>

      <Stamps task={task} today={today} />

      {menu && (
        <Menu
          label={menu.kind === 'project' ? 'Project' : 'Priority'}
          trigger={menu.trigger}
          placement={{ over: menu.rect, selectedId: menu.kind === 'project' ? `p:${task.project}` : task.priority ? `pr:${task.priority}` : 'pr:none' }}
          minWidth={Math.round(menu.rect.width)}
          onClose={() => setMenu(null)}
          entries={menuEntries()}
        />
      )}
      {calendar && (
        <CalendarPopover
          anchor={calendar.rect}
          trigger={calendar.trigger}
          value={task.due}
          clearable
          label="Due"
          onPick={(iso) => {
            if ((iso ?? null) === (task.due ?? null)) return;
            // A time block moves with its day when the due day changes.
            const patch: TaskPatch = { due: iso ?? null };
            if (iso && task.scheduled && task.scheduled.slice(0, 10) === task.due) patch.scheduled = `${iso}T${task.scheduled.slice(11)}`;
            set(patch);
          }}
          onClose={() => setCalendar(null)}
        />
      )}

      {extra && <div className="nx-extra">{extra}</div>}

      <SheetFooter>
        {confirmTrash ? (
          <span className="fin-confirm">
            Move to the trash?
            <button
              type="button"
              className="fin-link fin-link--danger"
              onClick={() => {
                const title = task.title;
                void trash(task.id).then((change) => {
                  if (change !== null) toast(`Moved ${title} to the trash`, { description: 'Tasks/.trash keeps it', action: { label: 'Undo', onClick: () => undo(change) } });
                });
                onClose();
              }}
            >
              Move
            </button>
            <button type="button" className="fin-link" onClick={() => setConfirmTrash(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="fin-link fin-link--danger" onClick={() => setConfirmTrash(true)} disabled={locked}>
            Delete
          </button>
        )}
        <span className="fin-spacer" />
        {/* The new shell leaves this one out: the panel's own ✕ and Escape already close it. */}
        <button type="button" className="fin-pill tsk-sheet__close" onClick={(e) => requestClose(e.currentTarget)}>
          Close
        </button>
        <button
          type="button"
          className="fin-pill fin-pill--action"
          disabled={locked}
          onClick={() => {
            set({ state: done ? 'todo' : 'done' }, done ? undefined : `Done: ${task.title}`);
            if (!done) onClose();
          }}
        >
          {done ? 'Reopen' : 'Mark done'}
        </button>
      </SheetFooter>
    </div>
  );
}

function Stamps({ task, today }: { task: Task; today: string }) {
  const at = (stamp?: string) => (stamp ? `${dueWords(stamp.slice(0, 10), today)} ${stamp.slice(11, 16)}` : null);
  const parts = [
    at(task.created) && `Created ${at(task.created)}`,
    at(task.started) && `started ${at(task.started)}`,
    at(task.done) && task.state === 'done' && `done ${at(task.done)}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="tsk-stamps">{parts.join(' · ')}</p>;
}
