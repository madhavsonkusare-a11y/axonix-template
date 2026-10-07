/**
 * Store-listing app icons (192px), vendored in `assets/brands/` — never
 * hot-linked (DESIGN.md §10). Full-bleed: the tile's corner is the only corner.
 */
import instagram from '../assets/brands/instagram.png';
import linkedin from '../assets/brands/linkedin.png';
import pinterest from '../assets/brands/pinterest.png';
import reddit from '../assets/brands/reddit.png';
import threads from '../assets/brands/threads.png';
import x from '../assets/brands/x.png';
import type { SocialAppId } from './apps';

export const appIcons: Record<SocialAppId, string> = { instagram, x, threads, reddit, linkedin, pinterest };

/**
 * Each app's colour for its launch panel — the colour of its icon, so the
 * icon looks as if it opens up into the page. Instagram's is its gradient, laid
 * over the panel's own box; `base` is what shows before the box is known.
 */
export const appBrand: Record<SocialAppId, { base: string; image?: string }> = {
  instagram: {
    base: '#c13584',
    image: 'radial-gradient(circle at 28% 108%, #fdd574 0%, #f9873a 22%, #e1306c 48%, #c13584 66%, #833ab4 84%, #5851db 100%)',
  },
  x: { base: '#000000' },
  threads: { base: '#000000' },
  reddit: { base: '#ff4500' },
  linkedin: { base: '#0a66c2' },
  pinterest: { base: '#e60023' },
};
