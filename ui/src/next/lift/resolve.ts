/**
 * What is under the pointer, as a thing. This is what makes everything
 * liftable: a component does not have to opt in.
 *
 * Tried in this order, nearest first:
 *
 *   1. **Selected text** under the pointer: those words.
 *   2. **A named thing**: the closest element carrying `liftAttrs(thing)` (a
 *      transaction row, a task card, an account). The best answer, because it
 *      has an id the modules know.
 *   3. **An image** or a **link**.
 *   4. **Any other component**, read off the page: a short one (a figure, a
 *      heading, a chip, a button) lifts as its words, with the label beside it
 *      for context; a larger one (a card, a chart, a panel, a list, a whole
 *      view) lifts as a *part* of the page, named by its heading and holding
 *      its text. A part's id is where it is (`finance/overview#net-worth`), so
 *      it can be kept, linked and found again.
 *
 * A place marked `data-lift-private` (the Digital IDs page) is never read: a
 * part of it lifts by name only, and an identity document lifts as what it is
 * and when it ends, never its number.
 *
 * A component can name itself for this without naming a thing: `data-lift-title`
 * (or `aria-label`) is its title, `data-lift-part` makes any element a part.
 *
 * A few things are never lifted, because a press on them already means
 * something else: a field being typed in, a web page, a slider, a handle that
 * resizes, the dock's own tiles.
 */
import { imageThing, linkThing, slugOf, textThing, thingOf, type Thing } from './things';

export interface Found {
  /** The element that stands for the thing: what dims while it is held. */
  el: HTMLElement;
  thing: Thing;
  /** Lifts as soon as the pointer moves (a row). Everything else lifts when held still. */
  quick: boolean;
  /** It carries `liftAttrs`. */
  named: boolean;
  /** Needs the longer hold: it was read off the page, or the press was on a control inside a row. */
  slow: boolean;
}

/** Presses that already mean something else. */
const NEVER =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], webview, iframe, [role="slider"], [role="scrollbar"], [role="separator"], .nx-ruler, .nx-ghost, .nx-dock, .titlebar, .palette, [data-sonner-toaster], [data-lift-none]';
/** Controls inside a named row: a press on one is the control's, so the row waits for a still hold. */
const INNER = 'button, a, input, textarea, select, [contenteditable="true"], [role="checkbox"], .nxc-block__grip';
const HANDLE = /(^|[-_])(divider|resizer|resize|handle|grip|thumb|scrollbar|knob)$/;

const LEAF = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, label, blockquote, figcaption, summary, td, th, button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], time, .fin-num';
const BLOCK_TAGS = new Set(['SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'FORM', 'TABLE', 'UL', 'OL', 'DL', 'FIGURE', 'NAV', 'MAIN', 'DETAILS', 'FIELDSET']);
const BLOCK_ROLES = new Set(['dialog', 'tooltip', 'menu', 'listbox', 'region', 'group', 'tabpanel', 'status', 'alert', 'navigation', 'img']);
/** Containers: a part of the page whatever they hold, when they have a name of their own. */
const CONTAINER_CLASS = /(^|[-_])(card|panel|tile|widget|chart|sky|pop|popover|menu|tip|tooltip|section|pane|side|grid|month|week|agenda|hero|worth)$/;
/** Smaller pieces: their words when short, a part when long. */
const PIECE_CLASS = /(^|[-_])(group|list|row|block|chip|pill|cell|bar|item|line|stat|figure)$/;
const LABEL = '[class*="label"], [class*="Label"], dt, label, h1, h2, h3, h4, h5, h6';
const HEADING = 'h1, h2, h3, h4, h5, [class*="__title"], [class*="-title"], [class*="__head"] b, [class*="__label"], [class*="-label"]';

/** Words longer than this are a part of the page; shorter, they are just words. */
const SHORT = 160;
const TEXT_CAP = 8000;

const classes = (el: Element) => (typeof el.className === 'string' ? el.className.split(/\s+/) : []);
const isHandle = (el: Element) => classes(el).some((c) => HANDLE.test(c));
const isContainer = (el: Element) => BLOCK_TAGS.has(el.tagName) || BLOCK_ROLES.has(el.getAttribute('role') ?? '') || el.hasAttribute('data-lift-part') || classes(el).some((c) => CONTAINER_CLASS.test(c));
const isPiece = (el: Element) => classes(el).some((c) => PIECE_CLASS.test(c));
/** As written, not as styled: a label set in capitals by CSS is still "Net worth". */
const written = (el: Element | null) => clean(el?.textContent ?? '').split('\n')[0];
const clean = (text: string) =>
  text
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** A place whose text must never be read off the screen (a page that can show an ID number). */
const PRIVATE = '[data-lift-private]';
const isPrivate = (el: Element) => Boolean(el.closest(PRIVATE) || el.querySelector(PRIVATE));

/** The module and view an element is on, from the shell around it. */
export function whereOf(el: Element | null): { module: string; view: string; label: string; at: string } {
  const shell = el?.closest<HTMLElement>('.nx') ?? document.querySelector<HTMLElement>('.nx');
  const module = shell?.dataset.module ?? 'axonix';
  const view = shell?.dataset.view ?? '';
  const shown = view.startsWith('p:') ? view.slice(2) || 'Inbox' : view;
  return { module, view, at: view && view !== module ? `${module}/${view}` : module, label: `${cap(module)}${shown && shown !== module ? ` · ${cap(shown)}` : ''}` };
}

/** A component's own name: what it says it is, or its heading. Empty when it has neither. */
function nameOf(el: HTMLElement): string {
  const named = el.getAttribute('aria-label') ?? el.dataset.liftTitle;
  if (named?.trim()) return named.trim().slice(0, 80);
  const head = el.matches(HEADING) ? el : el.querySelector<HTMLElement>(HEADING);
  // The heading has to be this component's own: a grid of cards is not named after its first card.
  for (let up = head?.parentElement; up && up !== el; up = up.parentElement) if (isContainer(up)) return '';
  return written(head).slice(0, 80);
}

/** The label a short thing sits under: the label just before it, or the heading of what it is in. */
function labelFor(el: HTMLElement): string {
  const before = el.previousElementSibling;
  if (before?.matches(LABEL)) {
    const said = written(before);
    if (said && said.length <= 60) return said;
  }
  for (let up = el.parentElement, depth = 0; up && depth < 5 && !up.matches('.nx, .nx-sheet, body'); up = up.parentElement, depth++) {
    const head = up.querySelector<HTMLElement>(LABEL);
    if (head && !head.contains(el) && !el.contains(head)) {
      const said = written(head);
      if (said && said.length <= 60) return said;
    }
  }
  return '';
}

/** Where a part is: `finance/overview#net-worth`. The whole view is `finance/overview`. */
function partOf(el: HTMLElement, text: string): Thing {
  const where = whereOf(el);
  const whole = el.matches('.nx-sheet, .nx-sheet__page, .nx-main, .nx-scroll, main');
  const title = whole ? where.label : nameOf(el) || text.split('\n')[0].slice(0, 80) || 'This part';
  return { kind: 'part', id: whole ? where.at : `${where.at}#${slugOf(title)}`, title, sub: whole ? 'This view' : where.label, text: text.slice(0, TEXT_CAP), at: where.at };
}

function selectionAt(x: number, y: number): { text: string; el: HTMLElement } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim();
  if (text.length < 2) return null;
  const range = sel.getRangeAt(0);
  for (const r of range.getClientRects()) {
    if (x < r.left - 2 || x > r.right + 2 || y < r.top - 2 || y > r.bottom + 2) continue;
    const node = range.commonAncestorContainer;
    const el = node instanceof HTMLElement ? node : node.parentElement;
    return el && !isPrivate(el) ? { text, el } : null;
  }
  return null;
}

/** Reads a component off the page. Null when this element is not one, so the search goes on up. */
function describe(el: HTMLElement): Thing | null {
  if (el instanceof HTMLImageElement) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || !el.currentSrc) return null;
    return imageThing(el.currentSrc, el.alt);
  }
  if (el instanceof HTMLAnchorElement && /^https?:/i.test(el.href)) return linkThing(el.href, written(el));
  // An entry in a sidebar is the view it opens.
  if (el.matches('.nx-nav__item[data-liquid-key]')) {
    const where = whereOf(el);
    const name = written(el.querySelector('.nxt-nav__name, .nx-nav__label') ?? el).replace(/\s*\d+$/, '');
    return { kind: 'part', id: `${where.module}/${el.dataset.liquidKey}`, title: name || 'This view', sub: `A view in ${cap(where.module)}`, at: `${where.module}/${el.dataset.liquidKey}` };
  }
  const whole = el.matches('.nx-sheet, .fin-sheet__panel');
  // Private: it can still be carried as what it is called, but nothing it shows goes with it.
  if (isPrivate(el)) {
    if (!whole && !(isContainer(el) && nameOf(el))) return null;
    const part = partOf(el, '');
    return { ...part, text: undefined };
  }
  const text = clean(el.innerText ?? '');
  if (!text) return null;
  // A whole view, a panel, or a container that has a name of its own: a part of the page.
  if (whole || (isContainer(el) && nameOf(el))) return partOf(el, text);
  if (!el.matches(LEAF) && !isPiece(el)) return null;
  if (text.length > SHORT) return partOf(el, text);
  const label = labelFor(el);
  const where = whereOf(el).label;
  const thing = textThing(text.replace(/\n+/g, ' '), label ? `${label} · ${where}` : where);
  // A figure alone says little: carried with its label, it still means something.
  if (label && !text.toLowerCase().includes(label.toLowerCase())) thing.text = `${label}: ${thing.text}`;
  return thing;
}

/** What a press at this point would lift, or null where a press already means something else. */
export function findLiftable(target: EventTarget | null, x: number, y: number): Found | null {
  let start = target instanceof Element ? target : null;
  // A press inside a drawing lands on its shapes; the drawing's own box is what is on the page.
  while (start && !(start instanceof HTMLElement)) start = start.parentElement;
  if (!(start instanceof HTMLElement)) return null;

  const picked = selectionAt(x, y);
  if (picked) return { el: picked.el, thing: textThing(picked.text, `From ${whereOf(picked.el).label}`), quick: false, named: false, slow: true };

  const row = start.closest<HTMLElement>('[data-lift]');
  if (row) {
    const thing = thingOf(row);
    if (thing) {
      const inner = start.closest(INNER);
      const onControl = Boolean(inner && inner !== row && row.contains(inner) && row.dataset.liftWrap === undefined);
      return { el: row, thing, quick: !onControl && row.dataset.liftHold === undefined, named: true, slow: onControl };
    }
  }

  if (start.closest(NEVER)) return null;
  for (let el: HTMLElement | null = start; el && el !== document.body; el = el.parentElement) {
    if (isHandle(el)) return null;
    const thing = describe(el);
    if (thing) return { el, thing, quick: false, named: false, slow: true };
    if (el.matches('.nx, dialog')) break;
  }
  return null;
}

/** Brings a part back into view and marks it for a moment. False when the page no longer has it. */
export function flashPart(id: string): boolean {
  const scope = document.querySelector('.nx-sheet');
  if (!scope) return false;
  for (const el of scope.querySelectorAll<HTMLElement>('*')) {
    if (!isContainer(el) || !nameOf(el)) continue;
    const text = clean(el.innerText ?? '');
    if (!text || partOf(el, text).id !== id) continue;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.dataset.flash = '';
    window.setTimeout(() => delete el.dataset.flash, 1400);
    return true;
  }
  return false;
}
