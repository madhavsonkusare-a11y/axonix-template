/**
 * The Storeroom's shapes, as the main process sends them (electron/storeroom.ts).
 *
 * One item is one folder on disk, `items/R0042/`: its media plus an `item.md`
 * sidecar. After Karakeep's bookmark kinds (link / text / asset), split by what
 * a designer looks for: images, SVG, video, links and notes.
 */
export type Kind = 'image' | 'svg' | 'video' | 'link' | 'note';

export interface StoreItem {
  /** Stable, never reused: R0042. */
  id: string;
  kind: Kind;
  title: string;
  /** The main media file inside the item's folder. Notes have none. */
  file?: string;
  /** Where it came from: the page of a saved image, or the link itself. */
  source?: string;
  /** The media's own address, when it differs from `source`. */
  mediaUrl?: string;
  /** How it arrived: drop, paste, add, file, social:pinterest… */
  via?: string;
  tags: string[];
  /** The one line that matters: why this was kept. */
  why: string;
  notes: string;
  width?: number;
  height?: number;
  bytes?: number;
  site?: string;
  description?: string;
  icon?: string;
  capture?: 'pending' | 'failed';
  created: string;
  mtime: number;
  files: string[];
}

export interface AddResult {
  ok: boolean;
  item?: StoreItem;
  duplicate?: boolean;
  error?: string;
  name?: string;
}

export interface Listing {
  /** The folder on disk, for display. */
  root: string;
  items: StoreItem[];
  trashed: number;
}

export interface ItemPatch {
  title?: string;
  why?: string;
  tags?: string[];
  notes?: string;
  width?: number;
  height?: number;
}

/** Sent by the main process when Social's "Save … to Storeroom" finishes. */
export interface SavedNotice {
  id: string;
  title: string;
  kind: Kind;
  duplicate: boolean;
}

/** The rail's views: everything, the unsorted pile, one kind, or one tag. */
export type StoreView = 'all' | 'unsorted' | 'image' | 'motion' | 'svg' | 'link' | 'note' | `t:${string}`;
