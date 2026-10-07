import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import {
  BookOpen,
  Boxes,
  Columns3,
  LayoutDashboard,
  PiggyBank,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  Camera,
  ChartNoAxesColumn,
  Check,
  CircleDollarSign,
  Code2,
  Compass,
  Cpu,
  Database,
  Dumbbell,
  FileText,
  Film,
  FlaskConical,
  FolderKanban,
  Gamepad2,
  GitBranch,
  Globe2,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Leaf,
  Lightbulb,
  Link2,
  ListChecks,
  Map as MapIcon,
  Microscope,
  Music,
  Palette,
  Pencil,
  Plane,
  Plus,
  Presentation,
  Rocket,
  ShoppingBag,
  Sparkles,
  Star,
  Target,
  Telescope,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { projectLabel } from '../derive';
import type { Task } from '../types';
import { ProjectDot } from './bits';
import { useNotes } from '../../notes/NotesContext';
import { KIND_LABEL } from '../../notes/notefile';
import localStoreMark from '../../assets/brands/local-store.svg';
import { CalendarPopover } from '../../finance/components/DatePicker';
import { useTasks } from '../TasksContext';
import Dashboard, { PROJECT_WIDGETS, WIDGETS, type WidgetId } from './Dashboard';
import Scholarships from '../masters/Scholarships';
import Discover from '../masters/Discover';
import Compare from '../masters/Compare';
import { Menu, type MenuEntry } from '../../finance/components/Menu';
import { todayIso } from '../derive';

type View = 'tasks' | 'dashboard' | 'board' | 'timeline' | 'discover' | 'compare' | 'scholarships' | 'library' | 'moodboard';
const META_KEY = 'axonix:project-workspaces';
interface Meta {
  goal: string;
  overview: string;
  start?: string;
  target?: string;
  /** A project intentionally has no target date; its timeline flows into activity instead. */
  openEnded?: boolean;
  icon?: string;
  /** The widgets this project's dashboard holds, in order. Empty by default. */
  dashboard?: WidgetId[];
  /** Retained silently so removing templates never erases an existing preference. */
  template?: unknown;
}

function load(project: string): Meta {
  try {
    const all = JSON.parse(localStorage.getItem(META_KEY) || '{}') as Record<string, Partial<Meta>>;
    const raw = all[project] ?? {};
    return {
      ...raw,
      goal: typeof raw.goal === 'string' ? raw.goal : '',
      overview: typeof raw.overview === 'string' ? raw.overview : '',
    };
  } catch {
    return { goal: '', overview: '' };
  }
}

function keep(project: string, meta: Meta) {
  try {
    const all = JSON.parse(localStorage.getItem(META_KEY) || '{}') as Record<string, Meta>;
    localStorage.setItem(META_KEY, JSON.stringify({ ...all, [project]: meta }));
    window.dispatchEvent(new CustomEvent('axonix:project-meta', { detail: project }));
  } catch {
    /* Workspace preferences only. */
  }
}

export function projectIcon(project: string): string | undefined {
  return load(project).icon;
}

/** What done looks like, as the owner wrote it on the project's page. Empty until they have. */
export function projectGoal(project: string): string {
  return load(project).goal;
}

function moveMeta(from: string, to: string) {
  try {
    const all = JSON.parse(localStorage.getItem(META_KEY) || '{}') as Record<string, Meta>;
    if (all[from]) {
      all[to] = all[from];
      delete all[from];
      localStorage.setItem(META_KEY, JSON.stringify(all));
    }
    window.dispatchEvent(new CustomEvent('axonix:project-meta', { detail: to }));
  } catch {
    /* Workspace preferences only. */
  }
}

const prettyDate = (iso?: string) =>
  iso
    ? new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00`))
    : 'Set date';

const ICONS: Record<string, LucideIcon> = {
  activity: ChartNoAxesColumn,
  briefcase: BriefcaseBusiness,
  calendar: CalendarDays,
  camera: Camera,
  compass: Compass,
  code: Code2,
  computer: Cpu,
  database: Database,
  fitness: Dumbbell,
  film: Film,
  folder: FolderKanban,
  game: Gamepad2,
  globe: Globe2,
  health: HeartPulse,
  home: House,
  idea: Lightbulb,
  landmark: Landmark,
  leaf: Leaf,
  map: MapIcon,
  microscope: Microscope,
  money: CircleDollarSign,
  music: Music,
  plane: Plane,
  presentation: Presentation,
  rocket: Rocket,
  research: FlaskConical,
  shopping: ShoppingBag,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  telescope: Telescope,
  thesis: GraduationCap,
  build: Wrench,
  design: Palette,
  zap: Zap,
};
/**
 * Product marks: a project that is a piece of software can wear its own icon.
 * Shipped in `assets/brands/`, never hot-linked, like the finance marks. A
 * project whose name is the product's gets its mark without anyone picking it.
 */
const MARKS: { id: string; label: string; src: string; match: RegExp }[] = [
  { id: 'local-store', label: 'Local Store', src: localStoreMark, match: /^(project\s+)?local[\s-]?store$/i },
];
const markSrc = (id: string) => MARKS.find((m) => m.id === id)?.src;
/** The mark a project wears when nobody has chosen an icon for it. */
const markFor = (project: string) => MARKS.find((m) => m.match.test(project.trim()))?.id;

const EMOJIS = [
  '🚀', '💻', '🧪', '🛠️', '🎓', '📐', '🧠', '🎨', '📚', '⚡', '🌱', '🎯',
  '✨', '🔥', '💡', '🔬', '🔭', '🧬', '🤖', '⚙️', '🔧', '🔨', '🧰', '🏗️',
  '📊', '📈', '🗓️', '✅', '📝', '📎', '🗂️', '📦', '🔖', '💼', '🏢', '🏠',
  '🌍', '🗺️', '✈️', '🚗', '🚲', '🎬', '🎵', '🎮', '📷', '🛍️', '💰', '💳',
  '❤️', '🩺', '💪', '🏃', '🧘', '☕', '🍽️', '🌿', '☀️', '🌙', '⭐', '💎',
  '🏆', '👑', '🦾', '🛰️', '🧭', '🧩', '🔐', '📱', '🖥️', '⌨️', '🖊️', '📕',
];

export function ProjectMark({ value, project, size = 18 }: { value?: string; project: string; size?: number }) {
  if (value?.startsWith('emoji:')) return <span className="prj-mark__emoji">{value.slice(6)}</span>;
  if (value?.startsWith('icon:')) {
    const Icon = ICONS[value.slice(5)];
    if (Icon) return <Icon size={size} strokeWidth={1.9} />;
  }
  const mark = value?.startsWith('mark:') ? markSrc(value.slice(5)) : value === undefined ? markSrc(markFor(project) ?? '') : undefined;
  if (mark) return <img className="prj-mark__img" src={mark} width={size + 3} height={size + 3} alt="" draggable={false} />;
  return <ProjectDot name={project} />;
}

function ProjectIconPicker({ value, project, onChange }: { value?: string; project: string; onChange: (value: string | undefined) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (!anchor) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && (panel.current?.contains(event.target) || trigger.current?.contains(event.target))) return;
      setAnchor(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAnchor(null);
        trigger.current?.focus({ preventScroll: true });
      }
    };
    const resize = () => setAnchor(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', resize);
    };
  }, [anchor]);

  const choose = (next?: string) => {
    onChange(next);
    setAnchor(null);
    trigger.current?.focus({ preventScroll: true });
  };
  const position = anchor
    ? { left: Math.max(8, Math.min(anchor.left, innerWidth - 358)), top: Math.max(8, Math.min(anchor.bottom + 8, innerHeight - 452)) }
    : undefined;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="prj-mark"
        aria-label={value ? 'Change project icon' : 'Add project icon'}
        aria-expanded={Boolean(anchor)}
        onClick={() => setAnchor(anchor ? null : trigger.current?.getBoundingClientRect() ?? null)}
      >
        <ProjectMark value={value} project={project} />
      </button>
      {anchor && createPortal(
        <div ref={panel} className="prj-icon-picker" role="dialog" aria-label="Choose project icon" style={position}>
          <div className="prj-icon-picker__head"><strong>Project icon</strong>{value && <button type="button" onClick={() => choose()}>Remove</button>}</div>
          <span className="prj-icon-picker__label">Emoji</span>
          <div className="prj-icon-picker__grid">
            {EMOJIS.map((emoji) => <button type="button" key={emoji} aria-label={`Use ${emoji}`} data-active={value === `emoji:${emoji}` || undefined} onClick={() => choose(`emoji:${emoji}`)}>{emoji}</button>)}
          </div>
          <span className="prj-icon-picker__label">Product</span>
          <div className="prj-icon-picker__grid">
            {MARKS.map((m) => (
              <button type="button" key={m.id} aria-label={`Use the ${m.label} icon`} title={m.label} data-active={value === `mark:${m.id}` || (value === undefined && markFor(project) === m.id) || undefined} onClick={() => choose(`mark:${m.id}`)}>
                <img className="prj-mark__img" src={m.src} width={20} height={20} alt="" draggable={false} />
              </button>
            ))}
          </div>
          <span className="prj-icon-picker__label">Icons</span>
          <div className="prj-icon-picker__grid">
            {Object.entries(ICONS).map(([id, Icon]) => <button type="button" key={id} aria-label={`Use ${id} icon`} data-active={value === `icon:${id}` || undefined} onClick={() => choose(`icon:${id}`)}><Icon size={18} /></button>)}
          </div>
          <form className="prj-icon-picker__custom" onSubmit={(event) => { event.preventDefault(); const emoji = custom.trim(); if (emoji) choose(`emoji:${emoji}`); }}>
            <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Paste any emoji" aria-label="Custom emoji" />
            <button type="submit" disabled={!custom.trim()}>Use</button>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function ProjectActivity({ tasks }: { tasks: Task[] }) {
  const days = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const touched: [string | undefined, number][] = [
        [task.created?.slice(0, 10), 1],
        [task.scheduled?.slice(0, 10), 1],
        [task.done?.slice(0, 10), 2],
      ];
      touched.forEach(([day, weight]) => {
        if (day) counts.set(day, (counts.get(day) ?? 0) + weight);
      });
    }
    const now = new Date();
    return Array.from({ length: 140 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 139 + index);
      const iso = localIso(date);
      const count = counts.get(iso) ?? 0;
      return { iso, count, level: Math.min(4, count) };
    });
  }, [tasks]);
  const today = localIso(new Date());
  return <div className="prj-activity" aria-label="Project activity over the last twenty weeks">{days.map((day) => <span key={day.iso} data-level={day.level} data-today={day.iso === today || undefined} title={`${prettyDate(day.iso)} · ${day.count || 'No'} activit${day.count === 1 ? 'y' : 'ies'}`} />)}</div>;
}

interface FlowGeometry {
  trackX: number;
  handleX: number;
  startY: number;
  endX: number;
  endY: number;
  endTop: number;
  endBottom: number;
}

/** The dot at the start of the track (`.prj-date-track::before`), in pixels. */
const START_DOT = 12;
/** How much of the run into Activity the flare may take: the rest is a straight line, so the turn is steep. */
const FLARE = 0.26;

/** The date range becomes an open-ended stream when its right node is pushed into Activity. */
function ProjectDateFlow({
  meta,
  bodyRef,
  activityRef,
  save,
  openCalendar,
}: {
  meta: Meta;
  bodyRef: RefObject<HTMLDivElement | null>;
  activityRef: RefObject<HTMLElement | null>;
  save: (patch: Partial<Meta>) => void;
  openCalendar: (field: 'start' | 'target', trigger: HTMLButtonElement) => void;
}) {
  const trackRef = useRef<HTMLElement>(null);
  const originHandle = useRef<HTMLButtonElement>(null);
  const dragStart = useRef({ x: 0, progress: 0, moved: false });
  const draggingRef = useRef(false);
  const settleFrame = useRef<number | null>(null);
  const latestProgress = useRef(meta.openEnded ? 1 : 0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [progress, setProgress] = useState(meta.openEnded ? 1 : 0);
  const [geometry, setGeometry] = useState<FlowGeometry | null>(null);

  useEffect(() => {
    if (!dragging && !settling) {
      const next = meta.openEnded ? 1 : 0;
      latestProgress.current = next;
      setProgress(next);
    }
  }, [dragging, meta.openEnded, settling]);

  useEffect(() => () => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
  }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const body = bodyRef.current?.getBoundingClientRect();
      const track = trackRef.current?.getBoundingClientRect();
      const activity = activityRef.current?.getBoundingClientRect();
      if (!body || !track || !activity) return;
      setGeometry({
        // Past the start dot, so the stream never draws a line through it.
        trackX: track.left - body.left + START_DOT + 1,
        handleX: track.right - body.left,
        startY: track.top + track.height / 2 - body.top,
        endX: activity.left - body.left + 2,
        endY: activity.top + activity.height * 0.56 - body.top,
        endTop: activity.top - body.top + 8,
        endBottom: activity.bottom - body.top - 8,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (bodyRef.current) observer.observe(bodyRef.current);
    if (trackRef.current) observer.observe(trackRef.current);
    if (activityRef.current) observer.observe(activityRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [activityRef, bodyRef, meta.openEnded, meta.target]);

  const settleTo = (target: number) => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    const from = latestProgress.current;
    const started = performance.now();
    setSettling(true);
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - started) / 260);
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      const next = from + (target - from) * eased;
      latestProgress.current = next;
      setProgress(next);
      if (elapsed < 1) settleFrame.current = requestAnimationFrame(tick);
      else {
        settleFrame.current = null;
        setSettling(false);
      }
    };
    settleFrame.current = requestAnimationFrame(tick);
  };

  const begin = (event: ReactPointerEvent<HTMLButtonElement>, from: number) => {
    event.preventDefault();
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = null;
    setSettling(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, progress: from, moved: false };
    latestProgress.current = from;
    draggingRef.current = true;
    setProgress(from);
    setDragging(true);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current || !geometry) return;
    const distance = Math.max(48, geometry.endX - geometry.handleX);
    const delta = event.clientX - dragStart.current.x;
    if (Math.abs(delta) > 3) dragStart.current.moved = true;
    const next = Math.max(0, Math.min(1, dragStart.current.progress + delta / distance));
    latestProgress.current = next;
    setProgress(next);
  };
  const finish = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const wasClickAtOpenEnd = !dragStart.current.moved && dragStart.current.progress === 1;
    const openEnded = wasClickAtOpenEnd ? false : latestProgress.current >= 0.55;
    draggingRef.current = false;
    setDragging(false);
    settleTo(openEnded ? 1 : 0);
    save({ openEnded });
  };
  const cancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggingRef.current = false;
    setDragging(false);
    const restored = meta.openEnded ? 1 : 0;
    latestProgress.current = restored;
    setProgress(restored);
  };

  const dx = geometry ? Math.max(1, geometry.endX - geometry.handleX) : 1;
  const c1 = geometry ? { x: geometry.handleX + dx * 0.52, y: geometry.startY } : { x: 0, y: 0 };
  const c2 = geometry ? { x: geometry.endX - dx * 0.2, y: geometry.endY } : { x: 0, y: 0 };
  const t = progress;
  const mt = 1 - t;
  const center = geometry
    ? {
        x: mt ** 3 * geometry.handleX + 3 * mt ** 2 * t * c1.x + 3 * mt * t ** 2 * c2.x + t ** 3 * geometry.endX,
        y: mt ** 3 * geometry.startY + 3 * mt ** 2 * t * c1.y + 3 * mt * t ** 2 * c2.y + t ** 3 * geometry.endY,
      }
    : null;
  const spread = t * t * (3 - 2 * t);
  const topY = geometry && center ? center.y + (geometry.endTop - geometry.endY) * spread : 0;
  const bottomY = geometry && center ? center.y + (geometry.endBottom - geometry.endY) * spread : 0;
  const curveDx = geometry && center ? Math.max(1, center.x - geometry.handleX) : 1;
  // Straight until the last stretch, then a short, steep turn into Activity.
  const turn = Math.min(curveDx, Math.max(18, curveDx * FLARE));
  const flareX = geometry && center ? center.x - turn : 0;
  const shape = geometry && center
    ? `M ${geometry.trackX} ${geometry.startY - 1.5} L ${flareX} ${geometry.startY - 1.5} C ${flareX + turn * 0.62} ${geometry.startY - 1.5}, ${center.x - turn * 0.05} ${topY}, ${center.x} ${topY} L ${center.x} ${bottomY} C ${center.x - turn * 0.05} ${bottomY}, ${flareX + turn * 0.62} ${geometry.startY + 1.5}, ${flareX} ${geometry.startY + 1.5} L ${geometry.trackX} ${geometry.startY + 1.5} Z`
    : '';
  const flowing = dragging || settling || Boolean(meta.openEnded);

  return <>
    <div className="prj-dates" data-flowing={flowing || undefined}>
      <button type="button" className="prj-date" onClick={(event) => openCalendar('start', event.currentTarget)}><span>{prettyDate(meta.start)}</span></button>
      <i ref={trackRef} className="prj-date-track">
        <b style={{ opacity: 1 - progress }} />
        <button
          ref={originHandle}
          type="button"
          className="prj-date-node prj-date-node--origin"
          aria-label="Drag toward Activity to make this project open-ended"
          aria-hidden={meta.openEnded || undefined}
          tabIndex={meta.openEnded ? -1 : undefined}
          title="Drag toward Activity for no target date"
          onPointerDown={(event) => begin(event, 0)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              settleTo(1);
              save({ openEnded: true });
            }
          }}
        />
      </i>
      <button
        type="button"
        className="prj-date prj-date--target"
        data-hidden={meta.openEnded || undefined}
        tabIndex={meta.openEnded ? -1 : undefined}
        aria-hidden={meta.openEnded || undefined}
        onClick={(event) => openCalendar('target', event.currentTarget)}
        style={dragging ? { opacity: 1 - progress, transform: `translate3d(${progress * 10}px, 0, 0)` } : undefined}
      ><span>{meta.openEnded ? 'Open-ended' : prettyDate(meta.target)}</span></button>
    </div>
    {geometry && flowing && <>
      <svg className="prj-date-flow" viewBox={`0 0 ${bodyRef.current?.clientWidth ?? 1} ${bodyRef.current?.clientHeight ?? 1}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="prj-date-flow-fill" x1="0" x2="1"><stop offset="0" stopColor="#8fd0ff" stopOpacity=".96" /><stop offset=".55" stopColor="#7cc4ff" stopOpacity=".72" /><stop offset="1" stopColor="#7cc4ff" stopOpacity=".3" /></linearGradient></defs>
        <path className="prj-date-flow__shape" d={shape} />
      </svg>
      <button
        type="button"
        className="prj-date-flow-handle"
        aria-label={meta.openEnded ? 'Open-ended project. Click or drag left to restore a target date.' : 'Open-ended date preview'}
        title={meta.openEnded ? 'Click or drag left to restore a target date' : undefined}
        style={{ height: `${Math.max(32, geometry.endBottom - geometry.endTop)}px`, transform: `translate3d(${geometry.endX - 12}px, ${geometry.endTop}px, 0)` }}
        onPointerDown={(event) => begin(event, progress)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
      />
    </>}
  </>;
}

/** What a timeline is given. The new shell draws its own (`next/tasks/Timeline.tsx`) through `timeline`. */
export interface TimelineProps {
  tasks: Task[];
  start?: string;
  target?: string;
  onOpen: (id: string) => void;
}

export default function ProjectWorkspace({
  project,
  tasks,
  board,
  list,
  onResearch,
  onOpenTask,
  onOpenNote,
  onRenamed,
  timeline,
}: {
  project: string;
  tasks: Task[];
  /** The project's board. The new shell leaves it out: there the board is Tasks, and a project lists its tasks. */
  board?: ReactNode;
  /** The project's tasks as a list (the new shell). It is the first view when given. */
  list?: ReactNode;
  /** Opens Research sources. Offered only on a project that looks things up (it has a profile or a programme). */
  onResearch?: () => void;
  onOpenTask: (id: string) => void;
  onOpenNote: (target: string) => void;
  onRenamed: (project: string) => void;
  timeline?: (props: TimelineProps) => ReactNode;
}) {
  const { renameProject: renameTaskProject } = useTasks();
  const { renameProject: renameNoteProject } = useNotes();
  const [view, setView] = useState<View>(list ? 'tasks' : 'board');
  // The Scholarships tab appears once the project has one; an empty tab is noise.
  const { notes } = useNotes();
  const hasScholarships = notes.some((n) => n.project === project && n.kind === 'scholarship');
  const isSearch = notes.some((n) => n.project === project && (n.kind === 'profile' || n.kind === 'programme'));
  const [meta, setMeta] = useState<Meta>(() => load(project));
  const [calendar, setCalendar] = useState<{ field: 'start' | 'target'; rect: DOMRect; trigger: HTMLButtonElement } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(project);
  const bodyRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLElement>(null);
  const mine = tasks.filter((task) => task.project === project);
  const done = mine.filter((task) => task.state === 'done').length;
  const progress = mine.length ? Math.round((done / mine.length) * 100) : 0;
  const save = (patch: Partial<Meta>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    keep(project, next);
  };
  const openCalendar = (field: 'start' | 'target', trigger: HTMLButtonElement) => setCalendar({ field, rect: trigger.getBoundingClientRect(), trigger });
  const commitName = async () => {
    if (!editingName) return;
    const renamed = await renameTaskProject(project, name);
    if (!renamed) return;
    setEditingName(false);
    if (renamed === project) return;
    moveMeta(project, renamed);
    await renameNoteProject(project, renamed);
    onRenamed(renamed);
  };

  return <>
    <section className="prj-hero">
      <div className="prj-hero__wash" aria-hidden="true" />
      <div className="fin-grain prj-hero__grain" aria-hidden="true" />
      <div className="prj-hero__top">
        <span className="prj-hero__name">
          <ProjectIconPicker value={meta.icon} project={project} onChange={(icon) => save({ icon })} />
          {editingName ? <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void commitName()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commitName(); } else if (event.key === 'Escape') { event.preventDefault(); setName(project); setEditingName(false); } }} aria-label="Project name" /> : <><span onDoubleClick={() => setEditingName(true)}>{projectLabel(project)}</span><button type="button" className="prj-name-edit" onClick={() => setEditingName(true)} aria-label="Rename project"><Pencil size={12} /></button></>}
          {editingName && <button type="button" className="prj-name-edit" onPointerDown={(event) => event.preventDefault()} onClick={() => void commitName()} aria-label="Save project name"><Check size={13} /></button>}
        </span>
      </div>
      <div ref={bodyRef} className="prj-hero__body" data-open-ended={meta.openEnded || undefined}>
        <div className="prj-hero__details">
          <input className="prj-hero__goal" value={meta.goal} onChange={(event) => save({ goal: event.target.value })} placeholder="What does done look like?" aria-label="Project goal" />
          <textarea className="prj-hero__overview" value={meta.overview} onChange={(event) => save({ overview: event.target.value })} placeholder="A short overview of this project" rows={2} aria-label="Project overview" />
          <div className="prj-hero__foot"><span><b className="fin-num">{progress}%</b> complete</span><span>{mine.length - done} open · {done} done</span></div>
          <ProjectDateFlow meta={meta} bodyRef={bodyRef} activityRef={activityRef} save={save} openCalendar={openCalendar} />
        </div>
        <aside ref={activityRef} className="prj-activity-panel"><header><span>Activity</span><small>{meta.openEnded ? 'Open-ended · 20 weeks' : '20 weeks'}</small></header><ProjectActivity tasks={mine} /></aside>
      </div>
    </section>
    {calendar && <CalendarPopover anchor={calendar.rect} trigger={calendar.trigger} value={meta[calendar.field]} min={calendar.field === 'target' ? meta.start : undefined} max={calendar.field === 'start' && !meta.openEnded ? meta.target : undefined} clearable label={calendar.field === 'start' ? 'Project start date' : 'Project end date'} onClose={() => setCalendar(null)} onPick={(value) => save({ [calendar.field]: value, ...(calendar.field === 'target' ? { openEnded: false } : {}) })} />}
    <nav className="prj-tabs" aria-label="Project views">
      {([...(list ? [['tasks', ListChecks, 'Tasks'] as const] : []), ['dashboard', LayoutDashboard, 'Dashboard'], ...(board ? [['board', Boxes, 'Board'] as const] : []), ['timeline', CalendarRange, 'Timeline'], ...(isSearch ? [['discover', Telescope, 'Discover'] as const, ['compare', Columns3, 'Compare'] as const] : []), ...(hasScholarships ? [['scholarships', PiggyBank, 'Scholarships'] as const] : []), ['library', BookOpen, 'Library'], ['moodboard', GitBranch, 'Moodboard']] as const).map(([id, Icon, label]) => <button type="button" key={id} data-active={view === id || undefined} onClick={() => setView(id)}><Icon size={14} />{label}</button>)}
      {onResearch && isSearch && <button type="button" className="prj-tabs__aside" onClick={onResearch} aria-label="Research sources" title="Research sources"><Globe2 size={14} /></button>}
    </nav>
    {/* Keyed by the view, so switching fades the new one in instead of teleporting. */}
    <div className="prj-view" key={view}>
      {view === 'discover' ? (
        <Discover project={project} onOpenNote={onOpenNote} />
      ) : view === 'compare' ? (
        <Compare project={project} onOpenNote={onOpenNote} />
      ) : view === 'scholarships' ? (
        <Scholarships project={project} onOpenNote={onOpenNote} />
      ) : view === 'dashboard' ? (
        <ProjectDashboard project={project} tasks={mine} layout={meta.dashboard ?? []} onLayout={(dashboard) => save({ dashboard })} onOpenTask={onOpenTask} onOpenNote={onOpenNote} />
      ) : view === 'tasks' ? list : view === 'board' ? board : view === 'timeline' ? (timeline ? timeline({ tasks: mine, start: meta.start, target: meta.openEnded ? undefined : meta.target, onOpen: onOpenTask }) : <Timeline tasks={mine} start={meta.start} target={meta.openEnded ? undefined : meta.target} onOpen={onOpenTask} />) : <ProjectNotes project={project} moodboard={view === 'moodboard'} onOpen={onOpenNote} />}
    </div>
  </>;
}

function Timeline({ tasks, start, target, onOpen }: { tasks: Task[]; start?: string; target?: string; onOpen: (id: string) => void }) {
  const dated = tasks.filter((task) => task.created || task.due || task.scheduled || task.done);
  const range = useMemo(() => {
    const dates = [start, target, ...dated.flatMap((task) => [task.created?.slice(0, 10), task.due, task.scheduled?.slice(0, 10), task.done?.slice(0, 10)])].filter(Boolean) as string[];
    const low = dates.sort()[0] ?? new Date().toISOString().slice(0, 10);
    const high = [...dates].sort().at(-1) ?? low;
    return [new Date(`${low}T00:00`).getTime(), Math.max(new Date(`${high}T00:00`).getTime(), new Date(`${low}T00:00`).getTime() + 6 * 864e5)] as const;
  }, [dated, start, target]);
  return <section className="prj-timeline"><header><h3>Project timeline</h3><span>{new Date(range[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {new Date(range[1]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span></header>{dated.length ? <div className="prj-timeline__rows">{dated.map((task) => { const a = new Date(`${(task.created ?? task.scheduled ?? task.due ?? task.done)!.slice(0, 10)}T00:00`).getTime(); const b = new Date(`${(task.done ?? task.due ?? task.scheduled ?? task.created)!.slice(0, 10)}T00:00`).getTime(); const span = range[1] - range[0]; const left = Math.max(0, ((Math.min(a, b) - range[0]) / span) * 100); const width = Math.max(1.5, (Math.abs(b - a) / span) * 100); return <button type="button" key={task.id} onClick={() => onOpen(task.id)}><span>{task.title}</span><i><b data-state={task.state} style={{ left: `${left}%`, width: `${width}%` }} /></i><em>{task.due ?? task.scheduled?.slice(0, 10) ?? ''}</em></button>; })}</div> : <p className="prj-empty">Add dates or time blocks to tasks and the timeline builds itself.</p>}</section>;
}

function ProjectNotes({ project, moodboard, onOpen }: { project: string; moodboard: boolean; onOpen: (target: string) => void }) {
  const { notes, create } = useNotes();
  const mine = notes.filter((note) => note.project === project);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const add = async () => {
    if (busy) return;
    setBusy(true);
    const path = await create({ title: title || (url ? 'Reference' : 'Untitled'), kind: url ? 'reference' : 'note', project, props: { url: url || undefined } });
    setBusy(false);
    if (!path) return;
    setAdding(false);
    setTitle('');
    setUrl('');
    if (!moodboard) onOpen(path);
  };
  return <section className={moodboard ? 'prj-library prj-library--mood' : 'prj-library'}>
    <header><div><h3>{moodboard ? 'Moodboard' : 'Project library'}</h3><p>{moodboard ? 'Ideas and references collected as a visual field.' : 'Notes, references, links and working material for this project.'}</p></div><button type="button" className="fin-pill fin-pill--sm" onClick={() => setAdding(true)}><Plus size={13} /> Add</button></header>
    {adding && <form className="prj-library__add" onSubmit={(event) => { event.preventDefault(); void add(); }}><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" /><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="URL (optional)" /><button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button><button type="button" aria-label="Cancel" onClick={() => setAdding(false)}><X size={14} /></button></form>}
    <div className="prj-library__grid">{mine.map((note, index) => <button type="button" key={note.path} style={moodboard ? { '--r': `${(index % 5 - 2) * 0.75}deg`, '--lift': `${index % 2 ? 12 : 0}px` } as CSSProperties : undefined} onClick={() => onOpen(note.path)}><span>{note.kind === 'reference' ? <Link2 size={14} /> : <FileText size={14} />}{KIND_LABEL[note.kind]}</span><strong>{note.title}</strong><p>{note.excerpt || note.url || 'Open to start writing'}</p>{note.url && <em>{note.url.replace(/^https?:\/\//, '').split('/')[0]}</em>}</button>)}</div>
    {!mine.length && <p className="prj-empty">Nothing here yet. Add a note or reference when the project needs context.</p>}
  </section>;
}

/* ------------------------------------------------------------------ */
/* the project's own dashboard                                         */
/* ------------------------------------------------------------------ */

/**
 * A project page starts with no widgets at all (owner, 2026-09-19: "by default
 * there should be no project modules") — a project is a piece of software, a
 * thesis, an application campaign, and no fixed set fits all three. You add
 * what this one needs; the list lives with the project.
 */
function ProjectDashboard({
  project,
  tasks,
  layout,
  onLayout,
  onOpenTask,
  onOpenNote,
}: {
  project: string;
  tasks: Task[];
  layout: WidgetId[];
  onLayout: (next: WidgetId[]) => void;
  onOpenTask: (id: string) => void;
  onOpenNote: (target: string) => void;
}) {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; trigger: HTMLElement } | null>(null);
  const free = PROJECT_WIDGETS.filter((id) => !layout.includes(id));
  const ctx = { tasks, project, projects: [], today: todayIso(), now: new Date(), onOpen: onOpenTask, onOpenNote, onProject: () => {} };

  const add = (id: WidgetId) => onLayout([...layout, id]);
  const move = (id: WidgetId, by: -1 | 1) => {
    const i = layout.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= layout.length) return;
    const next = [...layout];
    [next[i], next[j]] = [next[j], next[i]];
    onLayout(next);
  };

  const entries: MenuEntry[] = free.map((id) => ({ id, label: WIDGETS[id].title, hint: WIDGETS[id].hint, onSelect: () => add(id) }));

  return (
    <section className="prj-dash" aria-label="Project dashboard">
      {layout.length > 0 ? (
        <>
          <Dashboard {...ctx} layout={layout} edit={{ onMove: move, onRemove: (id) => onLayout(layout.filter((x) => x !== id)) }} />
          {free.length > 0 && (
            <button
              type="button"
              className="fin-pill fin-pill--sm prj-dash__add"
              onClick={(event) => setMenu({ at: { x: event.currentTarget.getBoundingClientRect().left, y: event.currentTarget.getBoundingClientRect().bottom + 6 }, trigger: event.currentTarget })}
              aria-haspopup="menu"
            >
              <Plus size={13} strokeWidth={2} />
              Add widget
            </button>
          )}
        </>
      ) : (
        <div className="prj-dash__empty">
          <h3>Nothing on this dashboard yet</h3>
          <p>Add what this project actually needs. You can change it any time.</p>
          <div className="prj-dash__choices">
            {PROJECT_WIDGETS.map((id) => (
              <button type="button" key={id} onClick={() => add(id)}>
                <strong>{WIDGETS[id].title}</strong>
                <span>{WIDGETS[id].hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {menu && <Menu label="Add widget" trigger={menu.trigger} placement={{ at: menu.at }} minWidth={240} onClose={() => setMenu(null)} entries={entries} />}
    </section>
  );
}
