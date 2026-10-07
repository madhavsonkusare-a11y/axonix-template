/**
 * A brand's mark on a rounded tile, or a two-letter monogram when there is no
 * brand — the same footprint either way, so rows stay aligned.
 */
import type { BrandId } from '../types';
import { BRANDS } from '../brands';

export function BrandMark({
  brand,
  fallback,
  size = 30,
  className,
}: {
  brand?: BrandId;
  /** Used for the monogram when `brand` is absent. */
  fallback?: string;
  size?: number;
  className?: string;
}) {
  const b = brand ? BRANDS[brand] : undefined;
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.28) };
  const cls = ['fin-brand', b?.fit === 'contain' && 'fin-brand--contain', !b && 'fin-brand--mono', className]
    .filter(Boolean)
    .join(' ');

  if (!b) {
    const letters = (fallback ?? '?')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return (
      <span className={cls} style={{ ...style, fontSize: Math.round(size * 0.34) }} aria-hidden="true">
        {letters}
      </span>
    );
  }

  return (
    <span className={cls} style={style} title={b.name}>
      <img src={b.src} alt={b.name} draggable={false} />
    </span>
  );
}
