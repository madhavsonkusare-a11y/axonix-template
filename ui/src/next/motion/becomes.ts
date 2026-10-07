/**
 * Becomes: one thing turns into another in place (plan 20, "the motion
 * system"). A card grows into its panel instead of the panel arriving beside
 * it. The browser's view transition does the morph: the thing on screen and
 * the thing that replaces it share one name for the length of the move.
 *
 * It stands down, and the change simply happens, when the request came from
 * the keyboard, when another transition is running, when there is nothing on
 * screen to grow from, or when `axonix.next.vt` is `off` in localStorage.
 */
import { flushSync } from 'react-dom';

type Transition = { finished: Promise<void> };
type Starter = (update: () => void | Promise<void>) => Transition;

/** The name both ends of the move carry. `next-modules.css` ("Calm") gives a panel this name while one runs. */
const NAME = 'nx-thing';

function off(): boolean {
  try {
    return localStorage.getItem('axonix.next.vt') === 'off';
  } catch {
    return false;
  }
}

export function becomes(from: Element | null, change: () => void): void {
  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: Starter }).startViewTransition;
  if (!(from instanceof HTMLElement) || !start || off() || root.dataset.nxInput === 'key' || root.dataset.nxVt || root.dataset.nx !== 'true') {
    change();
    return;
  }
  from.style.viewTransitionName = NAME;
  root.dataset.nxVt = 'becomes';
  const done = () => {
    from.style.viewTransitionName = '';
    delete root.dataset.nxVt;
  };
  try {
    start
      .call(document, async () => {
        from.style.viewTransitionName = '';
        flushSync(change);
        // A panel opens its dialog in an effect: let that run before the picture is taken. A timer, not a
        // frame: the browser draws no frames while it waits for this, so a frame would never come.
        await new Promise<void>((next) => setTimeout(next, 0));
        await new Promise<void>((next) => setTimeout(next, 0));
      })
      .finished.then(done, done);
  } catch {
    done();
    change();
  }
}

/** The row, card or action on the page that stands for a task. */
export const taskOnPage = (id: string): Element | null => document.querySelector(`.nx-scroll [data-lift="task:${CSS.escape(id)}"]`);
