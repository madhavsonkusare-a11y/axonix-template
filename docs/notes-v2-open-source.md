# Notes v2 — open-source integration

Axonix integrates the real AFFiNE/BlockSuite document editor, not a visual imitation.
No AFFiNE server, account system, or proprietary feature is bundled.

## Upstream components

- `@blocksuite/blocks`, `@blocksuite/presets`, and `@blocksuite/store`:
  `0.0.0-canary-20250316001624`, Mozilla Public License 2.0.
  Source: https://github.com/toeverything/blocksuite
  License: https://github.com/toeverything/blocksuite/blob/master/LICENSE
- `@toeverything/theme`: `1.1.23`, Mozilla Public License 2.0 (package LICENSE).
  Source: https://github.com/toeverything/design
- BlockSuite brings its published transitive dependencies, including Yjs,
  Lit, its native rich-text controls, block schemas, adapters and icons.
  Their license notices remain applicable.

The packages are consumed unchanged. Axonix's integration lives in
`ui/src/notes/editor/BlockEditor.tsx`: document lifecycle, Markdown adapter,
embedded asset persistence, native theme tokens, and per-instance menu configuration.
Axonix provides the library, templates, project metadata, outline, imports/exports,
save queue, recovery and trash. Dependencies and exact versions are in the lockfile.

The packaged application includes the direct editor/theme MPL 2.0 license in
`resources/app/third-party-notices/` plus this source notice. Source for the pinned
packages is available in their npm distributions and the repositories above.
The BlockSuite npm packages identify MPL 2.0 in their manifests but omit the
license file, so the same MPL 2.0 text shipped with `@toeverything/theme` is
included under each package's name.

## Deliberate boundaries

- Local notes only; no AFFiNE cloud, collaboration, AI subscription or Edgeless canvas.
- Native linked-document creation is disabled: a single-document collection cannot
  safely persist those new documents. Ordinary web links remain available.
- Complete-note JSON exports preserve rich blocks and embedded assets. Markdown is
  a portable projection; it cannot represent every database/media block losslessly.
- Rich documents have a 16 MB desktop limit. A failed save remains visible and
  blocks normal note switching; recovery export remains available.

## Motion review

| Interaction | Treatment | Reason |
| --- | --- | --- |
| Library row / toolbar press | Immediate 0.97 scale, 160 ms return | Clear input feedback |
| Focus and document entry | Short transform/opacity entrance | Preserve spatial continuity |
| Hover and selection | 140–160 ms colour/material transition | Avoid distracting flashes |
| Outline navigation | Smooth scroll to heading | Keep document context |

No idle decorative animation or reduced-motion branch is introduced, per the owner's preference.
