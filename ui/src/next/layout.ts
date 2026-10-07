/**
 * Whether the module's sidebar is showing, and which edge the modules stand on.
 *
 * A window preference, not owner data: it lives in `localStorage` beside the
 * other per-window choices and is never written to the finance store.
 *
 * The modules are a rail on the left edge (owner, 2026-10-07: "i want this
 * left sidebar, no more dock"). The edge is no longer a choice, so it is not
 * read from what was saved; the other three stay in the type because the time
 * ruler and the ask panel still know how to stand beside any of them.
 */
import { useCallback, useState } from 'react';

export type DockEdge = 'bottom' | 'top' | 'left' | 'right';

export interface NextLayout {
  edge: DockEdge;
  /** The module's sidebar. Put away, its views become tabs and the rest a menu. */
  list: boolean;
}

const KEY = 'axonix.next.layout';
const RAIL: DockEdge = 'left';

function read(): NextLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<NextLayout> | null;
    return { edge: RAIL, list: saved?.list !== false };
  } catch {
    return { edge: RAIL, list: true };
  }
}

export function useNextLayout(): [NextLayout, (patch: Pick<Partial<NextLayout>, 'list'>) => void] {
  const [layout, setLayout] = useState(read);
  const update = useCallback((patch: Pick<Partial<NextLayout>, 'list'>) => {
    setLayout((now) => {
      const next = { ...now, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage refused: the choice lasts for this session only */
      }
      return next;
    });
  }, []);
  return [layout, update];
}
