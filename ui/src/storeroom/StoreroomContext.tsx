/**
 * The Storeroom's state: the items on disk, and every way one arrives or changes.
 *
 * The list is read whole from the main process and read again whenever the
 * folder changes (a capture finishing, an edit in Obsidian, an agent). Edits go
 * straight to the item's sidecar; "delete" is a move into `.trash/` with Undo.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SocialAppId } from '../social/apps';
import type { GuestDrag } from '../social/Site';
import { isDesktop, storeroomBackend as backend } from './backend';
import { acceptedFile, type Intake } from './capture';
import type { AddResult, ItemPatch, StoreItem } from './types';

export interface StoreroomValue {
  items: StoreItem[];
  root: string;
  trashed: number;
  loading: boolean;
  loadError: string | null;
  /** Items kept a moment ago, for their one-time highlight. */
  fresh: ReadonlySet<string>;
  intake(list: Intake[], via: string): Promise<void>;
  /**
   * A drop that started in a social page beside the Storeroom: saved from the
   * guest's report through that app's session; `fallback` is what the drop
   * itself carried, used if the report can't be saved.
   */
  keepFromSocial(app: SocialAppId, drag: GuestDrag, fallback: Intake[]): Promise<void>;
  update(id: string, patch: ItemPatch): Promise<StoreItem | null>;
  trash(id: string): Promise<void>;
  recapture(id: string): Promise<void>;
  /** Width ÷ height, measured in the page for items whose sidecar has no size (video). */
  aspects: Readonly<Record<string, number>>;
  noteAspect(id: string, ratio: number): void;
}

const Ctx = createContext<StoreroomValue | null>(null);
/** Exported so Scrub can show the room as of another day (next/scrub/Lens.tsx). */
export const StoreroomContext = Ctx;

export function useStoreroom(): StoreroomValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useStoreroom outside StoreroomProvider');
  return value;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function StoreroomProvider({ children, onOpenItem }: { children: ReactNode; onOpenItem: (id: string) => void }) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [root, setRoot] = useState('');
  const [trashed, setTrashed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const seq = useRef(0);
  const openRef = useRef(onOpenItem);
  openRef.current = onOpenItem;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const listing = await backend.list();
      if (mine !== seq.current) return;
      setItems(listing.items);
      setRoot(listing.root);
      setTrashed(listing.trashed);
      setLoadError(null);
    } catch (e) {
      if (mine === seq.current) setLoadError(messageOf(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return backend.onChanged(() => void reload());
  }, [reload]);

  const markFresh = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFresh((prev) => new Set([...prev, ...ids]));
    window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 2400);
  }, []);

  const intake = useCallback(
    async (list: Intake[], via: string) => {
      if (!list.length) return;
      const results: AddResult[] = [];
      const paths: string[] = [];
      let skippedOwn = 0;
      for (const entry of list) {
        try {
          if (entry.type === 'file') {
            if (!acceptedFile(entry.file)) {
              results.push({ ok: false, name: entry.file.name, error: `${entry.file.name}: only images, SVG and video go in the Storeroom` });
              continue;
            }
            const onDisk = backend.pathForFile(entry.file);
            if (onDisk && root && onDisk.toLowerCase().startsWith(root.toLowerCase())) {
              skippedOwn++;
              continue;
            }
            if (onDisk) paths.push(onDisk);
            else results.push(await backend.addBytes(entry.file.name || 'Pasted image.png', new Uint8Array(await entry.file.arrayBuffer()), via));
          } else if (entry.type === 'url') {
            results.push(await backend.addUrl(entry.url, via));
          } else {
            results.push(await backend.addText(entry.text, via));
          }
        } catch (e) {
          results.push({ ok: false, error: messageOf(e) });
        }
      }
      if (paths.length) {
        try {
          results.push(...(await backend.addFiles(paths, via)));
        } catch (e) {
          results.push({ ok: false, error: messageOf(e) });
        }
      }

      const kept = results.filter((r) => r.ok && r.item && !r.duplicate).map((r) => r.item!);
      const again = results.filter((r) => r.ok && r.item && r.duplicate).map((r) => r.item!);
      const failed = results.filter((r) => !r.ok);
      markFresh(kept.map((i) => i.id));
      if (kept.length === 1) {
        const item = kept[0];
        toast(`Kept ${item.id}`, { description: item.title, action: { label: 'Open', onClick: () => openRef.current(item.id) } });
      } else if (kept.length > 1) {
        toast(`Kept ${kept.length} references`, { description: kept.map((i) => i.id).join(' · ') });
      }
      if (again.length) {
        const first = again[0];
        toast(again.length === 1 ? `Already kept as ${first.id}` : `${again.length} were already kept`, {
          description: again.length === 1 ? first.title : undefined,
          action: { label: 'Open', onClick: () => openRef.current(first.id) },
        });
      }
      if (skippedOwn) toast(skippedOwn === 1 ? 'That file is already in the Storeroom.' : `${skippedOwn} files are already in the Storeroom.`);
      if (failed.length) toast(failed.length === 1 ? 'Couldn’t keep that' : `Couldn’t keep ${failed.length} of them`, { description: failed[0].error });
      if (kept.length || again.length) void reload();
    },
    [markFresh, reload, root],
  );

  const keepFromSocial = useCallback(
    async (app: SocialAppId, drag: GuestDrag, fallback: Intake[]) => {
      let result: AddResult;
      try {
        result = await backend.saveSocial(app, drag);
      } catch (e) {
        result = { ok: false, error: messageOf(e) };
      }
      if (result.ok && result.item) {
        const item = result.item;
        markFresh([item.id]);
        // The desktop app announces the save itself (Kept / Already kept, with Open).
        if (!isDesktop) toast(result.duplicate ? `Already kept as ${item.id}` : `Kept ${item.id}`, { description: item.title, action: { label: 'Open', onClick: () => openRef.current(item.id) } });
        void reload();
        return;
      }
      if (fallback.length) {
        await intake(fallback, 'drop');
        return;
      }
      toast('Couldn’t keep that', { description: `${result.error ?? 'The site gave nothing to save'}. Right-click it → Save this view to Storeroom.` });
    },
    [intake, markFresh, reload],
  );

  const update = useCallback(
    async (id: string, patch: ItemPatch) => {
      try {
        const next = await backend.update(id, patch);
        setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
        return next;
      } catch (e) {
        toast(`Couldn’t save ${id}`, { description: messageOf(e) });
        return null;
      }
    },
    [],
  );

  const trash = useCallback(
    async (id: string) => {
      try {
        const name = await backend.trash(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        toast(`Moved ${id} to the trash`, {
          action: {
            label: 'Undo',
            onClick: () => {
              backend
                .restore(name)
                .then(() => reload())
                .catch((e) => toast('Couldn’t bring it back', { description: messageOf(e) }));
            },
          },
        });
      } catch (e) {
        toast(`Couldn’t move ${id} to the trash`, { description: messageOf(e) });
      }
    },
    [reload],
  );

  const recapture = useCallback(
    async (id: string) => {
      try {
        await backend.recapture(id);
        void reload();
      } catch (e) {
        toast('Couldn’t capture the page again', { description: messageOf(e) });
      }
    },
    [reload],
  );

  const noteAspect = useCallback((id: string, ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setAspects((prev) => (Math.abs((prev[id] ?? 0) - ratio) < 0.01 ? prev : { ...prev, [id]: ratio }));
  }, []);

  const value = useMemo<StoreroomValue>(
    () => ({ items, root, trashed, loading, loadError, fresh, intake, keepFromSocial, update, trash, recapture, aspects, noteAspect }),
    [items, root, trashed, loading, loadError, fresh, intake, keepFromSocial, update, trash, recapture, aspects, noteAspect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
