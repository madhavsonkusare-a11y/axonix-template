// Rasterise the icon SVG to the PNG sizes Chrome needs.
//
// Chrome extension icons must be raster — SVG is not accepted — so this cannot
// be skipped by pointing the manifest at the .svg.
//
//     node icons.mjs

import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SRC = '../assets/icon-source.svg';
const SIZES = [16, 32, 48, 128];
// Master for `tauri icon`, which derives the full desktop set (including .ico)
// from one large PNG. Written to assets/ since it is not an extension asset.
const MASTER = { size: 1024, out: '../assets/icon-1024.png' };

const svg = await readFile(SRC, 'utf8');
await mkdir('icons', { recursive: true });

for (const size of SIZES) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    // The plate is opaque, so no background is needed behind it.
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();
  await writeFile(`icons/icon${size}.png`, png);
  console.log(`icons/icon${size}.png  ${(png.length / 1024).toFixed(1)} KB`);
}

const master = new Resvg(svg, { fitTo: { mode: 'width', value: MASTER.size } })
  .render()
  .asPng();
await writeFile(MASTER.out, master);
console.log(`${MASTER.out}  ${(master.length / 1024).toFixed(1)} KB`);
