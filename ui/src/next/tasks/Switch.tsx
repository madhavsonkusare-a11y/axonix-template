/**
 * The switch in the middle of the top bar: Tasks | Projects.
 *
 * One capsule, one ink thumb under the side you are on. The thumb slides
 * (transform only); the arrow keys move it, as in any radio group.
 */
import type { CSSProperties } from 'react';

export default function Switch<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div
      className="nxt-switch"
      role="radiogroup"
      aria-label={label}
      style={{ '--n': options.length, '--i': at } as CSSProperties}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = options[(at + step + options.length) % options.length];
        onChange(next.value);
        e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
      }}
    >
      <span className="nxt-switch__thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" data-value={o.value} aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
