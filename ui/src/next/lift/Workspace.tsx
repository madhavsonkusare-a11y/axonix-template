/**
 * The workspace: what ties the modules together.
 *
 * Two small lists, kept in a file of their own (`workspace.json`, beside the
 * finance file, through the main process). Nothing in the finance file, a task
 * or a note changes shape for them.
 *
 * - **Links**: two things joined by a drop ("this payment belongs to that
 *   task"). A link keeps a few words about each side, so it can be shown from
 *   either end even when the other module's data is not loaded.
 * - **The Pocket**: things being carried from one module to another.
 *
 * In a plain browser (the dev server) both live in localStorage.
 *
 * If the file cannot be read, nothing is saved this session: the alternative
 * is writing an empty list over links that may be perfectly recoverable.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { desktop } from '../../finance/desktop';
import { keyOf, same, type Thing } from './things';

export interface Link {
  id: string;
  a: Thing;
  b: Thing;
  /** When it was made, ISO. */
  at: string;
}

interface Doc {
  version: 1;
  pocket: Thing[];
  links: Link[];
}

const EMPTY: Doc = { version: 1, pocket: [], links: [] };
const POCKET_MAX = 12;
const KEY = 'axonix:workspace';

interface Bridge {
  read(): Promise<string | null>;
  write(json: string): Promise<boolean>;
}
const bridge: Bridge | null = typeof window !== 'undefined' ? ((window as unknown as { axonixWorkspace?: Bridge }).axonixWorkspace ?? null) : null;

async function load(): Promise<Doc> {
  const raw = bridge ? await bridge.read() : localStorage.getItem(KEY);
  if (!raw) return EMPTY;
  const doc = JSON.parse(raw) as Partial<Doc>;
  const thing = (t: unknown): t is Thing => !!t && typeof (t as Thing).kind === 'string' && typeof (t as Thing).id === 'string' && typeof (t as Thing).title === 'string';
  return {
    version: 1,
    pocket: Array.isArray(doc.pocket) ? doc.pocket.filter(thing) : [],
    links: Array.isArray(doc.links) ? doc.links.filter((l) => l && typeof l.id === 'string' && thing(l.a) && thing(l.b)) : [],
  };
}

async function store(doc: Doc): Promise<void> {
  const json = JSON.stringify(doc, null, 1);
  if (bridge) await bridge.write(json);
  else localStorage.setItem(KEY, json);
}

export interface WorkspaceValue {
  pocket: Thing[];
  links: Link[];
  /** Puts a thing in the Pocket. False when it was already there. */
  keep: (thing: Thing) => boolean;
  release: (thing: { kind: string; id: string }) => void;
  /** Joins two things. Null when they are the same thing or already joined. */
  link: (a: Thing, b: Thing) => Link | null;
  unlink: (id: string) => void;
  /** Every link that touches this thing, each with the thing on its other side. */
  linksOf: (thing: { kind: string; id: string }) => { link: Link; other: Thing }[];
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<Doc>(EMPTY);
  const latest = useRef(doc);
  latest.current = doc;
  /** Saving is off until the file has been read, and for good if it could not be. */
  const blocked = useRef(true);
  const loaded = useRef<Doc | null>(null);

  useEffect(() => {
    let live = true;
    load()
      .then((d) => {
        if (!live) return;
        loaded.current = d;
        setDoc(d);
        blocked.current = false;
      })
      .catch((e) => {
        if (live) toast('Links and the Pocket could not be read, so they will not be saved this session.', { description: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, []);

  // Written whole, a moment after the last change, and before the window closes.
  const timer = useRef<number | null>(null);
  const dirty = useRef(false);
  const writeNow = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || blocked.current) return;
    dirty.current = false;
    try {
      await store(latest.current);
    } catch (e) {
      dirty.current = true;
      toast('That link was not saved.', { description: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    if (blocked.current || doc === loaded.current) return;
    dirty.current = true;
    timer.current = window.setTimeout(() => void writeNow(), 200);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [doc, writeNow]);
  useEffect(() => desktop?.onClosing(() => writeNow()), [writeNow]);

  const keep = useCallback((thing: Thing) => {
    if (latest.current.pocket.some((p) => same(p, thing))) return false;
    setDoc((d) => ({ ...d, pocket: [thing, ...d.pocket.filter((p) => !same(p, thing))].slice(0, POCKET_MAX) }));
    return true;
  }, []);
  const release = useCallback((thing: { kind: string; id: string }) => setDoc((d) => (d.pocket.some((p) => same(p, thing)) ? { ...d, pocket: d.pocket.filter((p) => !same(p, thing)) } : d)), []);

  const link = useCallback((a: Thing, b: Thing) => {
    if (same(a, b)) return null;
    const exists = latest.current.links.some((l) => (same(l.a, a) && same(l.b, b)) || (same(l.a, b) && same(l.b, a)));
    if (exists) return null;
    const made: Link = { id: `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, a, b, at: new Date().toISOString() };
    setDoc((d) => ({ ...d, links: [...d.links, made] }));
    return made;
  }, []);
  const unlink = useCallback((id: string) => setDoc((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) })), []);

  const byThing = useMemo(() => {
    const map = new Map<string, { link: Link; other: Thing }[]>();
    const add = (k: string, entry: { link: Link; other: Thing }) => map.set(k, [...(map.get(k) ?? []), entry]);
    for (const l of doc.links) {
      add(keyOf(l.a), { link: l, other: l.b });
      add(keyOf(l.b), { link: l, other: l.a });
    }
    return map;
  }, [doc.links]);
  const linksOf = useCallback((thing: { kind: string; id: string }) => byThing.get(keyOf(thing)) ?? NONE, [byThing]);

  const value = useMemo<WorkspaceValue>(() => ({ pocket: doc.pocket, links: doc.links, keep, release, link, unlink, linksOf }), [doc, keep, release, link, unlink, linksOf]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NONE: { link: Link; other: Thing }[] = [];

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace outside WorkspaceProvider');
  return v;
}
