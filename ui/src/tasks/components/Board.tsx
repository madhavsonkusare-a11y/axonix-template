/**
 * The kanban board.
 *
 * Five columns — Backlog, To do, Doing, Blocked, Done — optionally split into
 * swimlanes by project or priority. Cards drag between columns and lanes with
 * dnd-kit (pointer or keyboard: Space to lift, arrows to move, Space to drop);
 * a drop writes the new state, lane and position to that one file.
 *
 * Motion: a dragged card lifts (scale, tilt, shadow) and the others make room
 * on dnd-kit's transforms. Outside a drag, cards glide to their new place with
 * motion's shared layout (a finished task travels to Done), and a new one
 * drops in at the top of its column. Layout animation is off during a drag and
 * just after it, so the two never fight over the same transform.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  defaultDropAnimationSideEffects,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LayoutGroup, motion } from 'motion/react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTasks } from '../TasksContext';
import { EMPTY_COLUMN, projectLabel, recentlyDone } from '../derive';
import { parseQuick } from '../quickadd';
import { PRIORITY_LABEL, STATES, type Priority, type Task, type TaskPatch, type TaskState } from '../types';
import { liftAttrs, taskThing } from '../../next/lift/things';
import Count from '../../next/motion/Count';
import { TaskCard } from './TaskCard';
import { PriorityFlag, ProjectDot, StateGlyph } from './bits';

export type Grouping = 'none' | 'project' | 'priority';

interface Lane {
  key: string;
  label: string;
  project?: string;
  priority?: Priority | null;
}

const SEP = '::';
const containerId = (lane: string, state: TaskState) => `${lane}${SEP}${state}`;
const parseContainer = (id: string) => {
  const i = id.lastIndexOf(SEP);
  return { lane: id.slice(0, i), state: id.slice(i + SEP.length) as TaskState };
};
const containerFor = (id: UniqueIdentifier, columns: Record<string, string[]>) => {
  const key = String(id);
  if (key in columns) return key;
  return Object.keys(columns).find((column) => columns[column].includes(key));
};

const DROP: DropAnimation = {
  duration: 240,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
};

export interface BoardProps {
  tasks: Task[];
  grouping: Grouping;
  showProject: boolean;
  today: string;
  /** New tasks from a column's add field land here unless they name a project. */
  project?: string;
  /** The new shell's cards: fewer facts on each (see `TaskCard`). */
  lean?: boolean;
  /** Stands at the foot of Done, after "Show N older" (the new shell: delete finished tasks). */
  doneFoot?: React.ReactNode;
  onOpen: (id: string) => void;
}

export default function Board({ tasks, grouping, showProject, today, project, lean, doneFoot, onOpen }: BoardProps) {
  const { updateMany, update, create, projects, undo } = useTasks();
  const [showOlder, setShowOlder] = useState(false);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  /* ---------- lanes and columns ---------- */

  const lanes = useMemo<Lane[]>(() => {
    if (grouping === 'project') {
      const names = [...new Set(tasks.map((t) => t.project))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
      return names.map((p) => ({ key: `project:${p}`, label: projectLabel(p), project: p }));
    }
    if (grouping === 'priority') {
      const ps = [...new Set(tasks.map((t) => t.priority ?? 0))].sort((a, b) => (a || 9) - (b || 9));
      return ps.map((p) => ({ key: `priority:${p}`, label: p ? PRIORITY_LABEL[p as Priority] : 'No priority', priority: p ? (p as Priority) : null }));
    }
    return [{ key: 'all', label: '' }];
  }, [grouping, tasks]);

  const olderDone = useMemo(() => tasks.filter((t) => t.state === 'done' && !recentlyDone(t, today)).length, [tasks, today]);

  const derived = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const lane of lanes) {
      for (const s of STATES) {
        out[containerId(lane.key, s.id)] = tasks
          .filter((t) => t.state === s.id)
          .filter((t) => (lane.project !== undefined ? t.project === lane.project : true))
          .filter((t) => (lane.priority !== undefined ? (t.priority ?? null) === lane.priority : true))
          .filter((t) => s.id !== 'done' || showOlder || recentlyDone(t, today))
          .map((t) => t.id);
      }
    }
    return out;
  }, [lanes, tasks, showOlder, today]);

  /* ---------- dragging ---------- */

  const [activeId, setActiveId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, string[]> | null>(null);
  const columns = items ?? derived;
  // Shared layout animation is paused during a drag and briefly after it.
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<number | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const movedContainer = useRef(false);
  const lastMotion = useRef({ x: 0, y: 0, at: 0 });
  const [gesture, setGesture] = useState({ tilt: 0, stretch: 1 });

  useEffect(() => {
    requestAnimationFrame(() => {
      movedContainer.current = false;
    });
  }, [items]);
  useEffect(() => () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback(
    (id: UniqueIdentifier) => containerFor(id, columns),
    [columns],
  );

  // After dnd-kit's multiple-containers example: the pointer's container,
  // then the closest card inside it.
  const collision: CollisionDetection = useCallback(
    (args) => {
      const pointer = pointerWithin(args);
      const hits = pointer.length ? pointer : rectIntersection(args);
      let overId = getFirstCollision(hits, 'id');
      if (overId != null) {
        const key = String(overId);
        if (key in columns && columns[key].length) {
          const inside = columns[key];
          overId =
            closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== overId && inside.includes(String(c.id))) })[0]?.id ??
            overId;
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      if (movedContainer.current) lastOverId.current = activeId;
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [activeId, columns],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    setSettling(true);
    setActiveId(String(active.id));
    setOrigin(findContainer(active.id) ?? null);
    setItems(derived);
    lastMotion.current = { x: 0, y: 0, at: performance.now() };
    setGesture({ tilt: 0, stretch: 1 });
  };

  const onDragMove = ({ delta }: DragMoveEvent) => {
    const now = performance.now();
    const last = lastMotion.current;
    const dt = Math.max(8, now - last.at);
    const vx = ((delta.x - last.x) / dt) * 1000;
    const vy = ((delta.y - last.y) / dt) * 1000;
    const speed = Math.min(1, Math.hypot(vx, vy) / 1500);
    lastMotion.current = { x: delta.x, y: delta.y, at: now };
    setGesture({ tilt: Math.max(-5, Math.min(5, vx / 260)), stretch: 1 + speed * 0.025 });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const overId = over?.id;
    if (overId == null) return;
    setItems((cur) => {
      if (!cur) return cur;
      // Drag-over can fire several times before React paints. Resolve both
      // containers from this exact state snapshot, not the previous render,
      // otherwise the active id can be appended to the target repeatedly.
      const to = containerFor(overId, cur);
      const from = containerFor(active.id, cur);
      if (!to || !from || to === from) return cur;
      const activeKey = String(active.id);
      const overItems = cur[to].filter((id) => id !== activeKey);
      const overIndex = overItems.indexOf(String(overId));
      let index: number;
      if (String(overId) in cur) index = overItems.length;
      else {
        const below = over && active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : overItems.length;
      }
      movedContainer.current = true;
      return {
        ...cur,
        [from]: cur[from].filter((id) => id !== activeKey),
        [to]: [...overItems.slice(0, index), activeKey, ...overItems.slice(index)],
      };
    });
  };

  const finish = () => {
    setActiveId(null);
    setOrigin(null);
    setItems(null);
    setGesture({ tilt: 0, stretch: 1 });
    settleTimer.current = window.setTimeout(() => setSettling(false), 320);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const task = byId.get(id);
    const from = findContainer(id);
    if (!items || !task || !from || over == null) return finish();
    const to = findContainer(over.id) ?? from;
    let list = items[to];
    if (from === to) {
      const a = list.indexOf(id);
      const b = String(over.id) in items ? list.length - 1 : list.indexOf(String(over.id));
      if (a >= 0 && b >= 0 && a !== b) list = arrayMove(list, a, b);
    }
    commitDrop(task, to, list);
    finish();
  };

  /** State, lane and position for the dropped card; renumbers the column when positions ran out. */
  const commitDrop = (task: Task, container: string, list: string[]) => {
    const { lane, state } = parseContainer(container);
    const laneInfo = lanes.find((l) => l.key === lane);
    const patch: TaskPatch = {};
    if (state !== task.state) patch.state = state;
    if (laneInfo?.project !== undefined && laneInfo.project !== task.project) patch.project = laneInfo.project;
    if (laneInfo?.priority !== undefined && (task.priority ?? null) !== laneInfo.priority) patch.priority = laneInfo.priority;

    const index = list.indexOf(task.id);
    const prev = index > 0 ? byId.get(list[index - 1]) : undefined;
    const next = index >= 0 && index < list.length - 1 ? byId.get(list[index + 1]) : undefined;
    const changes: { id: string; patch: TaskPatch }[] = [];
    const room = (prev?.order ?? -Infinity) < (next?.order ?? Infinity) && !(prev && next && next.order! - prev.order! < 0.002);
    if ((prev && prev.order === undefined) || (next && next.order === undefined) || !room) {
      // Positions ran out, or the neighbours never had one: number the column.
      list.forEach((tid, k) => {
        const t = byId.get(tid);
        if (!t) return;
        const order = (k + 1) * 1024;
        if (tid === task.id) changes.push({ id: tid, patch: { ...patch, order } });
        else if (t.order !== order) changes.push({ id: tid, patch: { order } });
      });
    } else {
      const order = prev && next ? (prev.order! + next.order!) / 2 : prev ? prev.order! + 1024 : next ? next.order! - 1024 : 0;
      if (order !== task.order || Object.keys(patch).length) changes.push({ id: task.id, patch: { ...patch, order } });
    }
    if (!changes.length) return;
    void updateMany(changes).then((change) => {
      if (change !== null && patch.state === 'done') {
        toast(`Done: ${task.title}`, { action: { label: 'Undo', onClick: () => undo(change) } });
      }
    });
  };

  const toggleDone = useCallback(
    (task: Task) => {
      const reopening = task.state === 'done';
      void update(task.id, { state: reopening ? 'todo' : 'done' }).then((change) => {
        if (change !== null && !reopening) toast(`Done: ${task.title}`, { action: { label: 'Undo', onClick: () => undo(change) } });
      });
    },
    [update, undo],
  );

  const addTo = useCallback(
    async (lane: Lane, state: TaskState, text: string) => {
      const p = parseQuick(text, projects);
      if (!p.title) return false;
      const change = await create({
        title: p.title,
        state,
        project: p.project ?? lane.project ?? project ?? '',
        priority: p.priority ?? lane.priority ?? undefined,
        due: p.due,
        scheduled: p.scheduled,
        estimate: p.estimate,
        tags: p.tags,
      });
      return change !== null;
    },
    [create, project, projects],
  );

  /* ---------- entrance tracking ---------- */

  // Cards animate in only when they are new since the board mounted — not on
  // first paint (navigation is not animated), and not when they merely moved.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const t of tasks) if (!seen.current.has(t.id)) fresh.add(t.id);
  useEffect(() => {
    seen.current = new Set(tasks.map((t) => t.id));
  }, [tasks]);

  const active = activeId ? byId.get(activeId) : undefined;
  const cardProps = { today, showProject: showProject && grouping !== 'project', lean, onOpen, onToggleDone: toggleDone };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <LayoutGroup>
        <div className="tsk-lanes">
          {lanes.map((lane) => (
            <section key={lane.key} className="tsk-lane" data-grouped={grouping !== 'none' || undefined}>
              {grouping !== 'none' && (
                <header className="tsk-lane__head">
                  {lane.project !== undefined && <ProjectDot name={lane.project} />}
                  {lane.priority ? <PriorityFlag priority={lane.priority} label={false} /> : null}
                  <span>{lane.label}</span>
                  <span className="tsk-lane__count fin-num">{tasks.filter((t) => (lane.project !== undefined ? t.project === lane.project : (t.priority ?? null) === lane.priority) && t.state !== 'done').length}</span>
                </header>
              )}
              <div className="tsk-columns">
                {STATES.map((s) => (
                  <Column
                    key={s.id}
                    id={containerId(lane.key, s.id)}
                    state={s.id}
                    label={s.label}
                    ids={columns[containerId(lane.key, s.id)] ?? []}
                    byId={byId}
                    fresh={fresh}
                    layoutOn={!settling}
                    cardProps={cardProps}
                    incoming={activeId !== null && origin !== containerId(lane.key, s.id) && (columns[containerId(lane.key, s.id)] ?? []).includes(activeId)}
                    onAdd={(text) => addTo(lane, s.id, text)}
                    foot={
                      s.id === 'done' && lane === lanes[lanes.length - 1] && (olderDone > 0 || doneFoot) ? (
                        <>
                          {olderDone > 0 && (
                            <button type="button" className="tsk-col__older" onClick={() => setShowOlder((v) => !v)}>
                              {showOlder ? 'Show the last week only' : `Show ${olderDone} older`}
                            </button>
                          )}
                          {doneFoot}
                        </>
                      ) : null
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </LayoutGroup>
      <DragOverlay dropAnimation={DROP}>
        {active ? <TaskCard task={active} lifted lean={lean} today={today} showProject={cardProps.showProject} style={{ transform: `rotate(${gesture.tilt}deg) scale(${gesture.stretch})` }} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ------------------------------------------------------------------ */
/* a column                                                            */
/* ------------------------------------------------------------------ */

interface CardProps {
  today: string;
  showProject: boolean;
  lean?: boolean;
  onOpen: (id: string) => void;
  onToggleDone: (task: Task) => void;
}

function Column({
  id,
  state,
  label,
  ids,
  byId,
  fresh,
  layoutOn,
  cardProps,
  incoming,
  onAdd,
  foot,
}: {
  id: string;
  state: TaskState;
  label: string;
  ids: string[];
  byId: Map<string, Task>;
  fresh: Set<string>;
  layoutOn: boolean;
  cardProps: CardProps;
  /** The dragged card has moved into this column from another. */
  incoming: boolean;
  onAdd: (text: string) => Promise<boolean>;
  foot: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [adding, setAdding] = useState(false);
  const over = isOver || incoming;
  const open = ids.filter((i) => byId.get(i)?.state !== 'done').length;

  return (
    <div className="tsk-col" data-state={state} data-over={over || undefined}>
      <header className="tsk-col__head">
        <StateGlyph state={state} />
        <span className="tsk-col__label">{label}</span>
        {/* On the new shell's board the count rolls when a card arrives or leaves. */}
        {cardProps.lean ? <Count className="tsk-col__count fin-num" value={state === 'done' ? ids.length : open} /> : <span className="tsk-col__count fin-num">{state === 'done' ? ids.length : open}</span>}
        <button type="button" className="fin-icon-btn fin-icon-btn--sm tsk-col__plus" onClick={() => setAdding(true)} aria-label={`Add a task to ${label}`} title={`Add to ${label}`}>
          <Plus size={13} strokeWidth={2} />
        </button>
      </header>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="tsk-col__list">
          {ids.map((tid) => {
            const t = byId.get(tid);
            return t ? <SortableCard key={tid} task={t} fresh={fresh.has(tid)} layoutOn={layoutOn} {...cardProps} /> : null;
          })}
          {!ids.length && !adding && <p className="tsk-col__empty">{EMPTY_COLUMN[state]}</p>}
        </div>
      </SortableContext>
      {adding ? <ColumnAdd label={label} onAdd={onAdd} onClose={() => setAdding(false)} /> : null}
      {foot}
    </div>
  );
}

const SortableCard = memo(function SortableCard({
  task,
  fresh,
  layoutOn,
  today,
  showProject,
  lean,
  onOpen,
  onToggleDone,
}: CardProps & { task: Task; fresh: boolean; layoutOn: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <motion.div
      className="tsk-slot"
      layout={layoutOn ? 'position' : false}
      layoutId={layoutOn ? `task-${task.id}` : undefined}
      initial={fresh ? { opacity: 0, y: -10, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
    >
      <TaskCard
        ref={setNodeRef}
        task={task}
        today={today}
        showProject={showProject}
        lean={lean}
        placeholder={isDragging}
        onToggleDone={() => onToggleDone(task)}
        style={{ transform: CSS.Translate.toString(transform), transition }}
        {...attributes}
        {...listeners}
        // Held still, the card is lifted off the board (next/lift); moved, it is the board's own drag.
        {...liftAttrs(taskThing(task), { hold: true })}
        aria-roledescription="task"
        aria-label={task.title}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onOpen(task.id);
            return;
          }
          listeners?.onKeyDown?.(e);
        }}
      />
    </motion.div>
  );
});

function ColumnAdd({ label, onAdd, onClose }: { label: string; onAdd: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="tsk-col__add">
      <input
        ref={input}
        className="fin-input fin-input--sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Title, fri 3pm, !2, 30m"
        aria-label={`New task in ${label}`}
        spellCheck={false}
        onKeyDown={async (e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault();
            const typed = text;
            setText('');
            if (!(await onAdd(typed))) setText(typed);
          }
        }}
        onBlur={() => !text.trim() && onClose()}
      />
    </div>
  );
}
