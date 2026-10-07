# Axonix — Design

The design system as built, and the intent behind it: what the owner has asked for, what they
rejected, and the rules every screen follows. Read this before designing or changing any surface.
For how to change the app *safely* (data + rebuild), follow
[`.claude/skills/axonix-safe-change/SKILL.md`](.claude/skills/axonix-safe-change/SKILL.md).

- Tokens: [`ui/src/styles/tokens.css`](ui/src/styles/tokens.css) (shell + `--fin-*` layer)
- Surfaces: [`finance.css`](ui/src/styles/finance.css) (frames) · [`finance-interactions.css`](ui/src/styles/finance-interactions.css) (sheets, forms, lists)
- Original handoff: [`docs/Finance tracker frontend design/`](docs/Finance%20tracker%20frontend%20design/design_handoff_axonix_dashboards/README.md)

> **Overhaul in progress — Paper + Glass (owner, 2026-10-01/02).** Where this file and the new
> direction disagree, the new direction wins for any surface that has been rebuilt. That is now
> every module: **Home**, **Finance**, **Tasks**, **Calendar**, **Notes**, **Storeroom** and **Social** run in the
> new shell; §16 is their spec. §1–15 describe the first versions.
> The 2026-09-28 direction (pull-back startup, ice-blue accent, glass on cards) is retired — see the
> Decision Log. Each first version is kept and opens as **Legacy …** from its module's sidebar or Ctrl K.

---

## 1. Who it is for, and what they asked for

A personal, **local-first** desktop app (Electron, Windows) used daily by one person in India to see
and manage their money and identity documents. It must feel like a premium native app — Apple-grade
polish — not a web dashboard.

What the owner has said, and what it means for design:

| Owner input | Design consequence |
|---|---|
| The first interaction layer "is not up to the standard of the main UI" | Every sheet, form and list is held to the frames' finish: same radii, type, spacing, motion. No default browser controls on show. |
| Add a **liquid effect** (quickLiquid) | Real refracting glass — but only on floating and selection layers (§6). |
| List **my real accounts** (SBI, ICICI, Groww, Thomas Cook forex, SBI PF, Jar; GPay / WhatsApp / POP; PayPal, Link) | The app starts from the owner's setup, not generic sample data. UPI apps and wallets are *ways to pay*, not accounts (§8). |
| Use the **icons of all these services**; later, supplied official Mastercard and Jar files | Real brand marks everywhere a brand appears, stored locally. Owner-supplied files win over sourced ones. Jar's mark is used **without its wordmark**. |
| A section for **digital IDs**, DigiLocker-style | Digital IDs: masked by default, copy in one tap, expiry warnings, DigiLocker marker, links to the issuing portals. |
| Clicking a card should show **details first**, with edit inside, plus **links to the official websites** | Read → act. Clicking anything opens a details sheet; Edit is a button there, never the first thing (§7). |
| Entering **0** must show **₹0**, not "balance not set" | Zero is a real value. "Not set" only means *no value was ever entered*. |
| Remove the **"Start with today's balances"** banner | No onboarding banners or nags. Empty states live inside the card they describe, quietly. |
| Transaction entry is the **biggest blocker** | Entry is one line of text and one keystroke (§7). |
| Account cards (Groww) should be **no bigger than the bank cards**, and then **square, so they are distinguishable** from debit/credit cards | Two shapes: physical cards are 360px at the card ratio; accounts without a card are 227px squares, as tall as a card (§5). |
| **Never delete my data** (after a sandboxed relaunch made it look deleted) | Tools resolve the real data file and prove it; the app refuses to start where it can't see the real file (see the safe-change skill). |
| Move **SI** inside the account, with a section to set it up — **not in Subscriptions** | Standing instructions live in the account's details sheet and on the account record, never as a subscription (§7). |
| App icons showed **white streaks** where their corners met the UI's corners | The tile's radius is the only corner an icon has; full-bleed icons sit on nothing (§10). |
| Top-bar buttons were **only clickable in part** | Window chrome never sits on top of a control. Empty space in the top 38px drags the window (§7). |
| The gold chart was wrong — **the Indian rate**, in the app's style, **with a golden line** | Market data comes from the Indian benchmark (IBJA), is labelled with its source and date, and is drawn like the net-worth chart, but in gold (§3). Nothing is estimated or invented (§7). |
| **Never erase or change my data** unless I say so; **rebuild after every change** | Destructive actions are behind inline confirmation, undoable, and backed up first. Data safety is a design constraint, not just engineering. |
| Laptop at home, phone everywhere | Mobile capture is researched ([06 note](docs/plan/06%20Account%20Linking%20%26%20Mobile%20Capture.md)); the desktop UI stays desktop-first for now. |
| **All my social apps** in one place — app icons, no URL, **stay signed in** | Axonix Social (§13): one page per app in its own saved session, a dock of store icons, no address bar anywhere. |
| UI **like the latest macOS**, the rail as **a pill or a dock**, **with animations** | A Liquid Glass dock that magnifies, rounded page card, directional slides, an Overview after Mission Control (§13). |
| Didn't accept Tauri's limits (no overlays, Google sign-in blocked) — **find something better** | The whole app moved to Electron; Tauri is retired (Decision Log, 2026-09-16 REVERSAL). |
| **A password saver** | Built in: save on sign-in, fill on request, stored in Windows Credential Manager, never in a file (§13). |
| A **task tracker**: a dashboard with the **kanban below it**, a markdown editor, Google Calendar; custom dashboards later; **make the UI look good** | Axonix Tasks (§14): one markdown file per task in the vault, a four-widget dashboard over a five-column board, the Finance shell in the Tasks tile's light blue. |

Four adjectives from the implementation plan act as rejection criteria: **Dense · Precise · Alive · Local.**

---

## 2. Two surfaces, one token file

| Surface | Where | Palette |
|---|---|---|
| **Shell** — window chrome, command palette, error boundary | `app.css`, `Titlebar.tsx`, `CommandPalette.tsx` | **Monochrome** (tokens without `--fin-`) |
| **Launcher + Finance** — Home tiles, tracker, sheets | `finance.css`, `finance-interactions.css` | **Dark, with hue** (`--fin-*`) |
| **Axonix Social** — dock, page card, overview | `social.css` (Electron app, same tokens) | **Dark, with hue** (`--fin-*`, amber wash) |
| **Axonix Tasks** — rail, dashboard, board, task sheet | `tasks.css` (on top of the finance surface) | **Dark, with hue** (`--fin-*`, light-blue backdrop, `--tsk-*` accents) |
| **Axonix Storeroom** — rail, add field, masonry, item sheet | `storeroom.css` (on top of the finance surface) | **Dark, with hue** (`--fin-*`, `--str-*` tan accents) |

Hue is spent **only** inside the launcher and the tracker, where it carries meaning. The shell and
every trust affordance stay monochrome so colour never becomes the only signal. Finance is **dark only**.

---

## 3. Colour

### Ground and surfaces
| Token | Value | Use |
|---|---|---|
| `--fin-bg` | `#06070a` | Page |
| `--fin-bg-rail` | `#090b0f` | Nav rail |
| `--fin-card-base` | `#0b0d12` | Base under aurora cards |
| `--fin-card-fill` | `linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.02))` | Glass card |
| `--fin-card-fill-hi` | `… .07 → .022` | Hero card |
| `--fin-card-border` / `-hi` | `rgba(255,255,255,.075)` / `.09` | Card hairline |
| `--fin-hairline` | `rgba(255,255,255,.06)` | Row dividers |

**No purple anywhere** (owner, 2026-09-19: "Remove purple … Use Light blue instead"). What was violet is
light blue (`#7cc4ff`, text `#bfe3ff`); pink `#f7a8c8` and tan `#e0b089` fill the category and project
palettes where a second hue is needed.

**Backdrop** (`ui/src/Backdrop.tsx`), behind Home, Finance and Tasks: a still mesh gradient with film
grain, after Apple's recent wallpapers — light blue fields melting into near-black. Drawn once by Paper
Shaders' `MeshGradient` (Apache-2.0) at `speed={0}`, so there is no animation loop after the first frame.
Each surface has its own tone (`home`, `finance`, `tasks`). Grain comes from the shader
(`grainMixer .22`, `grainOverlay .3`) plus `assets/grain.svg` (overlay blend, opacity .2–.3). The backdrop
is a masked *sibling* of the page (520px tall in Finance and Tasks, fading downward; a radial fade on
Home), never an ancestor of a glass surface. Where WebGL is missing, the CSS gradient underneath shows.

### Ink
`--fin-text #f7f9fc` · `--fin-text-2 #eef2f9` · `--fin-text-3 rgba(235,240,250,.84)` ·
`--fin-text-muted rgba(226,234,252,.5)` · `--fin-text-faint rgba(226,234,252,.36)`.
Uppercase micro-labels sit at `rgba(226,234,252,.42–.46)`.

### Accent and signal
| Token | Value | Only for |
|---|---|---|
| `--fin-accent` | `#5b8cff` | Charts, selected chips, badges, focus-within borders |
| `--fin-accent-2` / `-3` | `#7cc4ff` / `#6f9dff` | Gradient partners |
| `--fin-accent-text` | `#9db9ff` | Accent-coloured type, text links |
| `--fin-action` | `#0071e3` | **The one filled button** per view (Apple blue) |
| `--fin-positive` | `#5fe0a2` | Income, saved state, valid chips |
| `--fin-negative` / `-text` | `#ff6b6b` / `#ffa1a1` | Over-limit, negative balances, destructive links |
| amber | `#ffc496` | "Renew soon" |

Selected chip recipe: `background rgba(91,140,255,.16)` · `border rgba(91,140,255,.5)` · text `#e3ebff`.

### Aurora hues (account cards, launcher tiles)
Radial wash from the bottom edge: white core → light → mid → deep → transparent, over a 6px dot grid
and grain. Bottom-row ink is **dark**, matched to the hue — the only place type goes dark.

| Hue | Stops (22% / 44% / 70%) | Ink |
|---|---|---|
| blue | `rgba(143,176,255,.85)` / `rgba(91,140,255,.6)` / `rgba(40,44,130,.3)` | `#0a0f1e` |
| violet (drawn light blue; the stored name stays) | `rgba(168,220,255,.85)` / `rgba(74,163,239,.6)` / `rgba(24,70,120,.3)` | `#06121f` |
| green | `rgba(160,230,200,.82)` / `rgba(95,224,162,.52)` / `rgba(28,80,66,.3)` | `#0a1c16` |
| amber | `rgba(255,196,150,.82)` / `rgba(255,138,110,.52)` / `rgba(120,50,45,.3)` | `#22100a` |

**Gold** is the one chart drawn in its material's colour instead of the accent: line gradient
`#e0a53a → #f6cf63 → #ffe29a`, fill `#f2c14e` at 34% fading to 0, dot `#fff4d6` with a gold halo.

Defined as `.fin-hue-*` classes in `finance.css`. An account becomes an aurora card only when the
owner gives it a hue.

---

## 4. Type

| Role | Family | Notes |
|---|---|---|
| UI text | `--font-ui`: Geist → **Segoe UI Variable** on Windows (Geist is not bundled) | Headings carry negative tracking |
| **Every figure** | **Azeret Mono**, self-hosted (latin + latin-ext for `₹`) | `tabular-nums`, tracking −.03em; −.04 to −.045em at ≥ 16px |
| Paths, IDs | `--font-mono` (Geist Mono → Cascadia Code) | Shell only |
| Chart labels | `--font-data` (Instrument Sans) | Reserved by the implementation plan; not used yet — finance charts label in Azeret |

Two UI families at most (the plan's rule); Azeret counts as the numeral face, not a third UI font.

Scale in use — text: 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 16 / 17 / 30 / 52px.
Figures: 10.5 / 11 / 12 / 13 / 14 / 16 / 21 / 26 / 27 / 30 / 34 / 38 / 40 / 42px.
Uppercase labels: 10.5–11px, tracking `.08–.12em`. Page titles: 30px / 600 / −.028em.
Azeret numerals are wide: never enlarge a figure without re-measuring its container.

---

## 5. Shape, space, depth

- **Radii — two families.** Pills `--fin-r-pill 980px` (every button, chip, badge, progress bar,
  segmented control). Cards: `--fin-r-tile 16` · `--fin-r-card 18` · `--fin-r-hero 20` ·
  `--fin-r-frame 22` (wallet front) · sheet `24`. Glyphs `--fin-r-glyph 8`. Inputs `12` (`10` small).
  Brand tiles ≈ 28% of their size; round when inside a chip.
- **Spacing** on a 4px base. **Dense vs comfortable:** the shell and vault UI stay *Dense* (8/12px,
  rarely past `--sp-4`). The finance surface deliberately sits at the comfortable end, per its
  design handoff: 14 / 16 / 18 / 22 / 24 / 32px gaps. Page padding `30px 36px`; card padding
  `20px 22px`. "Dense" still applies there as *no empty chrome*: every card carries real figures.
- **Depth is a lighter surface plus a hairline**, not a shadow. Shadows are reserved for things that
  genuinely float: the wallet's front card, sheets (engine elevation) and toasts.
- Layout: rail `232px` + content. Overview `1fr + 372px`. Collapse order: right column first
  (< 1100px), rail last (< 900px, icons only). Card grids use `auto-fill` with a fixed minimum; the
  launcher is 4-up or 2×2, **never 3 + 1**.
- **Card shape tells you what it is:** physical cards (debit, credit, forex) stack at 360px and the
  1.586 card ratio. Accounts without a card (demat, PPF, gold) are **227px squares**, the height of
  a card, so each row lines up. Tracks are fixed, never `1fr`, which stretched a lone card. Squares
  use a 22px balance and a wrapping foot.

---

## 6. Motion and liquid glass

Motion follows Emil Kowalski's rules (skills in `.claude/skills/`: `emil-design-eng`, `animate`,
`review-animations`, `improve-animations`, `find-animation-opportunities`) and Apple's (`apple-design`).
Check any new motion against `review-animations` before shipping it.

- **Tokens:** `--dur-fast 120ms` (hover), `--dur-press 160ms`, `--dur-base 180ms`, `--dur-med 200ms`,
  `--dur-slow 240ms`, `--dur-exit 150ms`;
  `--ease-out cubic-bezier(.16,1,.3,1)` for entering, exiting and press, `--ease-in-out
  cubic-bezier(.77,0,.175,1)` for movement on screen. Never `ease-in`, never `transition: all`.
- **Full motion, always (owner's choice, expanded app-wide 2026-09-20):** every entrance, exit and
  spring plays throughout Axonix, whether the pointer or keyboard started it and whatever Windows'
  "Animation effects" setting says. There is no `prefers-reduced-motion` branch in the code at all;
  third-party engines that reduce motion on their own are overridden (quick-liquid in `Liquid.tsx`,
  sonner in `finance-interactions.css`). The command palette fades in (`--dur-fast`).
- **Sheets:** in 280ms (translate 14px + scale .975), out 150ms (fade + 8px) — leaving is faster than
  arriving. The panel keeps its last content while it leaves. A details sheet handing off to its
  editor closes at once: one sheet at a time.
- **Press feedback everywhere:** every pressable answers the cursor — `scale(.97)` for chips, tabs and
  icon buttons, `.985` for cards, `transform var(--dur-press) var(--ease-out)`. A pressable with no
  `:active` state is a bug (audit, 2026-09-20).
- **Nothing animates in a field you type into:** the add field's reading panel is a 90ms fade with no
  movement, and its tokens and Add pill simply appear. Motion on a keyboard-driven surface reads as lag.
- **Layout properties are never animated:** `top`, `left`, `height` and `width` move by `transform`
  instead (the dock's tooltip slides on `y`, the split divider's grip grows by `scaleY`).
- **Menus and bubbles grow from their source** — the pointer, the chosen item over a pop-up button,
  or the button that asked — from scale .9–.97 with opacity, 140–180ms. Never from scale(0).
- **Press feedback everywhere pressable:** pills, chips, pop-up buttons, alert buttons `.97`; icon
  buttons `.94`; cards that open something `.985`; each with a `transform 120ms` transition. Hover lifts
  only under `(hover: hover) and (pointer: fine)`.
- **Compositor only:** progress bars reveal with `clip-path` (not width); the gold-chart dot moves by
  `transform`; the card stack animates a full `transform` string with a spring (`duration .45,
  bounce .12` — a wheel flick carries momentum), from the arrow keys too.
- **State you just made:** a newly added transaction's row tints accent and fades once (900ms, colour
  only) so you can see where it landed.
- **Not animated, on purpose:** charts and amounts (financial data you are reading should not move for
  style), page switches (core navigation), list hover.
- **Reduce Motion is not followed anywhere in Axonix**, by explicit owner choice (2026-09-20: "I dont
  want reduced motion anywhere, remove that rule globally"). There is no `prefers-reduced-motion`
  branch in the code at all: quick-liquid's scheduler is told the system never asks for less
  (`Liquid.tsx`), and sonner's own reduced-motion rule is overridden unconditionally
  (`finance-interactions.css`, MOTION POLICY). Any new one is a bug.
- **Reduce Transparency / transparency effects off:** no glass engine anywhere; menus, alerts, bubbles
  and sheets turn solid. **Increase Contrast:** brighter secondary ink, 40% borders, outlined highlight.
- **Ink contrast:** `--fin-text-muted .6` and `--fin-text-faint .5` both clear 4.5:1 on every surface
  (faint was .36, 2.9:1).

### Liquid glass (quick-liquid, MIT)
Spent on exactly two things:

1. **Selection lenses** — the nav rail and every segmented control. The lens slides with two springs:
   leading edge stiff (`520 / 34`), trailing edge soft (`260 / 25`), so it stretches toward the
   target and settles. Material `clear`, refraction 10, tint .09.
2. **Sheets** — material `thick`, blur 26, tint .44, refraction 22, radius 24. A dark base gradient
   sits underneath so text stays legible wherever refraction cannot run.

Not on cards, not on page backgrounds, not on the primary button.

**Engine rules (break these and refraction silently turns off):** no `isolation`, `filter`,
`opacity < 1`, `mask` or `mix-blend-mode` on a glass host or its ancestors; no `z-index` on the lens
layer; content inside a `.ql-content` wrapper; `border-radius` passed through config (the engine writes
it inline). Animate glass hosts with `transform` only.

---

## 7. Interaction patterns

- **Details before edit.** Clicking a card, list row, payment-app tile **or transaction** opens a
  *details* sheet; editing is a button inside. Account details: balance (or "Not set yet"), month in/out,
  card, the ways it pays out, recent activity, **official sites**, footer **Edit** + **Add transaction**.
  Transaction details: the amount (Spent / Received / Moved), day and how it was added, from / to /
  category (with **Confirm** when auto-filed), **balance after this** for every account it touched (the
  exact figure after this entry, not the day's end — several payments on one day each show their own),
  the statement's description or the note, and **Delete · Duplicate · Edit**.
- **The ledger reads in chapters (owner, 2026-09-20: "overhaul Transactions for better readability").**
  A month band (`September 2026`, with that month's out and in) opens each month; under it a **sticky
  day line** — weekday and date at 13px, how many entries, the day's net — stays pinned while its rows
  scroll past. Rows drop the redundant date column (the day line says it), give the merchant 14px, set
  the category as a **pill carrying the category's own colour dot**, and print the amount at 14px
  medium (transfers stay muted). When a search or filter is on, a line above the list says what it adds
  up to: count, out, in, net.
- **Day-end balances in the ledger.** Each day ends with where every account it touched stood at the
  end of that day — one chip, or several side by side (logo, name, amount; "not set" when no balance was
  ever entered). Filtered to an account, only that one. A chip opens the account.
- **Lists read in balance order.** Newest first is the exact reverse of the order balances are counted
  in, so reading down a day the "balance after" figures step in sequence (entries sharing a timestamp,
  like a statement's rows, fall back to reverse save order).
- **Dates are picked in the app's own calendar** (`DatePicker.tsx`), never Windows' native one: a month
  grid with today ringed and the choice filled, days out of range dimmed (a transaction cannot be in the
  future; an expiry cannot precede the issue date), the month title opens a month-and-year view, and
  Today / Clear in the footer. Arrows move by day and week, Page Up/Down by month (Shift: year),
  Escape closes only the calendar. Remaining native dropdowns became pop-up buttons (currency).
- **One-line entry.** `Ctrl+N` anywhere in the tracker → sheet with a quick-entry field:
  `250 swiggy gpay yesterday`, `1.2k blinkit`, `transfer 15k icici to groww`, `$38 … forex`. Fields
  below show the reading and stay editable. `Enter` saves from the quick field; `Ctrl+Enter` saves from
  anywhere; `Ctrl+Shift+Enter` saves and starts another.
- **Every change is undoable.** Saves, deletes, imports and confirms raise a toast with **Undo**. A
  toast's Undo only reverts its own change, never a newer one. Inside an open sheet (toasts draw
  beneath modals) the same message and Undo appear as an inline green line instead.
- **Subscriptions** are reminders, not money. Each has an amount (paise kept), a cadence (monthly,
  quarterly or yearly) and the card or app it's charged to. The next charge is **derived** from the
  schedule, so it rolls forward without rewriting data. The monthly total averages each cadence (a
  ₹1,200 yearly plan counts as ₹100). **Record** is offered only within a week of a charge date and
  opens a prefilled expense; once a matching expense exists, the row says "Recorded". Nothing is
  ever logged automatically. Reset keeps subscriptions, and deleting a payment method only unlinks it.
- **Standing instructions (PPF, RD)** are part of the account, set up in its details sheet: amount,
  next debit, Monthly / Quarterly / Yearly, and the bank account debited. The section shows the next
  debit; **Record this debit** opens a transfer already filled in for the owner to confirm. Saving an
  SI never creates a transaction by itself. SIs never appear under Subscriptions.
- **Window chrome** floats over each screen's top bar and passes clicks through. Pressing empty space
  in the top 38px drags the window, and a double press maximises it. Pressing any control never drags.
- **Market data** (Invest → gold) states its source and publish date, keeps the last copy for offline
  use (and says how old it is), and never falls back to made-up numbers. Charts you can hover show the
  exact figure and date, and arrow keys move through the days.
- **Destructive actions confirm inline** ("Delete this transaction? Delete · Keep") — no modal-on-modal.
  Accounts with history are **archived**, not deleted. Reset / demo / restore back up first.
- **Statements: CSV or PDF, checked before import.** A PDF is read in the app with pdf.js; rows and
  columns are rebuilt from where the text sits, since SBI draws its headings as shapes. A locked PDF asks
  for its password once (SBI's hint: last 5 mobile digits, then DOB as DDMMYY) and offers to remember it
  per bank in **Windows Credential Manager** — never in the data file — with "Forget it" beside the next
  statement it opens. Before anything is imported the sheet says whether the rows **match the
  statement's printed totals** or **balances add up** row to row, and names the dates where they don't.
  UPI and NEFT narrations become merchant names ("McDonalds", "Example Employer Ltd"); the full narration
  is kept as the note, and its UPI reference makes re-imports exact duplicates. **Every row can be fixed
  in place** before importing: the name is an input that reads as text until hovered, the category a
  compact picker (expense or income list to match the row). A picked category drops the `auto` chip and
  skips review; renaming a row files it under whatever that name was last filed under.
- **Components after Apple's HIG** (original builds, no Apple assets — the UI kits' licence forbids
  use for a Windows app, so only the public guideline pages were studied):
  - **Discard bubble** (after Mail's "Delete Draft"): closing a sheet with unsaved typing — ✕, Cancel,
    Escape or a click outside — raises a small bubble at the button pressed, red **Discard…** over **Keep
    editing** (focused). Escape keeps editing and puts focus back. Forms opt in with `useUnsavedChanges`.
  - **Context menu** on transaction rows (right-click, the menu key or Shift+F10): Edit, Duplicate,
    Confirm category (when auto), Copy amount, then Delete set apart in red. Leading icon column,
    inset highlight pill, arrows/Home/End/type-ahead, Escape returns focus to the row.
  - **Alert** for Delete: compact panel, left-aligned title and one sentence, stacked capsule buttons,
    focus on Cancel for destructive actions; the change still gets an Undo toast.
  - **Pop-up button** instead of native `<select>` (import categories, ledger account filter): the menu
    opens with the current choice over the button and a checkmark beside it.
  - **Segmented controls on a sheet** show a plain pill and turn to glass only while pressed — Apple's
    "don't layer glass on glass".
  - Menus, alerts and bubbles use a standard material (blur + tint), never the refraction engine, and
    hide with opacity (not visibility) while measuring so focus remains stable.
- **Machine-assigned means unverified.** Anything categorised by an import or a guess carries a
  dashed `auto` chip and sits in *Needs review* until a person confirms it.
- **Escape** closes the top sheet; with no sheet open it returns to Home. `Ctrl+K` opens the command
  palette (not while a sheet is open).
- **The palette searches.** Typing offers *Search transactions for "…"* first (lands on the ledger
  with the words in its box; the ledger also matches account and payment-app names and brand ids, so
  `gpay` finds Google Pay payments), then commands, then accounts and payment apps, which open their
  details sheet. Frames last.
- **Cards area (Overview), owner 2026-09-20 ("doesnt scroll sometimes, and feels buggy as hell"):**
  the wheel over the "My cards" heading and the stack **latches for a whole gesture**, the way nested
  scrollers do on macOS. Its first event picks the owner — the stack while there is another card that
  way, otherwise the page — and the rest of the gesture goes there, so the two never fight mid-flick
  and the area is never a dead patch. One card per 42px of travel, so a long swipe walks through
  several; arrow keys step one. A page scroll already under way arrives uncancelable and stays with
  the page. Dots under the stack show the position and jump to a card.
- **Secret totals (owner, 2026-09-20):** every total balance — net worth, Invested / Cash / Debt, the
  projection, each account card — is **not drawn at all** while hidden. In its place a slow field of
  particles drifts, after Telegram's spoilers, in the figure's own colour so it reads on a bright card
  as well as on the dark hero. The pointer opens a travelling circle: the figure is solid at the
  cursor, thins from 38% of the radius out, and is gone by its edge — one gradient from revealed to
  unrevealed, with **nothing drawn behind it** (a blurred copy was tried and read as a white box behind
  the digits; owner, 2026-09-20), and the particles thinning inside the circle. **One click on any total shows them all** and throws the particles outward as it goes (Enter
  does the same from the keyboard); clicking again brings the field back. Showing lives in
  `sessionStorage`, so closing Axonix hides the numbers again but moving between frames does not.
  The field is **button-shaped** — a pill around the figure — and its particles fade out over the last
  `14px` inside that edge, so it has no border, it simply stops being there (owner, 2026-09-20: "i want
  the particles to fade out when they reach the border"). Particles thrown by a reveal ignore the edge;
  they are meant to leave. Values the owner set on the bench: particle radius `2px`, drift
  `0.1px/frame`, density `1.7 per 100px²`, scatter force `2.7` over `1.2s`, reach `88px`,
  field padding `9px`. One shared animation frame drives every field. `components/Secret.tsx`.
- **Net worth range:** 1W · 1M · 6M · 1Y · ALL, opening on **1W** (owner, 2026-09-20). A week is the
  last seven days with one point and one label per day (`MON 07` … `SUN 13`); longer ranges keep six
  labels.
- **Empty states** sit inside the card they describe, one sentence plus at most one small action. No
  banners, no onboarding nags.
- **Honest status — failures only.** Saving that works says nothing (owner, 2026-09-19: a "Saved 21:26"
  label "screams vibecoded slop"). The rail foot appears only for "Last change not saved · Try again" or
  "Not saving this session" — never a fake "Synced". Figures are derived from data; nothing on screen is a
  placeholder number.
- **Data that can't be read is never overwritten.** If the saved file fails to load, a red alert under
  the window chrome says so, the app shows an empty setup and **saves nothing** that session. A failed
  save shows the same alert with **Try again** and stays until a save lands. Saves are written one at a
  time, closing the window waits (up to 3s) for the last one, and opening the app never rewrites the
  file ("Saved" appears only after a real change).
- **Backups and exports.** *Back up* and *Export CSV* write to **Downloads** (never overwriting a file)
  and the notice offers **Show in folder**. CSV text cells that start with `=`, `+`, `-`, `@` or a tab are
  neutralised so a spreadsheet can't run them. *Restore* reads the file first: anything that isn't an
  Axonix backup, or is from a newer version, is refused with a reason; a good file shows its counts
  and asks **Replace · Cancel**, and the current data is backed up before it's replaced. Startup
  backups keep the newest 20, named ones (before reset / demo / restore) the newest 60.
- **One window.** Launching Axonix again focuses the running window instead of opening a second copy
  that could save over the first.
- **Deleting in use is refused politely.** An account with any history, a payment method pointing at
  it, or an SI debiting it is archived, not deleted. A category still used by a transaction *or a
  budget* can't be removed; removing an unused one offers Undo.

---

## 8. Content and data display

- **Money:** Indian grouping (`₹12,53,324`), U+2212 minus (`−₹240`), `+` only on income and deltas.
  Other currencies group in thousands with cents when non-integer (`$537.50`) and show `≈ ₹` beside them.
- **Dates:** `Today`, `Yesterday`, else `Fri 11 SEP` (year only when not the current one). Always the
  *local* calendar day.
- **Model vocabulary:** an **account** holds money (bank, demat, PF, gold, forex card); a **payment
  method** moves it (UPI app, card, wallet) and names the account it debits. Balances are set once and
  moved by transactions; a balance entered later already includes earlier entries, and the UI says so.
- **Identity numbers** are masked to the last four, grouped like the document (`•••• •••• 1234`),
  revealed for 20 seconds, copied without separators.
- **Voice:** short, plain, specific. Sentence case. Say what happened and what to do next
  ("Imported rows land in the review queue until you confirm their categories."). No exclamation marks,
  no jargon, no apologetic filler.

---

## 9. Components (where to find them)

| Component | File | Notes |
|---|---|---|
| Pill / action pill / outline / danger / sm | `finance.css`, `finance-interactions.css` | One `.fin-pill--action` per view |
| Chips (`.fin-cat`, `.fin-chip-btn`, `.fin-paychip`) | `finance-interactions.css` | `aria-pressed` drives selection |
| Segmented control with lens | `components/Liquid.tsx` → `LiquidSegment` | Replaces every static toggle |
| Sheet + Field + SheetFooter | `components/Sheet.tsx` | Native `<dialog>`, glass panel. Action bars render through `<SheetFooter>` into a slot **below** the scrolling body, and paint nothing. Any bar inside the scroller, whether a box or a fade, covered the glass bezel the engine draws along the panel edge, and on a real GPU every sheet showed a rectangle. The body fades its own content out at the bottom instead. The glass engine's sheen is re-masked to fade across the bezel (`.fin-sheet__panel > .ql-sheen`): its stock ring mask had a hard inner edge, square-cornered because the 26px bezel exceeds the 24px radius, which was the rectangle still visible inside every sheet |
| Brand mark | `components/BrandMark.tsx`, `finance/brands.ts` | Cover (app icons) vs contain (logos); monogram fallback |
| Aurora account card + wallet stack | `components/AccountCard.tsx`, `Aurora.tsx` | |
| Details sheet | `components/DetailSheet.tsx` | Accounts and payment methods |
| Transaction sheet (quick entry) | `components/TransactionSheet.tsx`, `finance/parse.ts` | |
| Toast | `App.tsx` (`sonner`, unstyled) + `.fin-toast` | Bottom centre, 5s, Undo action |
| Charts | `components/Charts.tsx` | Hand-rolled SVG, `aria-hidden` (figures are on screen as text). Lines are **smooth**: a monotone cubic through every point that never overshoots, so no invented peaks. Bars have generous fillets (`rx` 11 on 30-wide bars, 10 on day bars). The gold chart keeps straight daily segments, as market data |
| Standing-instruction section | `components/DetailSheet.tsx` → `SiSection`, `ledger.ts` (`nextSiDate`) | Read → edit in place; inline confirm on Remove |
| Subscriptions panel | `components/SubscriptionsPanel.tsx`, `ledger.ts` (`nextCharge`, `monthlyCost`, `paidThisCycle`) | Rows read first (initial, amount + cadence, charged-to, next charge); edit in place; inline confirm + Undo on Remove |
| Data alert | `DataAlert.tsx` (+ `.data-alert` in `finance-interactions.css`) | Under the titlebar. Read failure: can be hidden (the rail keeps saying it). Save failure: stays, with Try again |
| Save state | `FinanceApp.tsx` → `SaveState` | Rail foot |
| Command palette | `CommandPalette.tsx` (`cmdk`) | Search item is `forceMount`; account rows use `BrandMark` 16px |
| Gold rate hero + hover chart | `frames/Invest.tsx`, `finance/gold.ts` | Same card and gradient as net worth; HTML dot (a stretched SVG circle is an ellipse) |

---

## 10. Brand assets

All marks live in `ui/src/assets/brands/` — never hot-linked ("Local" invariant).
Sources: store-listing app icons (128px) for apps and issuers; Wikimedia SVGs for SBI, UPI, RuPay;
Simple Icons for Visa; the EPFO seal from the official logo on epfo.gov.in (wordmark dropped, shown as
a logo on the white tile); **owner-supplied** files for Mastercard and Jar (Jar's wordmark removed, mark kept
on its dark ground `#1b1430`). When the owner provides an official file, it replaces the sourced one.
Official-site links live beside each brand in `brands.ts`; each was checked to load when added.

**Corners:** the tile's `border-radius` is the only corner a mark has. Full-bleed (`cover`) icons get
no background and no inset ring, because a white tile bled through the anti-aliased edge as white
streaks. They are also scaled up 8% so an icon with its own smaller rounded corners never shows them.
Vendored SVGs use a square ground that overfills the viewBox, never a baked-in `rx`. Logos (`contain`)
sit on the white tile.

---

## 11. Accessibility

Focus rings on every interactive element (`--focus-ring`); `aria-pressed` / `aria-checked` on toggles;
sheets are native modal dialogs; charts are decorative with the figures present as text; full motion plays
throughout Axonix by the owner's choice; negative and warning states always pair colour with words or an icon.

---

## 12. Not designed yet / open

- **Plan** and **Wallet** (cash) frames are stubs labelled *Soon*. **Invest** has Indian gold rates
  only; holdings, SIPs and the Jar balance in grams are not designed yet.
- **Mobile capture** (inbox folder → Tailscale → Tauri mobile) is researched, not built.
- **Digital IDs are stored unencrypted** on disk (risk R9) — encrypt before real numbers go in.
- The shell's parked accent (`--accent-bright`) remains monochrome by decision; finance hue does not
  leak into it.

---

## 13. Axonix Social

A Social surface inside the unified Electron Axonix window (`ui/electron/`, `ui/src/social/`), opened
from the Home tile. Built with `pnpm app:build`; packaged as `release\Axonix\Axonix.exe`. Why Electron: a
`<webview>` guest is composited into the page, so glass, menus and motion can sit over a site, and
Google sign-in can work. WebView2 allowed neither. A Chrome user agent alone was not enough (owner,
2026-09-27: "In pinterest continue with google is not working"): **Continue with Google** needs FedCM
off (Electron cannot serve it, so the button did nothing), Chrome's `window.chrome` shape in the page and
its sign-in popup, and Chrome's client hints on navigations. It then opens Google's own sign-in popup,
in Social and in the Storeroom's side pane alike (`main.ts` `prepareSessions`, `preload-chrome.ts`).

**Layout (macOS 27).** Title bar 38px: a glass capsule (back · forward | reload), the app name, the
"Sign in as …" chip at the end, Windows' own caption buttons (`titleBarOverlay`) on the right. Dock
64px wide, 10px from the left edge, vertically centred. Page card from x = 88px to 12px from the
right and bottom, `--fin-r-frame` corners, a hairline ring and a floating shadow. The ground is the
Home wash in Social's amber.

**Dock.**
- One light, uninterrupted translucent shelf (radius 24) sits behind the icons, so magnification can
  grow past it without revealing a dark inner rectangle. Its rim stays deliberately soft.
- Icons 44px, magnify to 66px within 128px of the pointer on a spring (`mass .1, stiffness 190,
  damping 14`), fine pointers only. Store-listing icons, 23% corners, a 1px inner edge for dark icons.
- A screen-edge state rail marks each kept app: bright and 24px for active, muted and 12px for an
  open background page, a small outlined pin for sleeping. A red `#ff453a` badge carries unread
  counts as a number, so colour is never the only signal. Scrollbars are visually suppressed within
  guest pages without disabling scrolling.
- First launch bounces the icon once, outward. Labels wait 420ms, then follow from icon to icon at
  once until the pointer leaves the dock. Right-click: Back to feed · Reload · Open on the left / right
  · Exit split view (when in one) · Sleep now.

**Motion.**
- Switching slides pages along the dock's axis: the incoming page rises 22px from below when it sits
  lower in the dock (spring `380 / 36`, fade 200ms); the outgoing one leaves 12px the other way in
  150ms. The first open slides out from the dock (40px). Ctrl+1…6 switch instantly.
- **Pages never scale.** A `<webview>` attached or resized under a scale transform keeps drawing at
  the inverse scale. Anything containing a page only translates and fades; the Overview dims the card
  (opacity .08) rather than shrinking it.
- Loading runs the axon pulse along the top edge of the loading page (each pane has its own). While
  the first frame loads, the app's icon breathes in the middle of the card.
- Overview (Ctrl+↑, dock button): a 3-column grid of last frames, tiles rising in with a 28ms stagger.
- Motion remains full in Social as elsewhere in Axonix; page transitions keep their authored transforms.

**Launch.** An app whose page isn't loaded yet opens out of its icon, whether it comes from the dock,
a drop into a pane, a menu or the keyboard.
- A card in the app's own colour — Instagram's gradient, black for X and Threads, Reddit orange,
  LinkedIn blue, Pinterest red — grows **out of the icon's own edge**, carrying the icon to its
  centre: it starts exactly on the painted icon border (in the dock, or the dragged icon where it
  was dropped) and with the icon's own 23% corner, which eases to the page card's 22px as it grows.
  The dock icon stays painted while its launch copy leaves: removing the source in the same commit
  as the copy caused a blank frame while Chromium attached the guest page. The copy uses the same
  1.08 image crop as the dock icon, so the first frame is pixel-for-pixel continuous.
- **From the dock, 520ms** (`cubic-bezier(.2,.9,.24,1)`). **Dropped into a pane it grows slowly,
  paced by the site:** the growth is given up to 2.6s and is hurried to its end (5x) the moment the
  page is ready, so the expansion lasts about as long as the load (the owner's call, 2026-09-20).
- It **holds** — icon breathing, axon pulse along its top edge — until the page has loaded, painted
  two frames, and gone 600ms without loading again (Pinterest and LinkedIn reload once or twice), at
  most 15s. So the transition lasts exactly as long as the site takes, and no half-built page is ever
  on screen. Then the icon lifts away (1.14x, 220ms) and the card fades (300ms).
- Everything that moves is **composited** — `transform`, `opacity` and `clip-path` — through the
  browser's own Web Animations. Creating the page blocks the host's main thread for 70-150ms right
  after the growth starts: a `border-radius` animation froze there and the corners ballooned into a
  pill until the thread came back, while `clip-path` kept running (measured 2026-09-20). The page
  itself is created two frames later, so the compositor already has the animations when the stall
  lands.
- From the dock, an app that is already loaded just slides in, so switching between open apps never
  flashes colour. A drop always opens out of the icon. From the keyboard the card appears in place.

**Split view.** Two apps side by side, after macOS Split View.
- **One page per app.** Split view is only a layout: a pane shows the same `<webview>` the app uses on
  its own, so nothing loads twice, and moving between the whole card and a pane is a `left`/`right`
  transition (260ms, `--ease-out`). Pages still never scale.
- **The focused pane is the active app.** Back, forward, reload, `Ctrl+R`, the sign-in chip and the
  Overview all act on it. **Focus follows the pointer**: whichever pane the mouse is over is the one
  they act on (clicking or tabbing into a page still focuses it). Each page's preload reports the
  pointer, because the host page sees neither moves nor clicks inside a `<webview>`.
- **Starting it:** drag a dock icon onto a half of the page (a glass panel shows where it will land,
  "Open X on the left" or "Replace Reddit"; only the dragged icon follows the pointer), right-click an
  icon → **Open on the left / right**, or `Ctrl+Shift+1…6` (into the other pane).
- **In split view** a dock click replaces the focused pane, or focuses an app already showing.
  Dropping an app onto the side opposite where it already is swaps the two.
- **Look:** the card gives way to one rounded card per pane over the wash, 10px apart. The focused
  pane draws **nothing of its own** — no border, no highlight (the owner's call, 2026-09-20): the
  title bar's pane tabs are the only sign of which side is active. A grip sits in the gap: drag to resize between 28% and 72%, with
  detents at ⅓, ½ and ⅔; double-click for halves; arrow keys move it (Shift for bigger steps).
- **Title bar:** a segmented capsule with both apps (a sliding highlight on the focused one), then
  **Swap sides** (each app keeps its width) and **Exit split view** (`Esc`), which gives the whole
  card to the focused pane.
- **Motion:** an app arriving in a pane slides 32px in from that pane's edge and fades (spring
  `340 / 32`); a replaced one fades 20px toward its edge in 160ms.
- **Remembered** across restarts — layout and divider live in the app's state file beside the last
  app, written atomically, so a crash can't leave them disagreeing.
- Sleeping an app that is in a pane closes split view; the other app takes the card.

**Sign-ins.**
- Each app has one saved session (`persist:social-<app>`); logins survive restarts, crashes and
  force-closes: every cookie change reaches disk within a second (Chromium alone waits up to 30s),
  quitting flushes first, and the apps' own session-only cookies are kept for 400 days, as Chrome
  keeps them when it continues where you left off. The profile folder (`Axonix Profile`) and the
  partition names are part of every login — renaming either signs the owner out of every site.
- Save: after a sign-in is submitted, a bubble grows from the top-right: "Save password for
  Instagram?", the username, where it is kept, **Never for Instagram** · Not now · **Save** (the one
  filled button). Replacing a different username says so.
- Fill: the chip appears only on the app's own login pages, and fills only when pressed.
- Passwords panel (dock key): each app's saved username or "Nothing saved", inline Remove confirm,
  Allow saving for apps set to never.

**Freezing.** An app off screen for 2 minutes is frozen: its page stays, exactly where it was, but
runs nothing (no timers, no script) and gives back cached memory. It wakes instantly when shown —
there is no visible difference — and for 5 seconds every 2 minutes on its own, so unread badges and
notifications keep arriving. A page playing sound is never frozen. A minimised window counts as off
screen.

**Sleeping.** An app left in the background for 10 minutes (5 when free memory is under 2 GB, 2
under 1 GB, 15 when it is over 8 GB), or chosen with **Sleep now**, keeps its
last frame where capture is available and releases its page; opening it shows the frame at once and
fades the live page in when it has loaded. State changes immediately; capture remains best-effort.
Sleep is tracked independently of capture, so its outlined
dock pin always appears. **Sleep now** also works on the active app and leaves the Social stage empty.

**Swipe.** A two-finger swipe across a page goes back (swipe right) or forward (swipe left), as it
does in a browser. It only navigates when nothing under the pointer can still scroll that way — a
carousel or a horizontally scrolling feed keeps the gesture — and only once per swipe: the deltas
are added up (**440px** triggers it). Signed travel is never reset merely because the fingers reverse:
the same orb follows them back to its edge, and only a continued gesture beyond the origin starts the
opposite cue. Release follows Chromium's native `gestureScrollBegin` / `gestureScrollEnd` lifecycle,
forwarded by Electron's main process: resting fingers produce no updates and leave the orb fixed; lifting
them produces an explicit end and retracts an uncommitted cue. A 96ms quiet deadline exists only for a
legacy horizontal mouse wheel that has no gesture lifecycle. A circular refractive orb emerges from the
destination edge continuously with travel and
speed, covering a **164px runway** before the commit, with the arrow centred in the lens. Its optics map
Pen's `glass.glsl` Blurry Lens model onto quick-liquid's live-backdrop Snell lens, but with a restrained
IOR 1.22, refraction strength 10, 22px bezel, .04 chromatic separation and 1.2px blur so website text
behind it bends much less. Committing pulls the orb back into
that edge in 240ms, while a cancelled gesture retracts in 190ms. Only transform moves, and each pane
owns its own cue.

**A fresh start.** Social opens with no app on screen every time (the owner's call, 2026-09-20).
Nothing about which apps were open survives closing it; only the split divider's position is kept,
as a setting. An app named on the command line (`--app=`, from a shortcut) still opens.

**Pinch.** Every social guest accepts a precision-touchpad pinch for a temporary 1×–3.4× *visual*
zoom, anchored at the gesture. The whole document scales together, including responsive/max-width
content such as Reddit's main feed. Release carries the gesture's velocity into a small spring back
to 1×; it is never saved as a page or browser setting. The anchor is the pointer's hover location
at the start of the pinch, held in document-space pixels so it remains correct in long or scrolling
feeds; sensitivity is intentionally high (`.006`) so a small pinch reaches the 1.5×–3.4× reading range. Social follows the owner's full-motion preference even when the OS requests
reduced motion.

---

## 14. Axonix Tasks

### Project workspaces (2026-09-20)

Projects are workspaces, not folders, templates or pre-filled module dashboards. A project has one
restrained hero with an optional emoji/icon, editable name, goal and overview, start/end dates and progress,
then four direct views: Board, Timeline, Library and Moodboard. The project hero is the one intentional
local gradient on the Tasks surface; stronger grain and a thick translucent material carry project
identity without restoring a page-wide background gradient. The Library and Moodboard contain Axonix
notes/references only; adding a Moodboard card keeps the board in view.

Progress is the percentage plus a twenty-week contribution grid derived from task activity, never a
loading bar. The grid occupies the larger right side of the hero at ordinary desktop widths; its 20×7
matrix scales with the pane instead of leaving unused space around fixed-size cells. Choice controls
use the shared anchored `PopUpButton`, never the operating system's native white select menu. Start and
end are a single dashboard date range: large date-only endpoints joined by a strong line and backed by
Axonix's anchored calendar; dates carry no extra semantic tag. The right endpoint is a direct-manipulation
  handle: pushing it into Activity turns the range into a filled, tapered open-ended flow for projects with
  no target date. The stream starts clear of the range's start dot, never across it, and runs straight until the last
  quarter of the way (`FLARE`), where opposing Bezier edges turn steeply and open into Activity's full
  height (owner, 2026-09-20: no line through the left node, a steeper curve). The fill carries
  the light-blue accent without an outline, matching the
  dashboard reference without a visible activity-side endpoint. The shape follows the pointer, keeps the
  previous target date intact, and has an invisible seam hit target that can be dragged back or clicked to
  restore the dated range. Keyboard activation provides the same state change. A borderless project mark opens a large
emoji and Lucide-icon library, above a **Product** row: a project that is a piece of software can wear
its own shipped icon (`mark:local-store` → `assets/brands/local-store.svg`, from that project's own
branding), and a project whose name is the product's wears it without anyone choosing.
The chosen mark is shared by the hero and project rail. Project metadata
is reloaded whenever the selected project changes so dates and identity never bleed between workspaces.

Kanban drag motion is physical feedback: the held card tilts toward horizontal velocity and stretches
slightly with speed, capped at 5° / 2.5%. It tracks continuously and settles through the existing short
drop transition; it never animates the task data itself.

The Tasks tile (light blue) opens Tasks in the same window. Built on the Finance shell — rail with the
liquid lens, top bar, glass sheets, pills, Azeret figures, toasts with Undo — and follows every rule
above; this section records only what is its own. Code: `ui/src/tasks/`, `ui/electron/tasks.ts`,
`ui/src/styles/tasks.css`. Plan and the owner's choices: `docs/plan/08 Task Tracker Plan.md`.

**Tasks are files.** One markdown file per task in `My Vault/Tasks/<project>/`: fields in YAML
frontmatter (`id, state, priority, due, scheduled, estimate, tags, order, created, started, done`),
notes and subtasks (`- [ ]`) in the body, title = file name, project = folder, `Tasks/` itself = Inbox.
The column field is `state` (`status:` means verified/unverified in this vault). The page edits only
what it was asked to — unknown keys, their order, comments and the body survive — and never writes a
file whose properties it cannot read (the sheet says so and every control is off). Delete moves the
file to `Tasks/.trash/`. Everything shown is derived from the files; nothing is stored anywhere else.

**Colour.** The module colour is the tile's light blue: `--tsk-accent #7cc4ff`, text `#bfe3ff` (on `:root`,
because menus and calendars render outside the page). It marks *today* and *in hand*: the Today
widget's aurora, the rail and page washes, Doing's glyph, due-today, time-block tokens, the now-line,
the dragged card's edge. The one filled button stays Apple blue. Other meanings: green `#5fe0a2` done,
amber `#ffc496` blocked, `#ffa1a1` with a triangle icon for late, priority flags P1 red `#ff8f8f` · P2
amber · P3 blue · P4 faint, always with the flag icon and the "P1…" text. Each project gets one of ten
hues from an FNV hash of its name (stable, nothing stored); the Inbox is grey.

**Layout.** Rail: Tasks (Home, Calendar *Soon*, Notes *Soon*) and Projects (Inbox, each folder with its
open count or a red late badge, New project). Top bar: the add field (320–580px) and nothing else —
undo is **Ctrl+Z and the toasts' Undo only** (owner, 2026-09-20: no undo button on screen). Home: the date as the page title with "N due today · N late · N done", the dashboard, then
the board. A project page: its name with its dot, "N open · N done · N blocked", Show folder, its board.

**Dashboard.** Four widgets from a registry (`WIDGETS` in `components/Dashboard.tsx`), 4-up from a
1280px window, 2×2 below, one column under 900px — never 3 + 1. *Today* is the light-blue aurora (done /
total, a ring, due and late, a light "Next" or "In hand" row in dark ink). *Agenda* lists today's time
blocks with free gaps of 30 minutes or more until 21:00 and a light-blue now-line. *Momentum*: seven day
bars (today light blue), the streak, median Doing → Done. *Projects*: the four busiest projects with a
light-blue progress bar and a blocked count. Charts are not animated (the Finance rule).

**Project dashboards.** A project page opens on **Dashboard**, and a new project's is empty on purpose
(a project is a piece of software, a thesis or an application campaign — no fixed set of cards fits all
three). The empty state offers every widget with a line on what it is for; after that an **Add widget**
pill and, on hover, arrows and a cross on each card. The list lives with the project. Widgets come from
one registry (`components/Dashboard.tsx`), each declaring `scope` (home · project · both) and a width;
Home keeps its four. Project widgets so far: **Deadlines** (the next applications to close, with a
countdown and a link to the portal), **Pipeline** (applications by stage), **Documents** (a row per
application, a dot per document, and the paper missing most often).

**Applications.** A task with a `uni` stands for a university application: its deadline is the task's
`due`, its stage is `stage` (researching · shortlist · applying · submitted · interview · offer ·
rejected — not the board's `state`), and the documents it needs are the checklist in its body.
`programme`, `country`, `fee` and `portal` ride along. Country checklists (`tasks/application.ts`)
carry what an Indian applicant needs: APS for Germany, ATAS for UK aerospace and mechanical, WES for
the US and Canada. Plan: `docs/plan/10 Masters Application Project Plan.md`.

**Scholarships.** A note of `kind: scholarship` carries what it covers and when it closes; the project
grows a **Scholarships** tab as soon as it has one (an empty tab is noise). Each row is name, what it
pays, the next deadline with a countdown, and a verdict — **Eligible · Check · Not eligible** — with
the reason in the row: "Wants 3 years of full-time work, you have 0". Unknown facts make a *Check*,
never a *No*; marks within five points of a floor are a *Check* too, because Indian CGPA-to-percentage
conversions differ by university. The rules and the applicant's own facts come from one profile note
(`tasks/masters/profile.ts`, `scholarship.ts`), and every note ends in the link it was read from with
the date. The **Scholarships** widget shows the next five that are still open.

**Properties, as a form.** Nobody types YAML. A note whose kind has properties (scholarship,
programme, person, profile) grows a **Properties** button in its header; the sheet is generated from
one table (`notes/properties.ts`), grouped, with the right control per field — pickers for lists,
the app's calendar for dates, a row editor for deadlines. Saving writes the keys into the
frontmatter and leaves everything else in the file untouched.

**Looking things up.** One module reaches the internet (`electron/research.ts`) and the renderer never
does. It holds an **allowlist** (OpenAlex · College Scorecard · ROR · Crossref · Frankfurter rates ·
the MIT universities list), one request a second per host, a disk cache so every page works offline,
and the owner's own keys in Windows Credential Manager. A page is fetched **only when the owner pastes
its address**, once, after `robots.txt` says yes — no crawling, nothing behind a login. What a page
yields is *offered* as chips (dates found, money found), never written for you, and `source` and
`checked` are stamped so a stale figure can say so. The **Research sources** sheet (globe, Tasks top
bar) lists every source with its terms, shows what the cache holds and empties it.

**Discover.** Which universities actually work on your topics, not which market hardest: OpenAlex is
asked who published on the topic since 2021, the answer is narrowed to `type: education` in the
countries you chose (so the space agencies and national labs drop out), and each row can become a
programme note carrying its OpenAlex id, country and source. The count is labelled for what it is —
papers, not teaching.

**Compare.** Up to five programmes side by side. Money keeps the currency it was written in with the
rupee figure under it, converted at the day's reference rate and marked *estimated* unless the note
says `official`; the total is checked against the profile's ceiling. The rows people forget come
after: the paperwork that country adds for an Indian applicant (APS · ATAS · WES), which of *your*
scholarships could pay for it, how long you may stay and work afterwards, and when each figure was
last read.

**Board.** Five columns — Backlog · To do · Doing · Blocked · Done — each a faint 16px panel with a state
glyph, label, count and a `+` that shows on hover; Done shows a week, with "Show N older" for the rest.
Group by None · Project · Priority (swimlanes with a header per lane); filter by text (`/`), project,
due and priority, with Clear. Cards: 13px corners, a round checkbox ringed in the priority's colour,
the title up to three lines, then project, due, time block or estimate, priority, subtasks `2/5`, a
notes mark and two tags. Finished cards keep only their project. An empty column says what belongs
there in one line.

**One-line add.** `Renew bike insurance fri 3pm #personal !2 30m` — `#word` is a project if one has that
name, else a tag; `+word` makes a project; `!1–4` or `p1–4` priority; `30m`, `1h30m` estimate; dates and
times via chrono-node (a time also schedules the block). While typing, a panel under the field shows
the reading as tokens plus a one-line syntax key. Enter adds to the top of To do (or of the project
whose page is open) and keeps the field for the next one; `Ctrl+N` focuses it; Escape clears, then
leaves. Each column's `+` does the same in that column.

**New task, in full** (owner, 2026-09-19: adding "should come in a bigger view too, not just the input
box"). The field's expand button, or Shift+Enter in it, opens a 680px composer carrying whatever the line
already said as chips. It has a 24px title, a row of property chips (state, project, due, priority, time,
estimate, tags), and live-preview notes. A chip stays quiet until it holds a value, then turns light blue.
Enter in the title moves to the notes; Ctrl+Enter creates. **Create more** keeps the sheet open with the
project, state, day and priority kept. Closing with typing in it raises the discard bubble.
Code: `components/Composer.tsx`.

**Task sheet.** Fields are live — no Edit step, because a task is changed far more often than read
(unlike Finance's details-first rule). Title in place (renames the file); state as a segmented control;
Project · Due · Priority as fact buttons with the app's menus and calendar; Time block · Estimate · Tags
as fact inputs; notes read as formatted text with live checkboxes, and **Edit** turns them into the raw
markdown (unsaved typing raises the discard bubble); "Add a subtask" appends `- [ ]`. Footer: Delete
(inline confirm → trash, Undo), Open in Obsidian, Show in folder, Close, and **Mark done / Reopen**.

**Motion** (full, like Finance). The checkbox pops (.82 → 1.14 → 1, 340ms) and draws its tick; 360ms
later the card glides to Done on a shared-layout spring. A new card drops in at the top of its column
(y −10, scale .97). Dragging lifts the card (tilt 1.6°, scale 1.035, deep shadow, light-blue edge), leaves
a dashed slot, lights the target column, and lands in 240ms; layout animation pauses during a drag so
the two never fight. The add panel fades in (90ms, no movement) and nothing inside it animates, because
it appears while you are typing. Cards press to .985; chips, tabs and the column `+` press to .97.
Opening a project brings the hero, then the tabs (40ms), then the view (60ms) in; switching view rises
the new one 5px (no fade — an opacity below 1 over the board would turn its glass off). A composer chip
nods (180ms) when a value lands in it, but not while the sheet is still arriving. An empty column's line
fades in a beat after the board (240ms, 80ms in).

**Honest status — failures only.** Nothing shows while saving works. The rail foot appears for "Last
change not saved · Try again" or "Not saving this session" when the folder could not be read. A change refused because the
file changed on disk is re-applied once to the new text; if that fails too, it is rolled back and the
rail says so. Ctrl+Z (outside text fields) and the toasts' Undo restore files as they were.

### Notes v2 (2026-09-22)

Only notes created in Axonix appear in the Tasks rail's **Notes**. The UI never exposes a folder,
filename or path; Markdown files remain on disk as a readable/searchable fallback for Obsidian. Code:
`ui/src/notes/`, `ui/electron/vault.ts`, `ui/src/styles/notes.css`.

- **Independent library.** Notes has its own Home entry and hides the Tasks rail/composer. A 300px
  library stays beside the document: all/pinned views, saved filter collections, multi-term search,
  type/project filters, sorting and compact previews. New note opens blank; Templates is optional.
- **Focused page.** One note at a time, a quiet 62px toolbar, auto-growing title, subdued properties,
  an **840px** writing column and optional heading outline. Focus mode hides the library. Mobile
  shows either library or document with a back action. No tabs or reading/source switch.
- **Material and motion.** Restrained charcoal surfaces, structural translucent chrome, light-blue
  selection, native AFFiNE dark theme for portalled controls. Short entrances and immediate press
  feedback follow Apple/Emil guidance. No idle decorative motion or reduced-motion branch.
- **Editor: BlockSuite `PageEditor`.** Slash commands insert headings, lists, to-dos, code, quotes,
  dates, media embeds, table/Kanban databases and other native blocks. Block selection, rich-text
  formatting and reordering come from the maintained AFFiNE editor packages. The title is an Axonix
  textarea styled as part of the same canvas because the standalone canary `DocTitle` reverses caret
  insertion when mounted outside AFFiNE's full shell.
- **Storage and saving.** Rich structure is canonical in an Axonix-owned `.axonix.json` sidecar.
  The `.md` file receives a formatted Markdown projection via the native adapter plus frontmatter.
  One per-document queue owns both body and property edits. The main process checks both versions
  before writing, with rollback on a write failure. Pending edits have local recovery drafts; conflicting
  recovered edits can be saved as a separate note. Existing notes import lazily, never in a bulk rewrite.
  Embedded blobs are optional/additive snapshot assets. Desktop rich notes are limited to 16 MB.
- **Actions.** Native formatting/slash menus, block insertion, undo/redo, outline, word/read counts,
  selected text → task, pin, duplicate, Markdown/text/complete-note import and Markdown/complete-note
  export. Delete is confirmed and moves the note and rich assets together to Recently deleted, with
  Undo and Restore. Complete JSON preserves richer content than Markdown can represent.
- **Boundaries.** No AFFiNE cloud/AI or Edgeless canvas. Native cross-document creation is disabled
  until it can be safely wired to Axonix persistence. Source/license notes: `docs/notes-v2-open-source.md`.

### Calendar (phase 4)

The week beside Google Calendar, in the Tasks rail's **Calendar**. Code: `ui/src/calendar/`,
`ui/electron/gcal.ts`, `ui/src/styles/calendar.css`.

- **The week.** Monday first; 52px an hour, 15-minute steps, opening at 07:30. Day headers (today's date
  in a light-blue pill), an all-day row (Google all-day events in their colour; open tasks due that day as
  dashed chips), hour lines, a light-blue now-line. **Time blocks are tasks** (light blue, the project after the
  time); **Google events** wear their calendar's colour as a left bar and tint, and open a small card
  with time, place and *Open in Google Calendar*. Overlaps sit side by side.
- **Doing things:** drag a task from **To schedule** onto the week; drag a block to move it; drag its
  lower edge to resize it; double-click an empty slot for a new task there; click a block to open the
  task. The ghost shows the exact times while dragging; each change has an Undo toast.
- **Google, both ways.** The owner's own OAuth client (Desktop app) — Google blocked shared clients in
  2026 — set up once from the sheet's five steps (links, *Copy the scopes*). Sign-in runs in the system
  browser, back to a loopback port with PKCE; the client and refresh token live in Windows Credential
  Manager. Scopes: read calendars and events; write only calendars Axonix created. Time blocks are
  events on an **Axonix** calendar tagged with the task id: moved or resized in Google → the block
  moves; deleted in Google → the task loses its time; done → the event reads "✓ title"; unscheduled or
  deleted in Axonix → the event goes. If both sides changed, the task wins. Changes from Google are
  written without an Undo entry (Undo is for your own) and announced in a toast.
- **Honest status — failures only** in the header: "Syncing…" while a sync runs, "Offline copy from
  11:30", or the error with the reason. When all is well only the refresh button shows; its tooltip
  gives the last sync time. Sync runs 1.5s after a block changes, every five
  minutes and on window focus (a local app gets no push from Google).
- Without Google the Calendar still works for time blocks; the header's one filled button is **Connect
  Google Calendar**. The dashboard's Agenda lists today's Google events with the blocks.

---

## 15. Axonix Storeroom (2026-09-27)

The owner asked for **a storeroom for inspirations, not a design tool** ("I use Paper… I don't want it to
be like Paper"): drop designs, links and SVG in directly, and let agents use them to build the owner's own
design language. After Karakeep's bookmark model (AGPL — read, not copied), rebuilt the Axonix way. Code:
`ui/src/storeroom/`, `ui/electron/storeroom.ts`, `ui/src/styles/storeroom.css`.

| Owner input (2026-09-27) | Design consequence |
|---|---|
| A **standalone app**, as a tile with its own window | Opens from Home (**Open Storeroom**, beside Open Notes: a fifth tile would break 4-up / 2×2) and pops out into its own window with its own taskbar button (`--storeroom`) |
| Capture by **drop + paste**, and **right-click in Social** | Drop or Ctrl+V anything anywhere on the page; Social's context menu gains *Save image / video / link / selection / this view to Storeroom* |
| Media in `D:\04 Media`, the language in the vault | Library at `D:\04 Media\Storeroom` (Obsidian Sync caps files at 5 MB); the language at `My Vault/Design Language/` |

- **Files are the truth.** One folder per reference, `items/R0042/`: the media plus `item.md` (frontmatter
  `kind, title, why, tags, file, source, via, width, height…`, notes in the body). `R0042` is the item's
  stable name for agents and is never reused; delete moves the folder to `.trash/` with Undo. `.cache/`
  holds thumbnails only.
- **Kinds:** image, SVG (pasted code from Paper/Figma is kept as a file), video, link, note. A link becomes
  an item at once and captures in the background: a hidden sandboxed window at 1440×900 takes the
  screenshot and the page's title, description and share image (Karakeep's settings). While capturing,
  the card's bottom edge carries the axon pulse — never a spinner.
- **The one field that matters is *why*** — one line under the title in every sheet, shown on hover in
  the grid. Tags are lowercase with `/` for groups (`type/grotesk`); the rail lists the fourteen most used.
- **Layout.** Rail: Everything, Unsorted (no why and no tags), then Kinds (Images, Motion = GIF + video,
  Vectors, Links, Notes), then Tags. Top bar: the add field (link / SVG / thought, Enter keeps it; Ctrl+L)
  and search (`/`). The grid is a masonry of fixed-size columns (min 228px); pictures fill their cards
  with no chrome until hover (id, title, why). A new reference lands on top of one column and every other
  card stays where it was. Very tall or wide pictures are cropped in the grid, never in the sheet.
- **Cards:** press `.985`, hover lift under a fine pointer only, a kept card's edge tints once (900ms,
  colour only). Videos play on hover, muted. SVG sits on a light sheet (`#eceef2`) because most marks are
  dark on nothing. Dragging a card hands the real file to other apps (Paper, Figma, Explorer).
- **The sheet:** picture at full size, title in place, *Why I kept it*, tags with suggestions from the
  library, notes, the **palette** (k-means on a 64px copy; for SVG the colours the file declares) with a
  click to copy each hex, then Source / Came from / Kept / File. Footer: Delete (inline confirm) · Show in
  folder · Copy SVG · Copy image.
- **Colour:** the module is **tan** (`--str-accent #e0b089`, text `#f3d9bd`) — quiet and warm so the
  references carry the colour. No purple.
- **Local:** favicons and share images are recorded as addresses, never loaded; everything shown comes
  from the Storeroom folder through `storeroom://`.
- **Social beside the Storeroom (owner, 2026-09-27: "open axonix socials on the right side of the
  storeroom for easier drag and drop").** The top bar's panel button opens a pane on the right with one
  app's signed-in page (Social's own `Site`: same sessions, allowlists and preload), the six app icons as
  tabs, back / forward / reload / close, and a left edge that resizes it (the grid always keeps two
  columns). Open state, width and app are remembered. Drag a picture or link from the page into the
  grid: the page's preload reports what was dragged (the picture's own address, its post, its alt text,
  which becomes the title), and the Storeroom saves it through that app's session — full size on
  Pinterest and X, source = the post. **Alt-drag** lifts a photo the site covers (Instagram's clear
  layer). If a drop never reaches the Storeroom (electron#2897), a release over the grid still keeps
  it. Only the app on screen in the pane counts as shown; the rest freeze like Social's. Works in the
  Storeroom's own window too; sign-in prompts stay in Social.

## 16. The new shell — Paper + Glass (2026-10-02)

Code: [`ui/src/next/`](ui/src/next/) · look: [`ui/src/styles/next.css`](ui/src/styles/next.css) and
[`next-modules.css`](ui/src/styles/next-modules.css) · mockup the owner approved:
`design-explore/paper-glass/index.html` (outside the repo). Every module is inside it.

**The rule: paper is at rest, glass is in motion.** The window is ground (`--nx-ground #070708`). Two
things stand on it: the module's **sidebar**, which has no surface of its own, and the **page**, the one
rounded sheet of paper (`--nx-paper #111112`, 14px corners). Owner, 2026-10-02: "the entire window is
inside a rectangle… i dont want that, keep the main page section to be in that format, while the left
sidebar intact separately." Glass is only what floats or moves: the dock, the selection lens, the top
bar once something scrolls under it, menus, chart read-outs, and the panels on the right edge.

- **Dark leads** (owner: "keep dark theme"). The shell is dark only for now.
- **Monochrome. Hue only where it shows its reason.** Green = money in. Amber = needs attention or
  ahead of pace. Red = over a limit, delete. Blue = a forecast, which has not happened yet. The one
  filled button is an **ink pill** (white on dark). Selected chips, the menu highlight and the picked
  date are ink too.
  - Owner data keeps its colour: category colours, the hue of an account card, gold on the Invest chart.
  - **No hue per module** (owner: "reads little busy"). Dock tiles are one neutral material; the module
    you are in is the inverted tile.
- **No dashed or dotted lines, anywhere** (owner: "read AI slop"). Solid hairlines or fills instead.
- **The rail is where you are** (2026-10-07; it was a floating glass dock before). Owner: "i want this
  left sidebar, no more dock", drawn in pen.dev (`pencil-new.pen`, frame "Axonix / Home"). A 64px
  column on the left edge, standing on the ground like a module's sidebar: no glass, no shadow, nothing
  to drag. The page starts where it ends (x 64, as drawn) and is whole: no strip is kept clear at the
  bottom any more, so every module gained that height.
  - **Tiles** in the middle of the column, in the one order: 40px, 11px corners, a faint fill and a
    hairline; the module you are in is the inverted tile. A tile's name stands beside it on hover. The
    amber badge (tasks due or late, transactions to review) sits on its corner.
  - **At the foot:** the Pocket's slot, the clock (Scrub, T) and the mark (search, jump, add or ask).
    The time ruler stands beside the clock and the ask panel beside the mark.
  - **Not built from the drawing, because nothing exists for them to open:** the gear at the top, the
    four circles under it and the owner's "M" at the foot. The mark has the foot's place.
  - **Not taken from that frame:** its Home (agent messages, "The world is quiet."). Owner, the same
    day: "i dont want that… keep rest of the homescreen same".
  - **The page starts under the window's buttons** (38px down, as in the frame). Owner, on the first
    build, where the page still began at 8px: "the 3 button on the top right corner, cut into the
    page, fix page sizing." The strip above the page is ground and moves the window; minimise, maximise
    and close sit on it, clear of the page's corner. The top bar no longer keeps 150px empty at its
    right end for them.
  - **No agents and no assistant on screen** (owner, 2026-10-07: "remove claude and AI integration
    from the UI, keep backend for now"). Gone from view: the agents' rows in every sidebar and their
    chip in the top bar, the agents' cursor, Claude's panel (terminal, chat, steps, setup), the Agents
    surface, the ask panel and Ctrl+J, "Ask Axonix" in Ctrl K, and the mark's working light. The mark
    opens search; a thing dropped on it searches for it. **Kept, unmounted or running:** the door and
    its tokens, the page's side of it (`DoorProvider` still runs a guest's call, with a toast and
    Undo), the assistant's provider and tools, and every file under `door/` and `assistant/`. The
    "auto" chip on machine-made things stays: it is about the data, not about an agent. §17 and the
    assistant's bullet below describe what is built and can be mounted again.
  - The first Home, Finance, Tasks, Storeroom and Social are untouched.
- **The sidebar is the module's own: views first** (owner: "left sidebar should show the menu items
  primarily, rest all stuff later is secondary"). Top: the module's views, with the liquid lens as the
  selection. Below a hairline, quieter and **folded until wanted**: what the module is made of
  (Finance: accounts, ways to pay, subscriptions). Foot: import, settings, Legacy Finance.
  - Rows there read before they edit: an account or a way to pay opens its details panel.
  - Balances follow the totals: hidden until the owner reveals them.
  - It can be put away (its own button, or Ctrl+\). Then the views become **tabs** in the page's top
    bar and the rest becomes the **menu on the module's name**. Nothing is lost in either state.
- **The top bar** belongs to the page: search, settings, the Add pill (with the sidebar away: sidebar
  button, module menu, tabs). It is clear at rest and turns to glass once the page scrolls under it. It
  is the window's drag strip; the right end belongs to Windows' own buttons.
- **One filled button per view.** Where a frame brings its own (Transactions, Accounts, Digital IDs),
  the top bar's "+ Add transaction" steps back to an outline pill.
- **Panels, not pop-ups** (owner: "the screen popups in centre for stuff that can be from the right
  edge"). Under this shell every sheet (add, details, account, import, settings, ID) stands on the
  **right edge**, full height, so what it was opened from stays in view. A light veil, no blur, over the
  page. In from the edge in 340ms, out in 150ms. Same component (`finance/components/Sheet.tsx`); the
  placement is CSS under `:root[data-nx]`, the glass is a thinner, clearer recipe (`SIDE_GLASS`).
  Confirmations stay small and centred.
- **Clearer glass.** Panels, the dock, menus and toasts carry less tint, so what is behind them shows.
  The engine's navy tint is made neutral under this shell.
- **Charts** ([`next/charts.tsx`](ui/src/next/charts.tsx)). Drawn at the size they are shown, in ink.
  Every chart **answers the pointer**: the figure under it is read out in a small glass chip. A new
  series draws in from the left once (clip-path). Kinds: area (value over time, with its high and low
  named), pace (this month against last, day for day), flow (in and out by month), columns, ring (the
  centre speaks: total at rest, the slice under the pointer), meter (a tick marks today), share, stack.
- **Motion.** The dock travels to its edge in 420ms on the entering curve. When the sidebar opens or
  the dock changes edge, the paper stretches from its old shape while its contents slide (transform
  only). A view arrives with an 8px rise, no fade.
- **Finance, second version** ([`next/finance/`](ui/src/next/finance/)):
  - **Overview** answers three questions. *Where do I stand*: net worth with the range control on the
    chart it drives, the change in rupees first (a percentage only when the start is not near zero),
    and what it is made of (cash / invested / debt). *How is the month going*: kept, in, out, and the
    pace line against last month. *Anything to do*: budgets with today's tick and "free to spend" as a
    daily figure, what is upcoming (subscriptions **and** standing instructions), what needs review.
    Then recent activity with quick add, where the money is by account, and the month-end forecast.
  - **Spending**: in and out by month, the share of income kept as a ring, every category with its
    change against the previous period, each day of the period, top merchants, paid with, weekdays,
    needs review. WEEK / MONTH / YEAR still drives every card.
  - **Left the Overview:** the page title and date, the wallet stack (the cards live in Accounts), the
    three stat tiles (folded into the month card), a second copy of net worth.
  - **Transactions** reads like a statement: rows a third shorter; the end-of-day balances sit on the
    day's own line instead of a row under it; filtered to one account, every row shows the balance
    after it; a period filter; what is on screen is always totalled; a guess is confirmed on the row
    (the amber "auto" chip is the button); `/` focuses search. Right-click is the first tracker's menu.
  - **Accounts**: one kind of card for every account (the first version split them into tall coloured
    cards and table rows by whether a colour had been picked), grouped by what the money is for, under
    one bar showing how net worth splits. Every balance sits behind the same veil as the totals. A
    standing instruction shows on the card it feeds. The owner's colour for an account is a quiet wash
    in the card's corner. Ways to pay are rows with what went through each this month.
  - **Invest** opens with the owner's investments (the first version was only a gold rate): invested
    over time, where it sits, what went in this month and this year, and digital gold in grams at
    today's rate. It says plainly that the line follows contributions and set balances, not a market
    return. The IBJA gold rate follows, in gold: the one chart drawn in its material's colour.
  - **Digital IDs**: renewals first, by date; the number itself is the copy button; Edit is a button
    beside Show and Copy (the card no longer opens the editor when clicked); documents not added yet
    are small add chips, not full-size ghost cards.
- **Home** ([`next/home/HomeNext.tsx`](ui/src/next/home/HomeNext.tsx)) — the day at a glance, and
  little else (owner: "a simple home dashboard, without a lot of data when I open the app", with "more
  character").
  - **The sky** is the colour of the hour: dawn, day, golden, dusk, night. It is the one place the shell
    uses colour as atmosphere, and its reason is the time. The sun (a moon at night) sits on an arc
    where the day has got to; today's time blocks and calendar events stand on the horizon, a long one
    as a bar, a short one as a dot, at most four, the ones still to come first. A label takes only the
    room between its neighbours.
  - **One line under the greeting** says what the day holds, put together from the modules: tasks due
    and late, what is next or on now, all-day events, a charge due today or tomorrow, transactions to
    review. Nothing in it is invented; when there is nothing, it says so. The greeting is the first
    Home's own (`getGreeting`).
  - **The search field** sits half on the sky, in glass. It opens search (the assistant's seat later).
  - **Two cards, no more:** the one task to do next, and the month's money (spent, free to spend or
    kept, net worth behind the veil, the pace line).
  - **No sidebar and no tiles.** Home has no views, and the modules are in the rail. The rail's tiles
    carry amber badges for what is waiting (transactions to review, tasks due or late).
  - Home reads from every module and writes to none.
  - **Left out on purpose:** the four big app tiles and the two launcher buttons (the dock does that),
    and the Portfolio tile, which showed placeholder figures for a module that does not exist.
  - The first Home is kept, unchanged, as **Legacy Home** (Ctrl K → "Legacy Home").
- **Tasks** ([`next/tasks/`](ui/src/next/tasks/)) — third version, 2026-10-07: **Tasks | Projects**.
  Owner: "divide it into tasks and project. The tasks module should just be the kanban board, and the
  project should hold all details from the current tasks app… remove repetitive buttons, more button,
  and more options, keep everything minimal." The composition follows the reference he chose that day,
  Hark (its launch film, hark.com, and two screenshots of his own account). Same files and
  `TasksContext` as §14; nothing about how a task is stored changed.
  - **Taken from Hark:** no sidebar; one switch in the middle of the top bar (a capsule with an ink
    thumb); a stack of small panels beside the main column; borderless panels with lighter tiles
    inside (the step in lightness is the edge); actions written as a verb and a sentence; one grouped
    list with hairlines between rows and a chevron at the end; a page that stands on the sky.
  - **Kept Axonix:** Geist only (Hark's serif was not brought in); pills for everything pressed, so the
    verb is a pill, not Hark's rounded square; figures in Azeret; dark at every hour (Hark turns light
    by day); no purple (Hark's night is indigo, this one is navy).
  - **The sky is the page.** Home's five moods (`next/sky.ts`), with deep blue overhead at every hour
    and the hour's colour low down: navy at night, ember at dawn, clear blue by day, amber in the
    golden hour, rose-ember at dusk. Its reason is the hour, as on Home. It changes over 1.6s.
  - **Top bar:** the one-line add field on the left (`Ctrl+N`; Shift+Enter opens the composer), the
    switch in the middle of the page, and on the board a filter on the right (`/`).
  - **Tasks is the board and nothing else.** Five columns of every task. One row above it says whose
    tasks show: All, Inbox, each project with its mark and its open count (or, in red, how many are
    late). Press a project again to return to All; the choice is remembered. A project chip lifts, and
    takes a dropped task.
    - A card says the title, then only what decides the day: project, due, a time block that is
      today's, subtasks. Priority is the ring on the checkbox. Estimate, tags and the notes mark are
      in the task's panel.
    - **Left the board:** the title and count line, the Project, Due and Priority menus, Clear, Group
      (swimlanes), and the Board/List switch. The list is where a list is wanted: on a project.
    - **Delete finished**, at the foot of Done (owner, 2026-10-07: "add an option to delete completed
      tasks"). Quiet text until pressed; then it asks in place, with the number: "Move 3 finished tasks
      to the trash? Move · Keep". It takes every finished task that is showing (the scope and the
      filter apply; the ones older than a week are included). One change, one Undo; the files go to
      `Tasks/.trash`. Not offered while another day is showing, or when nothing is finished.
  - **Projects is everything else.** Left, the day, each piece left out when it has nothing to say:
    **Today** (late, in hand, due, timed today; up to six, then a link to the board), **Agenda** (time
    blocks and calendar events with the time now), **Ahead** (the next two weeks, soonest first, and
    how many tasks have no date), **Momentum** (this week, the streak, Doing to Done). Right, the
    projects as one list: mark, name, the goal as written, late in red, done of total, and the Inbox
    last. A round `+` names a new one in place.
    - **An action** is a card: the title's opening verb is the button ("Pay" · "the water bill"), and
      pressing it finishes the task with the same tick and Undo as the round checkbox. A title that
      does not open with a verb from the list (`next/tasks/verbs.ts`) keeps its words and gets a tick.
  - **A project** opens the first workspace (hero, date flow, activity, dashboard widgets, timeline,
    library, moodboard, discover, compare, scholarships), standing on the sky with pills for tabs. Its
    first tab is **Tasks**: its own tasks as a list, grouped Doing · To do · Blocked · Backlog · Done,
    with one link, **Board**, that shows them on the board. It has no board tab of its own. A round
    back button returns to the projects; so does the switch.
  - **One of each:** Research sources is a small globe at the end of a project's tabs, and only on a
    project that looks things up (it has a profile or a programme). It left the top bar and the
    sidebar's foot. Legacy Tasks is in Ctrl K only. The task panel lost its Close pill (the ✕ and
    Escape close it) and the project line under the title (the Project field says it).
  - **Gone with the sidebar:** Upcoming as a view (Ahead holds it) and Today as a page (the stack
    holds it). Ctrl K has "Projects" beside "Tasks".
  - **Colour in Tasks:** blue is *now* (in hand, the now-line, today on the timeline); amber is due
    today, due soon or blocked; red is late; green is done. Project dots keep their hue.
  - The task sheet, the composer and the research sheet open as right-edge panels.
- **Pages that lay themselves out** (`Shell`'s `fill`). A calendar grid, a document and a web page
  scroll their own parts, so on those the page does not scroll as a whole: the module fills the paper
  under the top bar and above the dock's strip. Used by Calendar, an open note, the Storeroom and Social.
- **The skin never drops between modules.** `data-nx` comes off the root only when no shell is left on
  screen. Before this, one module handing over to the next flashed the first version's colours on
  anything with a colour transition.
- **Search, jump, or add** (Ctrl K, the mark, the top bar's search) is glass and reaches every module:
  from two letters it finds tasks and notes by name and opens them where they live; it opens any
  module, any project, any first version; "Add a task" and "New note" are commands. Searching the
  ledger is the last row, so a command that matches takes Enter.
- **Calendar** ([`next/calendar/`](ui/src/next/calendar/)) — a module of its own. Same data as §14:
  time blocks are tasks with a `scheduled` time, events are Google's, the two-way sync is unchanged.
  - **Sidebar:** Week, Day, Month, Timeline (keys W D M L). Then a small month to jump with: the days
    the page is showing are one band, today is ringed, a dot means something of yours is on that day.
    Then Google's calendars, each with its colour and a switch (these were inside a sheet). Foot:
    Google Calendar, Legacy Calendar.
  - **Top bar:** the one-line add field, as in Tasks (Ctrl+N).
  - **Week** is the first calendar's grid with every pointer action kept (drag a task in from "To
    schedule", move, resize, double-click a slot). New: **press on an empty slot and drag** to draw a
    block of the length you want, then name it; each day says how much time is planned on it; the hours
    before 07:00 and after 21:00 are quieter; "To schedule" is grouped Late / Due within a week / No
    rush and can be put away (S); the time now stands in the gutter, not on top of a block.
  - **Day** (new): the same grid for one day. Pressing a day's name in the week opens it.
  - **Month** (new): a week to a row, each day listing all-day events, what has a time, then what is
    due, with "n more" when it does not fit. Pressing a day opens it.
  - **Timeline** replaces the old four-week list: five weeks, rows gathered under their project,
    weekends marked, a line for today, bars cut square where they run past the window.
  - **Colour in Calendar:** blue is now (the now-line, a block that is happening). Amber is due (the
    ring on a due task). An event keeps its calendar's colour: it is the owner's. Time blocks are ink,
    with the project's dot.
  - An event opens a small glass card; a block or a due task opens the task panel.
  - T is today, the arrow keys move by one page of the view.
- **Notes** ([`next/notes/`](ui/src/next/notes/)) — a module of its own. Same files and `NotesContext`.
  The document (`NotePage`: the block editor, saving, the recovery draft, export, properties) is the
  first Notes' own and is not rewritten: it is what stands between a keystroke and the file.
  - **Library** (new): with no note open the page is the notes as cards, gathered Pinned / Today /
    This week / This month / Earlier. A card says the kind, the project and, when the note holds a
    checklist, how far through it is (green when finished). Right-click a card to pin or delete it.
    The first Notes showed a welcome message in this space.
  - **A note open:** the document, with the notes of the current view in a list beside it that can be
    put away (the document's own focus button). The way back to the library is always on screen.
  - **Sidebar:** All notes, Pinned, then the collections. Under them **Types** and **Projects** as
    switches with counts: press one and the library shows only that, press again and it lets go; the
    two can be on together. A mix of type, project and search can be kept as a collection (a kept
    filter, not a folder). Foot: Templates, Import, Recently deleted, Legacy Notes.
  - **Top bar:** search (Ctrl+Shift+F) and the one filled pill, New note (Ctrl+N).
  - The open document saves before anything takes its place: another note, a view, another module.
  - The editor's own theme is ink. A ticked box is green (done). A link is ink with a rule under it.
- **Storeroom** ([`next/storeroom/`](ui/src/next/storeroom/)) — same library on disk and the same
  `StoreroomContext`. The masonry grid, the add field, the item panel and Social beside the grid are
  the first Storeroom's own.
  - **Sidebar:** Everything, Unsorted (amber count: no why and no tag yet), Images, Motion, Vectors,
    Links, Notes; then **every** tag (the first version showed fourteen). Foot: Open the folder, Open
    in its own window, Legacy Storeroom.
  - **Top bar:** the add field (Ctrl+L), search (`/`), Social beside the grid.
  - **New:** order (newest, oldest, by title) and picture size (S / M / L), both remembered.
  - **The module's tan is ink.** The references are the only colour on the page. A vector keeps the
    light sheet under it. Dropping shows a pane of glass with a solid edge.
  - The item opens as a right-edge panel. Its own window (`#storeroom`) is this same module with no
    dock and no ruler (`StoreroomAlone`); Legacy Storeroom is in its sidebar foot.
- **Social** ([`next/social/`](ui/src/next/social/)) — the pages are the first Social's own (`Site`):
  one webview per app in its own saved session, the same allowlists, freeze-then-sleep, launch out of
  the icon, sign-in filling. What changed is where the controls live.
  - **The six apps are the sidebar** (Axonix has one dock now, for its modules). Each keeps its own
    icon, shows whether it is open or asleep, and carries its unread count in amber. Drag one onto the
    page for split view; right-click for its menu (the shared glass menu).
  - **Top bar:** back / forward / reload for the focused pane; in split view the two panes, swap and
    exit; then the sign-in chip, Overview and Passwords.
  - **The page** is the web page, with a hairline and rounded corners, standing clear of the dock.
  - **New:** with nothing open the page shows the six apps as tiles (it used to be one line of text),
    and the unread total sits on the Social tile in the dock.
  - Kept on purpose: Social opens on an empty page every time; Escape closes the top layer, then split
    view, then Social. One press now does exactly one of those.
- Every first version is untouched and looks as it did: every override here sits under
  `:root[data-nx]`, which only the new shell sets.
- **Lift** ([`next/lift/`](ui/src/next/lift/)) — hold anything and it comes off the page as glass.
  Approved in the mockup; built 2026-10-02.
  - **Everything can be lifted** (owner, 2026-10-03: "anything and all components and i mean this").
    The architecture is built on it: a component does not opt in. Three families of thing
    (`things.ts`):
    - **Records**, which a row names with `liftAttrs(thing)`: a transaction, a task (row, board card,
      time block, "to schedule" item, Home's next-up), a calendar event, a note, a Storeroom
      reference.
    - **Places**, also named: an account, a way to pay, a category, a budget, a subscription, an
      identity document, a project, a tag, a day. And a **part** of a page, which nothing has to
      name: any card, chart, panel, list, sidebar entry or whole view is read off the page
      (`resolve.ts`) and called by its heading. A part's id is where it is
      (`finance/overview#net-worth`), so it can be kept, linked and found again: opening it goes to
      that view and marks the part for a moment.
    - **Loose things**, with no home in Axonix yet: words (a figure with its label, a heading, a
      chip, **the text you have selected**), a link, an image, a file. They come from a page or from
      **outside the window**: a file, a link, a picture or text dragged in is held the same way.
  - **How:** a row lifts as soon as the pointer moves. Everything else lifts when held still:
    280 ms for a named thing that has a drag of its own (board card, time block, reference), 450 ms
    for anything read off the page, so a slow click is still a click. From 150 ms a short blue line
    charges at the pointer; a move during the hold means something else (selecting, scrolling) and
    nothing lifts. Escape puts it back. **L** keeps the focused thing in the Pocket.
  - **Never lifted**, because a press there already means something: a field being typed in, a web
    page, a slider or a handle, the dock's own tiles and buttons.
  - **Never read**: a page marked `data-lift-private` (Digital IDs). A document lifts as what it is
    and when it ends; a part of that page lifts by name only. An ID number is never in a lifted
    thing, so it cannot reach the Pocket file, a note, a task or the assistant.
  - **A panel steps aside.** While something is held, a right-edge panel stops being modal, so a
    thing can be carried out of it to the page or the dock; it is modal again on release.
  - **The ghost** is the one piece of glass on the page: icon, title, one line, the amount. It trails
    the pointer on a spring and leans with its speed. What it left behind is dimmed in place.
  - **Where it can go** (`data-drop`). Every place that will take it is outlined; the one under the
    pointer turns blue, and a blue pill under the ghost says what a drop will do. Blue because it has
    not happened yet.

    | Drop on | What happens |
    |---|---|
    | The Pocket | Kept, to carry into another module |
    | The mark | Search everything for it |
    | Tasks tile | A task about it, linked to it if it has a home; words, a link or a file become the task's title and notes |
    | Notes tile | A note about it, linked to it; words, a part of a page or a text file become the note's text |
    | Calendar tile | Time blocked at the next free half hour |
    | Storeroom tile | A link, a picture or words are kept as a reference |
    | Finance tile | A statement file (CSV, PDF) opens in the import panel, already read |
    | The page itself (from outside only) | The same as that module's tile |
    | A day's column (week, day) | Time blocked on that day at that hour |
    | A day (month cell, small month, day name) | Due that day; for anything but a task, a task about it due that day |
    | A project in the Tasks sidebar | Moved there; for anything but a task, a task about it there |
    | Any other thing, or an open note | The two are linked. Words, a link or a file dropped on a task go into its notes instead: a link needs both ends to have a home |

  - Every drop that changes something says so in a toast with **Undo**. A thing that was made adds
    **Open**.
  - **Links show from both ends:** a "Linked" strip of chips in the task panel, a transaction's
    details, a reference's panel and above an open note, and a small link mark on linked rows. A chip
    opens the thing, can be lifted again, and has an unlink ✕ (with Undo).
  - **Off** on a first-version screen, while the command bar is open, and while Scrub is not on
    today.
- **The Pocket** — in the dock, between the modules and the clock. Its slot (a quiet ring with a
  plus) is always there, so nothing in the dock moves when a thing is picked up; held over, it turns
  blue. It shows three things (tile, title, amount; a picture as itself) and counts the rest; twelve
  at most. Press one to open it (a part goes to its view, a link to the browser, words are copied),
  drag it out to use it (it then leaves the Pocket), ✕ takes it out. A picture dragged in from
  outside is kept in the Storeroom first, and the Pocket carries that reference. On a side edge it
  stands up and each thing is its tile alone.
- **Where links and the Pocket are kept:** `%LOCALAPPDATA%\Axonix\workspace.json`, a new file. No
  existing file or field changed. `{ version, pocket, links }`, written whole and atomically through
  `workspace:read` / `workspace:write`. If it cannot be read, nothing is written over it.
- **Scrub** ([`next/scrub/`](ui/src/next/scrub/)) — one day that every module shows itself as of.
  Approved in the mockup; built 2026-10-02.
  - **The ruler** is glass and stands beside the dock on whichever edge the dock is. Sixty days back,
    thirty ahead, today marked. Press or drag anywhere on it; ← → move a day, Shift a week, Home is
    today. **T** or the clock in the dock opens it; Alt + scroll over the page moves a day. Escape
    closes the ruler, then returns to today: one press, one thing.
  - **Looking back is warm, looking ahead is cool.** The page takes a wash from the top (`#e0b089`
    behind, `--nx-live` ahead), the top bar says "Looking back · Wed 23 Sep, 9 days ago" with **Back
    to today**, and the clock in the dock is ringed in the same tone. The page never looks like today
    when it is not.
  - **What each module shows.**
    - Finance, back: the ledger up to that day; balances and net worth as they stood.
    - Finance, ahead: subscriptions and standing instructions due by then as **Expected** rows, and
      one **Estimate** row for everyday spending at the recent daily rate (none with under two weeks
      of history). No income is assumed. A figure that has not happened is blue and says so.
    - Tasks, back: the tasks that existed, in the state they were in.
    - Calendar: the page follows the ruler; there is no now-line.
    - Storeroom, back: what had been kept by then. Home: that day's line.
    - Notes, back: the library narrowed to what had been written by then.
  - **For looking, not changing.** While the day is not today every change is refused with one toast
    that says why and how to get back, the buttons that add things step back to 45%, menus that only
    change things do not open, and Lift is off. The lens (`Lens.tsx`) hands the screens a copy and
    swaps every mutator for the refusal, so there is no path from that copy to the owner's files. A
    refusal is never followed by a success toast.
  - **The one exception is an open note.** A note keeps one text and no history, so it reads, and can
    be edited, as it is today.
  - Day names in the ledger are measured from the real today, so "Today" is never a day that is not.
- **Quick add in the command bar** — a line that reads as money ("paid 450 chai") is offered first:
  "Add an expense: ₹450 · Chai". Enter opens the Add sheet filled in, and the sheet saves it. Nothing
  reaches the ledger unseen.
- **Axonix on the mark** ([`assistant/`](ui/src/assistant/); main process `ui/electron/chatgpt.ts` and
  `chatgpt-core.ts`) — the assistant. Built 2026-10-02 to the mockup's ask card.
  - **Where.** A glass panel standing off the dock by the mark: right-aligned to the dock, beside it
    on a side edge, low and centred over a first-version screen. It opens with **Ctrl+J**; from the
    command bar ("Ask Axonix", and "Ask Axonix: “…”" for anything typed, placed first when the words
    read as a sentence and last when they read as a search); and by dropping a lifted thing on the
    mark ("Ask Axonix about this"). Escape closes it. It and the time ruler never show together.
  - **What it shows.** The question, with the thing's chip if it is about one. Then each step as it
    happens. Then the answer, 15 / 1.6. A step is a tool the model really called, never invented
    text: a green tick and one plain line. A step that changed something carries **Open** and
    **Undo**; undone, it is struck through. A step that did not work has an amber mark.
  - **At work.** The mark's three terminals light in turn in signal blue (120 ms apart on a 1.2 s
    loop), in the panel's head and on the dock, and a 56 px pulse runs along a hairline until words
    arrive. Nothing spins (the mockup's ring was dropped for this).
  - **Errors.** One sentence, the cause then the fix, in an amber-edged box with the one action that
    helps: Manage usage (a usage limit), Continue with ChatGPT (the sign-in ended), or Try again.
  - **The engine is the owner's ChatGPT plan** (OpenAI's "Sign in with ChatGPT", open to personal
    projects that run locally). OpenAI's wording is followed as written: the button reads "Continue
    with ChatGPT" (text only; their mark is not vendored yet), the first sign-in is confirmed once
    with "You're using your ChatGPT plan" and Got it, and "Using ChatGPT plan · Manage usage" stays
    under the field.
  - **What it can do** (thirteen tools): read the month, the ledger, spending added up, ID expiry
    dates, tasks, one task, the calendar, notes and one note; add a task, change a task (finish it,
    its day, its time block, its project), record an expense or income, write a note. **It cannot
    delete anything, and cannot change a note or a transaction that exists.**
  - **Machine-made is marked.** A task and a note carry `status: unverified`; a transaction carries
    the `auto` chip and waits in Needs review.
  - **Kept from it.** ID numbers, card and account numbers, statement passwords and saved sign-ins
    are not read by any tool, so they cannot be sent.
  - **While another day is showing** (Scrub) it reads as of that day and refuses changes.
  - The conversation lasts as long as the window. Nothing is kept on OpenAI's side between requests.
  - Toasts stand beside the panel while it is open, never under it.
- **No light theme.** The owner dropped it (2026-10-02). Dark is the only theme.
- **Calm** (2026-10-07; plan `docs/plan/20 Calm Overhaul Plan.md`, built the same day at the owner's
  word "Proceed with all 10 steps", on its five recommendations). Styles: the last section of
  [`next-modules.css`](ui/src/styles/next-modules.css). Code: [`next/motion/`](ui/src/next/motion/).
  A page of the moves to tune by: `design-explore/calm-overhaul/index.html` (outside the repo).
  - **Two speeds.** *Touch* (press, hover, a tick, a chip) is the app's old one, untouched. *Scene* (a
    view, a module, a panel arriving) is 420ms in and 200ms out (`--mv-in`, `--mv-out`). **From the
    keyboard a scene is instant**: the root carries `data-nx-input`, and a key sets both to 1ms.
  - **Arrive / Leave.** A view comes out of an 8px blur at 98.5% and sharpens; nothing slides in from
    an edge. This replaced the 8px rise.
  - **Stack.** A page's pieces arrive 45ms apart, six at most, the rest together: a module page's
    head and cards, the board's five columns, the Projects stack.
  - **Module to module** is one browser view transition (`App.tsx` `between`): what was there blurs
    away while the next arrives, and the rail is lifted out of the picture so it holds still. Not into
    or out of Social (a web page only ever moves and fades), and not from the keyboard.
  - **Becomes.** A task opened from its card, row or action grows into its panel
    (`next/motion/becomes.ts`): the two share one name for the length of the move.
  - **Thumb.** Every selection on a page is a thumb one tone lighter that slides. **The refracting
    lens is retired from pages** (D1): a page that arrives out of a blur switches a lens off. The
    first versions keep theirs. `useLiquidGlass` takes `onPage` for this.
  - **Word change.** Counts roll: the board's scope and column counts, the Projects line, the rail's
    badge (`next/motion/Count.tsx`, NumberFlow 0.6.2, MIT, the one package added).
  - **The sky is every module's page** (D3), still (D4), by the hour. Home keeps its own band and its
    paper page, by the owner's "keep rest of the homescreen same". Cards are borderless panels.
  - **Panels are frosted, not refracting**, and start under the window's buttons. Measured: with the
    engine, a panel's entrance ran 15 of its frames long; frosted, 1 or 2.
  - **Simplified after measuring** (Intel UHD 630): the Projects stack and Finance's cards arrive
    clear, not blurred. Many small blurs at once, or a blur over a chart, dropped frames.
  - **One door for one job** (a key is not a second door). Gone: the top bar's search field and
    search icon (the mark and Ctrl K remain; Notes and the Storeroom keep the field that filters
    their own page); "Legacy …" from five sidebars and their menus (Ctrl K has them; the Storeroom's
    own window keeps its row, having no Ctrl K); Finance's settings icon (the sidebar row remains);
    Calendar's second Google Calendar row; Templates in Notes' empty page; "Open Tasks" and "Open
    Finance" on Home's cards (the arrow in each card's head remains); the add line's expand button
    (Shift+Enter remains, and the reading panel names it).
  - **Not done:** type stayed at 13 to 13.5px (D5 as recommended); Finance's own figures do not roll
    (they sit behind the privacy veil and its formatting); "Go to accounts / Accounts / Set balance"
    on Finance's Overview and the quick-add line beside "+ Add transaction" are untouched; Social's
    top bar was not audited; no rows morph, only tasks.
- **Not built yet:** Plan and Wallet (still marked Soon).

## 17. Agents at the door (2026-10-04, the Claude pilot)

Built from docs 17 and 19; not yet seen by the owner. His words behind it: other AI sessions should
"show up as an AGENT working in the AXONIX workspace", with live cursors like a shared document; "I
want the ability to talk to every agent in the AXONIX app itself too."

- **Nothing is drawn that did not happen.** A row exists only for an agent that has really called
  through the door. A cursor moves only because a real call named a real task or note. A step is a
  call. There is no demo state.
- **Where agents are: the left sidebar**, as a section at the foot of every module's sidebar, under a
  hairline, headed **Agents**. Nothing was added to the dock. Where a module has no sidebar on screen
  (Home, or the sidebar put away) the busiest agent is a chip in the top bar.
- **A row:** the agent's mark in a 24px tile, its name, the program and plan under it ("Claude Code ·
  Pro"), and its state at the right. **Idle** is quiet ink. **Acting** is the live blue (mark and
  word), from its first call until a minute of quiet. **Waiting on you** is amber: a work order is
  filed and unassigned. The mark is ink, like every mark here; no brand colour.
- **The cursor:** an arrow in the live blue with the agent's name on a tag. It sets out from the
  agent's row and glides (620ms, the entering curve) to the far side of the row or card, so the title
  stays readable. What was changed lights once (a blue ring, 1.5s) and rests. A call with nothing on
  screen to point at (a search, a list, a thing in another module) pulses the agent's row instead.
  It leaves after 2.6s of quiet. Transform and opacity only; with reduced motion it appears in place.
- **A change says so:** the usual bottom toast, with the step's own words, "Claude · machine-made",
  and **Undo**.
- **Pressing a row opens the agent** in a panel on the right edge that is not a dialog: the module
  stays usable beside it, so the agent's words and its cursor are on screen together. Paper, not
  glass (it rests). Tabs: **Terminal** (Claude Code only: the real program, Cascadia Mono 12.5 on
  the sink colour), **Steps** (every call, newest first, a green tick or an amber mark, the time, Open,
  Undo; undone is struck through), **Setup** (how it is connected, what it may do, Follow, and the
  chat panel's switch with its caution in full). **Chat** appears only once switched on.
- **Agents** (the section's heading) opens the same kind of panel: who is at the door, Paperclip's
  workers with runs, tokens and budget, open work orders (an unassigned one has an amber edge and the
  one blue button, "Assign to Claude worker"), and runs (status in green, amber or blue; pressing a
  worker's run shows the calls it made, read from the door's log). With Paperclip stopped it says so
  and offers to start it.
- Escape closes a panel, except while the terminal has the keyboard.
- **Not designed yet:** several cursors at once, a room for more than one agent, "@" in the line,
  watch mode (holding a write until the cursor arrives), marks for agents that are not Claude.
