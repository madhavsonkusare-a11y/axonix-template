/**
 * The sky's five moods. Colour here has a reason: it is the hour.
 *
 * Home draws it as the day's band; Tasks stands on it as the whole page.
 */
export type Sky = 'night' | 'dawn' | 'day' | 'golden' | 'dusk';

export function skyOf(hour: number): Sky {
  return hour < 5 ? 'night' : hour < 8 ? 'dawn' : hour < 16 ? 'day' : hour < 18.5 ? 'golden' : hour < 20.5 ? 'dusk' : 'night';
}
