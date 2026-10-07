/**
 * The aurora surface.
 *
 * Four stacked layers in a fixed order — wash, dot grid, film grain, content —
 * shared by the launcher tiles, every account card and the savings panel. The
 * hue and the gradient geometry are CSS custom properties (see `.fin-aurora`
 * and `.fin-hue-*` in finance.css), so a consumer picks a hue with a class and
 * nudges geometry with a modifier rather than passing colours through props.
 *
 * The layers are returned as a fragment instead of wrapping them in a div: the
 * root element differs per consumer (a <button> for a tile, a <div> for a card)
 * and this keeps that choice with the consumer.
 */
import type { Hue } from '../types';

export function AuroraLayers() {
  return (
    <>
      <span className="fin-aurora__wash" aria-hidden="true" />
      <span className="fin-aurora__dots" aria-hidden="true" />
      <span className="fin-grain" aria-hidden="true" />
    </>
  );
}

/** Class list for an aurora root. `extra` carries the size/geometry modifier. */
export function auroraClass(hue: Hue, extra?: string): string {
  return ['fin-aurora', `fin-hue-${hue}`, extra].filter(Boolean).join(' ');
}
