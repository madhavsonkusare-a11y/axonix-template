/**
 * The ground behind Home (the launcher): a still mesh gradient with film
 * grain, the look of Apple's recent wallpapers — soft fields of colour that
 * melt into each other, with grain so it reads as a surface, not a screen.
 *
 * Drawn once by Paper Shaders' MeshGradient (Apache-2.0) with speed 0, so after
 * the first frame it costs nothing: no animation loop, no restyling. It is a
 * sibling of the page, never an ancestor of a glass surface (a mask there would
 * turn refraction off). Where WebGL is unavailable the CSS gradient underneath
 * stands in.
 */
import { memo } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';

export type BackdropTone = 'home';

// The apps themselves (Finance, Tasks, Social) sit on the plain ground with
// grain only (owner, 2026-09-19: remove the gradients from individual apps).

/** Light blue on near-black. */
const TONES: Record<BackdropTone, { colors: string[]; offsetX: number; offsetY: number; rotation: number; frame: number; swirl: number; distortion: number }> = {
  home: { colors: ['#04060a', '#081628', '#3f8fd4', '#0a2240', '#04060a', '#0d3342'], offsetX: 0.05, offsetY: -0.2, rotation: 30, frame: 41000, swirl: 0.12, distortion: 0.6 },
};

export const Backdrop = memo(function Backdrop({ tone, className }: { tone: BackdropTone; className?: string }) {
  const t = TONES[tone];
  return (
    <div className={['backdrop', `backdrop--${tone}`, className].filter(Boolean).join(' ')} aria-hidden="true">
      <MeshGradient
        className="backdrop__mesh"
        colors={t.colors}
        distortion={t.distortion}
        swirl={t.swirl}
        grainMixer={0.22}
        grainOverlay={0.3}
        speed={0}
        frame={t.frame}
        scale={1.3}
        rotation={t.rotation}
        offsetX={t.offsetX}
        offsetY={t.offsetY}
        minPixelRatio={1}
        maxPixelCount={1920 * 1080}
      />
    </div>
  );
});
