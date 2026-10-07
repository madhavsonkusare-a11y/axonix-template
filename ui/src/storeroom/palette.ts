/**
 * The colours in a reference, for the detail sheet.
 *
 * Raster images: k-means over a 64×64 copy, clusters ranked by how much of the
 * picture they cover, near-duplicates merged. SVG: the colours the file
 * actually declares, most used first — exact values, not an estimate.
 * Computed when an item is opened; nothing is stored.
 */

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function kmeans(pixels: Rgb[], k: number): { color: Rgb; count: number }[] {
  if (!pixels.length) return [];
  // Spread the starting points over the brightness range.
  const sorted = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers: Rgb[] = Array.from({ length: Math.min(k, sorted.length) }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]] as Rgb);
  let counts: number[] = [];
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of pixels) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(p, centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3] += 1;
    }
    counts = sums.map((s) => s[3]);
    centers = sums.map((s, i) => (s[3] ? ([s[0] / s[3], s[1] / s[3], s[2] / s[3]] as Rgb) : centers[i]));
  }
  return centers.map((color, i) => ({ color, count: counts[i] })).filter((c) => c.count > 0);
}

function rank(clusters: { color: Rgb; count: number }[], max: number): string[] {
  const out: { color: Rgb; count: number }[] = [];
  for (const c of clusters.sort((a, b) => b.count - a.count)) {
    const near = out.find((o) => dist2(o.color, c.color) < 24 * 24);
    if (near) near.count += c.count;
    else out.push({ ...c });
  }
  return out
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((c) => hex(c.color));
}

async function rasterPalette(blob: Blob, max: number): Promise<string[]> {
  const size = 64;
  let source: CanvasImageSource;
  let url: string | null = null;
  try {
    source = await createImageBitmap(blob, { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' });
  } catch {
    // Formats createImageBitmap refuses (SVG) still draw through an <img>.
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    source = img;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(source, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const pixels: Rgb[] = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) pixels.push([data[i], data[i + 1], data[i + 2]]);
    return rank(kmeans(pixels, 8), max);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

const NAMED: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080' };

function svgPalette(text: string, max: number): string[] {
  const counts = new Map<string, number>();
  const add = (c: string) => counts.set(c, (counts.get(c) ?? 0) + 1);
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    add(`#${h.toLowerCase()}`);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/gi)) add(hex([Number(m[1]), Number(m[2]), Number(m[3])]));
  for (const m of text.matchAll(/(?:fill|stroke|stop-color|color)\s*[=:]\s*["']?([a-z]+)\b/gi)) {
    const named = NAMED[m[1].toLowerCase()];
    if (named) add(named);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

/** Up to `max` hex colours for the media at `url`. */
export async function paletteOf(url: string, isSvg: boolean, max = 6): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const blob = await res.blob();
  if (isSvg) {
    const declared = svgPalette(await blob.text(), max);
    if (declared.length) return declared;
  }
  return rasterPalette(blob, max);
}

/** Draw any image the page can show as PNG, for the clipboard. */
export async function pngDataUrl(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 1024;
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
