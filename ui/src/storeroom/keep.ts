/**
 * Keeping something in the Storeroom from anywhere in Axonix.
 *
 * The Storeroom's own page keeps things through `StoreroomContext.intake`,
 * which also looks after the page's list. This is the same set of calls
 * without the page: Lift uses it when a file, a link or an image is dropped on
 * the Storeroom's tile or the Pocket from another module. An open Storeroom
 * hears about the change from the library itself and reloads.
 */
import { acceptedFile, type Intake } from './capture';
import { storeroomBackend as backend } from './backend';
import type { AddResult, StoreItem } from './types';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export interface Kept {
  /** Newly kept. */
  kept: StoreItem[];
  /** Already in the Storeroom. */
  again: StoreItem[];
  /** What could not be kept, in words. */
  failed: string[];
}

export async function keepInStoreroom(list: Intake[], via: string): Promise<Kept> {
  const results: AddResult[] = [];
  const paths: string[] = [];
  for (const entry of list) {
    try {
      if (entry.type === 'file') {
        if (!acceptedFile(entry.file)) {
          results.push({ ok: false, error: `${entry.file.name}: only images, SVG and video go in the Storeroom` });
          continue;
        }
        const onDisk = backend.pathForFile(entry.file);
        if (onDisk) paths.push(onDisk);
        else results.push(await backend.addBytes(entry.file.name || 'Pasted image.png', new Uint8Array(await entry.file.arrayBuffer()), via));
      } else if (entry.type === 'url') results.push(await backend.addUrl(entry.url, via));
      else results.push(await backend.addText(entry.text, via));
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
  return {
    kept: results.filter((r) => r.ok && r.item && !r.duplicate).map((r) => r.item!),
    again: results.filter((r) => r.ok && r.item && r.duplicate).map((r) => r.item!),
    failed: results.filter((r) => !r.ok).map((r) => r.error ?? 'It could not be kept'),
  };
}

/** A file already on this computer, by its path (something carried in the Pocket). */
export async function keepPath(path: string, via: string): Promise<Kept> {
  try {
    const results = await backend.addFiles([path], via);
    return {
      kept: results.filter((r) => r.ok && r.item && !r.duplicate).map((r) => r.item!),
      again: results.filter((r) => r.ok && r.item && r.duplicate).map((r) => r.item!),
      failed: results.filter((r) => !r.ok).map((r) => r.error ?? 'It could not be kept'),
    };
  } catch (e) {
    return { kept: [], again: [], failed: [messageOf(e)] };
  }
}
