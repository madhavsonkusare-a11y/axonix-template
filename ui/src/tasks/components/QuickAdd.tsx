/**
 * The add field in the top bar: one line, one keystroke.
 *
 * `Renew bike insurance fri 3pm #personal !2 30m` + Enter. While typing, a
 * panel under the field shows how the line was read — title, project, due
 * day, time, estimate, priority, tags — so nothing is saved on a guess. The
 * field keeps focus after adding, for the next one. `Ctrl+N` focuses it from
 * anywhere in Tasks; Escape clears it, then leaves it.
 *
 * The expand button (or Shift+Enter) carries the line into the full composer,
 * already read into chips, for a task that needs notes or more care.
 */
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock, CornerDownLeft, Flag, FolderPlus, Hash, Maximize2, Plus, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { useTasks } from '../TasksContext';
import { parseQuick, type QuickToken } from '../quickadd';
import { projectLabel } from '../derive';
import { ProjectDot } from './bits';
import type { ComposerSeed } from './Composer';

export interface QuickAddHandle {
  focus: () => void;
}

const TOKEN_ICON: Record<QuickToken['kind'], typeof Plus> = {
  project: FolderPlus,
  tag: Hash,
  priority: Flag,
  date: CalendarDays,
  time: Clock,
  estimate: Timer,
};

export const QuickAdd = forwardRef<QuickAddHandle, { project?: string; onExpand: (seed: Omit<ComposerSeed, 'n'>) => void }>(function QuickAdd({ project, onExpand }, ref) {
  const { create, projects, undo } = useTasks();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [nudge, setNudge] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const parsed = useMemo(() => parseQuick(text, projects), [text, projects]);
  const target = parsed.project ?? project ?? '';

  const add = async () => {
    if (!parsed.title) {
      setNudge(true);
      window.setTimeout(() => setNudge(false), 400);
      return;
    }
    const typed = text;
    setText('');
    const change = await create({
      title: parsed.title,
      project: target,
      priority: parsed.priority,
      due: parsed.due,
      scheduled: parsed.scheduled,
      estimate: parsed.estimate,
      tags: parsed.tags,
    });
    if (change === null) {
      setText(typed);
      return;
    }
    toast(`Added ${parsed.title}`, {
      description: `To do · ${projectLabel(target)}`,
      action: { label: 'Undo', onClick: () => undo(change) },
    });
  };

  const expand = () => {
    onExpand({
      title: parsed.title,
      project: target,
      priority: parsed.priority,
      due: parsed.due,
      scheduled: parsed.scheduled,
      estimate: parsed.estimate,
      tags: parsed.tags,
    });
    setText('');
  };

  const open = focused && text.trim().length > 0;

  return (
    <div className="tsk-quick" data-focused={focused || undefined} data-nudge={nudge || undefined}>
      <span className="tsk-quick__plus" aria-hidden="true">
        <Plus size={13} strokeWidth={2.4} />
      </span>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            expand();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void add();
          }
          if (e.key === 'Escape') {
            // Handled here, so Escape does not also leave Tasks.
            e.preventDefault();
            if (text) setText('');
            else input.current?.blur();
          }
        }}
        placeholder={project !== undefined ? `Add a task to ${projectLabel(project)}` : 'Add a task — fri 3pm #project !2 30m'}
        aria-label="Add a task"
        aria-describedby="tsk-quick-reading"
        spellCheck={false}
        autoComplete="off"
      />
      {text ? (
        <button type="button" className="fin-pill fin-pill--action tsk-quick__add" onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}>
          Add
          <CornerDownLeft size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : (
        <span className="fin-key tsk-quick__key" aria-hidden="true">
          Ctrl N
        </span>
      )}
      <button
        type="button"
        className="fin-icon-btn fin-icon-btn--sm tsk-quick__expand"
        onMouseDown={(e) => e.preventDefault()}
        onClick={expand}
        aria-label="Open the full composer"
        title="Full composer (Shift ↵)"
      >
        <Maximize2 size={13} strokeWidth={2} />
      </button>

      {open && (
        <div className="tsk-quick__panel" id="tsk-quick-reading" role="status" aria-live="polite">
          <div className="tsk-quick__title">
            {parsed.title ? parsed.title : <span className="tsk-quick__missing">Type a title</span>}
          </div>
          <div className="tsk-quick__tokens">
            <span className="tsk-token" data-kind="where">
              <ProjectDot name={target} />
              {parsed.newProject ? `New project “${target}”` : projectLabel(target)}
            </span>
            {parsed.tokens
              .filter((t) => t.kind !== 'project')
              .map((t, i) => {
                const Icon = TOKEN_ICON[t.kind];
                return (
                  <span key={i} className="tsk-token" data-kind={t.kind} data-p={t.kind === 'priority' ? parsed.priority : undefined}>
                    <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
                    <span className={t.kind === 'time' || t.kind === 'estimate' ? 'fin-num' : undefined}>{t.label}</span>
                  </span>
                );
              })}
          </div>
          <div className="tsk-quick__help" aria-hidden="true">
            <span><b>#</b>project or tag</span>
            <span><b>+</b>new project</span>
            <span><b>!1–4</b>priority</span>
            <span><b>30m</b>estimate</span>
            <span><b>fri 3pm</b>due, time</span>
            <span><b>Shift ↵</b>full composer</span>
          </div>
        </div>
      )}
    </div>
  );
});
