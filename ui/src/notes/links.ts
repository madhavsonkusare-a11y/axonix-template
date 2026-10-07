/**
 * How a link finds its note or image, the way Obsidian resolves them:
 * a path first, then by name — the closest file with that name, preferring one
 * in the linking note's own folder.
 */

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export const noteName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** `Folder/Note#Heading|Alias` → `Folder/Note`. */
export function linkTarget(raw: string): string {
  return raw.split('|')[0].split('#')[0].trim();
}

function closest(candidates: string[], from: string): string | null {
  if (!candidates.length) return null;
  const dir = folderOf(from);
  return [...candidates].sort((a, b) => {
    const sa = folderOf(a) === dir ? 0 : 1;
    const sb = folderOf(b) === dir ? 0 : 1;
    return sa - sb || a.split('/').length - b.split('/').length || a.localeCompare(b);
  })[0];
}

/** A note path for `[[target]]`, or null when no note has that name. */
export function resolveNote(target: string, files: string[], from: string): string | null {
  const t = linkTarget(target).replace(/\\/g, '/');
  if (!t) return null;
  const withMd = /\.md$/i.test(t) ? t : `${t}.md`;
  const low = withMd.toLowerCase();
  const exact = files.find((f) => f.toLowerCase() === low);
  if (exact) return exact;
  if (t.includes('/')) {
    const relative = `${folderOf(from) ? `${folderOf(from)}/` : ''}${withMd}`.toLowerCase();
    const rel = files.find((f) => f.toLowerCase() === relative);
    if (rel) return rel;
  }
  const name = noteName(withMd).toLowerCase();
  return closest(
    files.filter((f) => noteName(f).toLowerCase() === name),
    from,
  );
}

/** An image path for `![[name.png]]` or `![](relative/name.png)`, or null. */
export function resolveImage(target: string, images: string[], from: string): string | null {
  let t = linkTarget(target).replace(/\\/g, '/');
  try {
    t = decodeURI(t);
  } catch {
    // Keep it as written.
  }
  if (/^[a-z]+:/i.test(t)) return null;
  const low = t.toLowerCase().replace(/^\.\//, '');
  const exact = images.find((i) => i.toLowerCase() === low);
  if (exact) return exact;
  const dir = folderOf(from);
  const relative = (dir ? `${dir}/${low}` : low).toLowerCase();
  const rel = images.find((i) => i.toLowerCase() === relative);
  if (rel) return rel;
  const name = low.slice(low.lastIndexOf('/') + 1);
  return closest(
    images.filter((i) => i.slice(i.lastIndexOf('/') + 1).toLowerCase() === name),
    from,
  );
}

/** A free `.md` path for `name` in `folder`. */
export function freeNotePath(folder: string, name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const dir = folder ? `${folder}/` : '';
  let candidate = `${dir}${name}.md`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${dir}${name} ${n}.md`;
  return candidate;
}
