/**
 * Word change, for a figure: a count rolls to its new value instead of being
 * replaced (plan 20, "the motion system"). NumberFlow (MIT) does the rolling;
 * the timing is the app's own curve. It moves only when the number changes.
 */
import NumberFlow from '@number-flow/react';

const ROLL = { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
const FADE = { duration: 200, easing: 'linear' };

export default function Count({ value, className }: { value: number; className?: string }) {
  // The digits live in the element's own shadow tree; `data-value` says the number to anything reading the page.
  return <NumberFlow className={className} data-value={value} value={value} transformTiming={ROLL} spinTiming={ROLL} opacityTiming={FADE} />;
}
