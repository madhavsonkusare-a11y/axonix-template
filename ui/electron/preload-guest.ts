/**
 * Runs in the top frame of every social page, in an isolated world. The site's
 * scripts cannot see it or call it.
 *
 * Four jobs:
 *   1. Unread count → the dock badge (sendToHost: the dock only).
 *   2. Notice a sign-in form, and a sign-in being submitted → main process,
 *      which decides whether to offer saving or filling.
 *   3. Put the caret in a sign-in field when the main process is about to type
 *      a saved sign-in — only ever after the owner clicks "Sign in as …".
 *   4. Say what is being dragged out of the page, for the Storeroom beside it
 *      (sendToHost), and let Alt-drag lift a photo the site has covered.
 *
 * Unread selectors adapted from ferdium-recipes (MIT, github.com/ferdium/ferdium-recipes).
 */
import { ipcRenderer } from 'electron';

const host = location.hostname.replace(/^www\./, '');
const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);

// ---------------------------------------------------------------------------
// 0. Temporary pinch zoom
//
// Windows precision touchpads surface a pinch as Ctrl+wheel. Electron's normal
// visual zoom is persistent, which is a poor fit here: this is a quick look at
// a post, not a setting. We consume that gesture, zoom the current guest page
// at once, then carry its last velocity into a light spring back to 100%.

const PINCH_MAX = 3.4;
const PINCH_SENSITIVITY = 0.006;
const PINCH_RELEASE_MS = 90;
const PINCH_STIFFNESS = 300;
const PINCH_DAMPING = 22;
let pinchZoom = 1;
let pinchVelocity = 0;
let pinchLastAt = 0;
let pinchRelease: number | null = null;
let pinchFrame: number | null = null;
let pinchOrigin = '50% 50%';
let pinching = false;
let pinchStyles: { transform: string; transformPriority: string; origin: string; originPriority: string; willChange: string; willChangePriority: string } | null = null;

/** The point under the cursor, in document pixels. */
function originAt(clientX: number, clientY: number) {
  // `documentElement` may be much taller than the viewport. Percentages would
  // resolve against that full height and pull the scale origin away from the
  // cursor after scrolling. Pixels in document space keep the hovered point
  // fixed in every page layout, including scroll containers and long feeds.
  return `${Math.max(0, clientX + scrollX)}px ${Math.max(0, clientY + scrollY)}px`;
}

function savePinchStyles() {
  if (pinchStyles) return;
  const style = document.documentElement.style;
  pinchStyles = {
    transform: style.getPropertyValue('transform'),
    transformPriority: style.getPropertyPriority('transform'),
    origin: style.getPropertyValue('transform-origin'),
    originPriority: style.getPropertyPriority('transform-origin'),
    willChange: style.getPropertyValue('will-change'),
    willChangePriority: style.getPropertyPriority('will-change'),
  };
}

function restorePinchStyles() {
  if (!pinchStyles) return;
  const style = document.documentElement.style;
  for (const [property, value, priority] of [
    ['transform', pinchStyles.transform, pinchStyles.transformPriority],
    ['transform-origin', pinchStyles.origin, pinchStyles.originPriority],
    ['will-change', pinchStyles.willChange, pinchStyles.willChangePriority],
  ] as const) {
    if (value) style.setProperty(property, value, priority);
    else style.removeProperty(property);
  }
  pinchStyles = null;
}

function setPinchZoom(next: number, allowUndershoot = false) {
  pinchZoom = Math.max(allowUndershoot ? 0.98 : 1, Math.min(PINCH_MAX, next));
  if (pinchZoom === 1 && !allowUndershoot) {
    restorePinchStyles();
    return;
  }
  savePinchStyles();
  const style = document.documentElement.style;
  // This is visual, not Chromium layout zoom. Every piece of the guest page —
  // including Reddit's max-width feed — scales together without a responsive
  // layout recalculation.
  style.setProperty('transform', `scale(${pinchZoom})`, 'important');
  style.setProperty('transform-origin', pinchOrigin, 'important');
  style.setProperty('will-change', 'transform', 'important');
}

function stopPinchSpring() {
  if (pinchFrame !== null) cancelAnimationFrame(pinchFrame);
  pinchFrame = null;
}

function releasePinch() {
  stopPinchSpring();
  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    // A modest under-damped spring (300 / 22) gives the release its small,
    // physical settle without keeping social content in motion.
    pinchVelocity += (1 - pinchZoom) * PINCH_STIFFNESS * dt;
    pinchVelocity *= Math.exp(-PINCH_DAMPING * dt);
    setPinchZoom(pinchZoom + pinchVelocity * dt, true);
    if (Math.abs(pinchZoom - 1) < 0.001 && Math.abs(pinchVelocity) < 0.01) {
      pinchVelocity = 0;
      setPinchZoom(1);
      pinchFrame = null;
      return;
    }
    pinchFrame = requestAnimationFrame(step);
  };
  pinchFrame = requestAnimationFrame(step);
}

function schedulePinchRelease() {
  if (pinchRelease !== null) window.clearTimeout(pinchRelease);
  pinchRelease = window.setTimeout(() => {
    pinchRelease = null;
    pinching = false;
    releasePinch();
  }, PINCH_RELEASE_MS);
}

// Split view: tell the dock which pane the pointer is over — or which was
// clicked or tabbed into — so the title bar, keys and sign-in follow it. The
// host page sees neither: it gets no pointer events over a page, and the
// guest's focus events don't reach it.
//
// A moving pointer, not an entering one: `pointerenter` never fires on a
// guest's document (measured 2026-09-20), so moves are watched instead and
// throttled hard — the dock ignores the pane it already has focused, so a few
// a second is plenty.
const FOCUS_EVERY_MS = 200;
let focusSentAt = 0;
const takeFocus = () => ipcRenderer.sendToHost('axonix:focus-me');

window.addEventListener(
  'pointermove',
  () => {
    const now = performance.now();
    if (now - focusSentAt < FOCUS_EVERY_MS) return;
    focusSentAt = now;
    takeFocus();
  },
  { capture: true, passive: true },
);
window.addEventListener('pointerdown', takeFocus, { capture: true, passive: true });
window.addEventListener('focus', takeFocus);

window.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stopPinchSpring();
    // The pinch is anchored where it starts, under the cursor, and locked for
    // the gesture so the page stays under the fingers instead of re-centring.
    // (Read here, not on every pointer move: `scrollX` forces a layout.)
    if (!pinching) {
      pinchOrigin = originAt(event.clientX, event.clientY);
      pinching = true;
    }
    const now = performance.now();
    const before = pinchZoom;
    setPinchZoom(before * Math.exp(-event.deltaY * PINCH_SENSITIVITY));
    const elapsed = Math.max((now - pinchLastAt) / 1000, 1 / 120);
    pinchVelocity = Math.max(-1.8, Math.min(1.8, (pinchZoom - before) / elapsed));
    pinchLastAt = now;
    schedulePinchRelease();
  },
  { capture: true, passive: false },
);

// ---------------------------------------------------------------------------
// 0b. Two-finger swipe: back and forward
//
// A precision touchpad's horizontal two-finger swipe reaches the page as a
// wheel with `deltaX`. It navigates only when nothing under the pointer can
// scroll that way any more — a carousel, a horizontally scrolling feed or a
// code block keeps the gesture — and only once per swipe: the deltas are added
// up and the total is forgotten when the wheel burst ends. Signed travel is
// preserved while direction reverses, so the same orb follows the fingers
// back to its edge. Swipe right for back, as Chrome and Windows do.

const SWIPE_TRIGGER = 440; // deliberate horizontal travel before navigation commits
// A native gesture lifecycle from Electron owns precision-touchpad release.
// This short deadline is only a fallback for devices that emit horizontal
// mouse-wheel deltas without gestureScrollBegin/End.
const SWIPE_RELEASE_MS = 96;
const SWIPE_COMMIT_QUIET_MS = 320;
let swipeTotal = 0;
let swipeAt = 0;
let swipeSent = false;
let nativeGestureActive = false;
let swipeEnd: number | null = null;

type SwipeDirection = 'back' | 'forward';
type SwipePhase = 'move' | 'commit' | 'cancel';

function swipeDirection(): SwipeDirection {
  return swipeTotal < 0 ? 'back' : 'forward';
}

function emitSwipeFeedback(phase: SwipePhase, direction: SwipeDirection, progress: number, speed = 0) {
  ipcRenderer.sendToHost('axonix:swipe-progress', {
    phase,
    direction,
    progress: Math.min(1, Math.max(0, progress)),
    speed: Math.min(1, Math.max(0, speed)),
  });
}

function sendSwipeFeedback(phase: SwipePhase, speed = 0) {
  if (!swipeTotal) return;
  emitSwipeFeedback(phase, swipeDirection(), Math.abs(swipeTotal) / SWIPE_TRIGGER, speed);
}

function finishSwipeFeedback() {
  if (swipeEnd !== null) window.clearTimeout(swipeEnd);
  swipeEnd = null;
  if (!swipeSent) sendSwipeFeedback('cancel');
  swipeTotal = 0;
  swipeAt = 0;
  swipeSent = false;
}

function scheduleSwipeFeedbackEnd() {
  if (swipeEnd !== null) window.clearTimeout(swipeEnd);
  if (nativeGestureActive) {
    swipeEnd = null;
    return;
  }
  if (swipeSent) {
    swipeEnd = window.setTimeout(() => {
      swipeEnd = null;
      swipeTotal = 0;
      swipeAt = 0;
      swipeSent = false;
    }, SWIPE_COMMIT_QUIET_MS);
    return;
  }
  swipeEnd = window.setTimeout(finishSwipeFeedback, SWIPE_RELEASE_MS);
}

ipcRenderer.on('axonix:gesture-scroll-phase', (_event, phase: unknown) => {
  if (phase === 'begin') {
    nativeGestureActive = true;
    if (swipeEnd !== null) window.clearTimeout(swipeEnd);
    swipeEnd = null;
    return;
  }
  if (phase === 'end') {
    nativeGestureActive = false;
    if (swipeTotal) finishSwipeFeedback();
  }
});

/** Something under the pointer that can still scroll `dx`'s way. */
function scrollsHorizontally(from: EventTarget | null, dx: number): boolean {
  let el: Element | null = from instanceof Element ? from : null;
  while (el) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const style = getComputedStyle(el);
      const scrolls = /^(auto|scroll)$/.test(style.overflowX);
      const room = dx < 0 ? el.scrollLeft > 1 : el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
      if (scrolls && room) return true;
    }
    const parent: Node | null = el.parentElement ?? (el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : null);
    el = parent instanceof Element ? parent : null;
  }
  return false;
}

window.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey) return; // a pinch (above)
    const dx = event.deltaX;
    if (Math.abs(dx) < 2 || Math.abs(dx) <= Math.abs(event.deltaY) * 1.2) {
      if (swipeTotal && !swipeSent && Math.abs(event.deltaY) >= 2) finishSwipeFeedback();
      return;
    }
    const now = performance.now();
    const elapsed = swipeAt ? Math.max(8, now - swipeAt) : 16;
    swipeAt = now;
    scheduleSwipeFeedbackEnd();
    if (swipeSent) return;
    if (scrollsHorizontally(event.target, dx)) {
      sendSwipeFeedback('cancel');
      swipeTotal = 0;
      return;
    }
    const previous = swipeTotal;
    const next = previous + dx;
    // Reversal consumes the existing signed travel first. Crossing the origin
    // retracts the original orb; a continued gesture can then begin from the
    // opposite edge on the next delta instead of teleporting the lens.
    if (previous && (next === 0 || Math.sign(previous) !== Math.sign(next))) {
      const direction: SwipeDirection = previous < 0 ? 'back' : 'forward';
      emitSwipeFeedback('cancel', direction, 0, Math.abs(dx) / elapsed / 1.8);
      swipeTotal = 0;
      finishSwipeFeedback();
      return;
    }
    swipeTotal = next;
    // Continuous normalized force for the host's edge material. This is
    // decorative feedback only; the navigation threshold below is unchanged.
    const speed = Math.abs(dx) / elapsed / 1.8;
    sendSwipeFeedback('move', speed);
    if (Math.abs(swipeTotal) < SWIPE_TRIGGER) return;
    swipeSent = true;
    sendSwipeFeedback('commit', speed);
    scheduleSwipeFeedbackEnd();
    ipcRenderer.sendToHost('axonix:swipe', swipeDirection());
  },
  { capture: true, passive: true },
);

// ---------------------------------------------------------------------------
// 1. Unread count

const number = (el: Element | null | undefined) => {
  const n = parseInt((el?.textContent ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
};

/** "(3) Home / X", "(12) Feed | LinkedIn". */
const fromTitle = () => {
  const m = /^\((\d+)\+?\)/.exec(document.title.trim());
  return m ? parseInt(m[1], 10) : 0;
};

function unread(): number {
  let n = 0;
  if (on('instagram.com')) n = number(document.querySelector('a[href^="/direct/inbox"] span'));
  else if (on('x.com') || on('twitter.com'))
    n =
      number(document.querySelector('[data-testid=AppTabBar_Notifications_Link] div div div')) +
      number(document.querySelector('[data-testid=AppTabBar_DirectMessage_Link] div div div'));
  else if (on('reddit.com')) n = number(document.querySelector('#HeaderUserActions--Messages > a > span'));
  else if (on('linkedin.com'))
    n = [...document.querySelectorAll('.global-nav__primary-item .notification-badge__count, .nav-item__badge-count')].reduce((sum, el) => sum + number(el), 0);
  return Math.max(n, fromTitle());
}

// ---------------------------------------------------------------------------
// 2. Sign-in forms

const USERNAME = [
  'input[autocomplete~="username"]',
  'input[autocomplete~="email"]',
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  'input[name="session_key"]',
  'input[name="login"]',
  'input[name*="user" i]',
  'input[id*="username" i]',
  'input[id*="email" i]',
].join(', ');

const textual = (i: HTMLInputElement) => i.type === 'text' || i.type === 'email' || i.type === 'tel' || i.type === '';

function shown(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly || el.type === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Reddit draws its sign-in inside shadow roots; everyone else uses the plain DOM. */
function inputs(): HTMLInputElement[] {
  const out: HTMLInputElement[] = [...document.querySelectorAll('input')];
  if (on('reddit.com')) {
    const visit = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          out.push(...el.shadowRoot.querySelectorAll('input'));
          visit(el.shadowRoot);
        }
      }
    };
    visit(document);
  }
  return out.filter(shown);
}

function fields(): { user?: HTMLInputElement; pass?: HTMLInputElement } {
  const all = inputs();
  const pass = all.find((i) => i.type === 'password');
  if (pass) {
    const before = all.slice(0, all.indexOf(pass)).filter(textual);
    const user = [...before].reverse().find((i) => i.matches(USERNAME)) ?? before[before.length - 1];
    return { user, pass };
  }
  // A username-only step (X asks for the username first). Only a field that
  // says it is one, so search boxes never count.
  return { user: all.find((i) => textual(i) && i.matches('input[autocomplete~="username"]')) };
}

let formShown = false;
let lastUser = '';
let lastSent = { user: '', pass: '', at: 0 };

function capture() {
  const { user, pass } = fields();
  const password = pass?.value ?? '';
  const username = user?.value.trim() || lastUser;
  if (!password || !username) return;
  const now = Date.now();
  if (lastSent.user === username && lastSent.pass === password && now - lastSent.at < 5000) return;
  lastSent = { user: username, pass: password, at: now };
  ipcRenderer.send('guest:credential', { username, password });
}

const SUBMITS = /\b(log\s?in|sign\s?in|continue|next|submit)\b/i;

function watchSignIn() {
  // Remember the username typed on a first step, for the password step after it.
  document.addEventListener(
    'input',
    (e) => {
      const el = e.composedPath()[0];
      if (el instanceof HTMLInputElement && textual(el) && el.matches(USERNAME) && el.value.trim()) lastUser = el.value.trim();
    },
    true,
  );
  document.addEventListener('submit', () => capture(), true);
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && e.composedPath()[0] instanceof HTMLInputElement) capture();
    },
    true,
  );
  document.addEventListener(
    'click',
    (e) => {
      if (!formShown) return;
      const button = (e.composedPath() as Element[]).find(
        (el) => el instanceof HTMLElement && (el.matches('button, input[type="submit"], [role="button"]')),
      ) as HTMLElement | undefined;
      if (!button) return;
      const label = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''} ${(button as HTMLInputElement).value ?? ''}`;
      if ((button as HTMLButtonElement).type === 'submit' || SUBMITS.test(label)) capture();
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// 3. Filling
//
// The main process does the typing (`insertText`, which pages see as real
// input). This only puts the caret in the right field first.

ipcRenderer.on('axonix:focus', (_e, which: unknown) => {
  const { user, pass } = fields();
  const el = which === 'user' ? user : which === 'pass' ? pass : undefined;
  if (el) {
    el.focus();
    el.select();
  }
  ipcRenderer.send('guest:focused', which, Boolean(el));
});

// ---------------------------------------------------------------------------
// 4. Watching
//
// The unread count is a few lookups, so it is read every 1.5s, on screen or
// not — a badge matters most for the apps you aren't looking at. Looking for a
// sign-in form costs more (on Reddit it walks every shadow root: ~40ms), so it
// only runs while the page is on screen, and only after something that can
// bring a form up (a load, a click, a key, a navigation) or every 5s otherwise.
// The main process says whether the page is on screen (background.ts); a page
// off screen for long is frozen there and runs nothing at all.

const FORM_RECHECK_MS = 5000;
let badge = -1;
let onScreen = true;
let formDirty = true;
let formCheckedAt = 0;

function checkForm() {
  formDirty = false;
  formCheckedAt = performance.now();
  const { user, pass } = fields();
  const present = Boolean(pass || user);
  if (present !== formShown) {
    formShown = present;
    ipcRenderer.send('guest:login-form', present);
  }
}

function tick() {
  const n = unread();
  if (n !== badge) {
    badge = n;
    ipcRenderer.sendToHost('axonix:badge', n);
  }
  if (onScreen && (formDirty || performance.now() - formCheckedAt > FORM_RECHECK_MS)) checkForm();
}

const dirty = () => {
  formDirty = true;
};

ipcRenderer.on('axonix:shown', (_e, shown: unknown) => {
  onScreen = shown !== false;
  if (onScreen) formDirty = true;
});

window.addEventListener('DOMContentLoaded', () => {
  watchSignIn();
  for (const type of ['click', 'focusin', 'keyup', 'popstate', 'load']) window.addEventListener(type, dirty, { capture: true, passive: true });
  (window as unknown as { navigation?: EventTarget }).navigation?.addEventListener('navigatesuccess', dirty);
  tick();
  setInterval(tick, 1500);
});

// ---------------------------------------------------------------------------
// 5. Dragging into the Storeroom
//
// With Social open beside the Storeroom, a picture or link dragged out of the
// page tells the host what it is: the picture's own address, the post it came
// from, and its alt text. The Storeroom then saves it through this app's
// session (full size, signed in) instead of guessing from the drop. Only real
// drags count — a site's scripts can dispatch a fake dragstart, not a trusted one.
//
// Hold Alt to drag the picture under the pointer even where the site lays a
// clear layer over it (Instagram does, over every photo): for that one press
// the top element becomes draggable, and the drag carries the picture's address.

interface Picked {
  el: HTMLImageElement | HTMLVideoElement;
  src: string;
  alt: string;
}

/** The picture under a point, beneath any layers the site put on top of it. */
function pictureAt(x: number, y: number): Picked | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el instanceof HTMLImageElement) {
      const src = el.currentSrc || el.src;
      if (/^https?:/.test(src)) return { el, src, alt: el.alt };
    }
    if (el instanceof HTMLVideoElement) {
      const src = el.currentSrc || el.src;
      // Streamed video (blob:) has no address to fetch; its poster still does.
      if (/^https?:/.test(src)) return { el, src, alt: '' };
      if (/^https?:/.test(el.poster)) return { el, src: el.poster, alt: '' };
    }
  }
  return null;
}

let assisted: { el: HTMLElement; draggable: string | null; picked: Picked } | null = null;

function unassist() {
  if (!assisted) return;
  if (assisted.draggable === null) assisted.el.removeAttribute('draggable');
  else assisted.el.setAttribute('draggable', assisted.draggable);
  assisted = null;
}

window.addEventListener(
  'pointerdown',
  (event) => {
    if (!event.isTrusted || !event.altKey || event.button !== 0 || !(event.target instanceof HTMLElement)) return;
    const picked = pictureAt(event.clientX, event.clientY);
    if (!picked || event.target === picked.el) return;
    assisted = { el: event.target, draggable: event.target.getAttribute('draggable'), picked };
    event.target.draggable = true;
  },
  { capture: true, passive: true },
);
window.addEventListener('pointerup', unassist, { capture: true, passive: true });

window.addEventListener(
  'dragstart',
  (event) => {
    if (!event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const picked = assisted?.picked ?? (target instanceof HTMLImageElement && /^https?:/.test(target.currentSrc || target.src) ? { el: target, src: target.currentSrc || target.src, alt: target.alt } : pictureAt(event.clientX, event.clientY));
    const anchor = target?.closest('a[href]');
    const link = anchor instanceof HTMLAnchorElement && /^https?:/.test(anchor.href) ? anchor.href : null;
    if (assisted && picked && event.dataTransfer) {
      event.dataTransfer.setData('text/uri-list', picked.src);
      event.dataTransfer.setData('text/plain', picked.src);
      event.dataTransfer.effectAllowed = 'copy';
      const box = picked.el.getBoundingClientRect();
      event.dataTransfer.setDragImage(picked.el, Math.min(box.width, Math.max(0, event.clientX - box.left)), Math.min(box.height, Math.max(0, event.clientY - box.top)));
    }
    if (!picked && !link) return;
    ipcRenderer.sendToHost('axonix:drag', {
      src: picked?.src ?? null,
      alt: (picked?.alt ?? '').slice(0, 300),
      link,
      page: location.href,
      title: document.title.slice(0, 300),
    });
  },
  true,
);

// Where the drag ended, in this page's coordinates (left of 0 is beside the
// page): the Storeroom's fallback when a drop never reaches the host page.
window.addEventListener(
  'dragend',
  (event) => {
    unassist();
    if (event.isTrusted) ipcRenderer.sendToHost('axonix:drag-end', { x: event.clientX, y: event.clientY });
  },
  true,
);
