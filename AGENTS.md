# AGENTS.md — orientation for AI agents

Read this before touching anything in this repo. It is the map, the rules and the traps. Everything
here was learned by getting it wrong once.

## 1. What this is

A personal, local-first Windows workspace owned and used daily by one person, holding
**real money and identity data**. It ships as **one desktop app, `Axonix.exe`** (Electron 44 +
React 19 + Vite), with four surfaces in one window:

| Surface | What it is | Code |
|---|---|---|
| Home | Launcher tiles | `ui/src/home/` |
| Finance | Net worth, accounts, spending, transactions, gold, digital IDs | `ui/src/finance/` |
| Social | Instagram, X, Threads, Reddit, LinkedIn, Pinterest behind a dock; split view; saved sign-ins | `ui/src/social/` |
| Tasks | Dashboard over a kanban; one markdown file per task in the vault's `Tasks/`; Notes (any `.md` in the vault) and Calendar (Google, two-way time blocks) | `ui/src/tasks/`, `ui/src/notes/`, `ui/src/calendar/` |
| Storeroom | Inspiration library: drop / paste / Social right-click; one folder per reference (`R0042`) in `D:\04 Media\Storeroom`; also its own window (`--storeroom`) | `ui/src/storeroom/`, `ui/electron/storeroom.ts` |

Since 2026-10-02 every surface also has a **second version in the new shell** (`ui/src/next/`,
DESIGN.md §16), and that is what the dock opens. The folders above are the first versions: they still
ship, each opens as "Legacy …", and the new modules host many of their pieces (contexts, sheets, the
board, the note editor, the Storeroom grid, Social's pages). A change there shows in both.

Two things run across every new module (DESIGN.md §16):

- **Lift** (`ui/src/next/lift/`). **Everything on a page can be picked up, without opting in**:
  `resolve.ts` reads what is under the pointer. So when you add a component:
  - A row or card that stands for a record or a place (a transaction, an account, a project) should
    still carry `liftAttrs(thing)`: it then has an id, can be linked, and lifts as soon as it moves.
  - Give a card a heading, an `aria-label` or `data-lift-title`: that is what it is called when held.
  - **Anything that can show a secret** (an ID number, a card number, a password) must sit inside
    `data-lift-private`, or name a thing that leaves the secret out. Otherwise its text is read off
    the screen and can end up in the Pocket file, a note, or sent to the assistant.
  - A place that takes a drop carries `data-drop` (the list is at the top of `Lift.tsx`).
  - A handler for files dropped from outside must leave the drop alone when
    `event.defaultPrevented` is already true: Lift took it.
- **Scrub** (`ui/src/next/scrub/`). While the ruler is off today, screens read finance, tasks and the
  Storeroom through `Lens.tsx`, which hands them a copy and refuses every change. **A new mutator on
  one of those contexts must be refused there too**, and a new view must take its day from `useDay()`,
  not `todayIso()`, or it will show today's figures under a "Looking back" banner.
- **Not on screen since 2026-10-07** (owner: "remove claude and AI integration from the UI, keep
  backend for now"): the two items below, the assistant and the door, have no surface. `Ask`,
  `DoorLayer`, `AgentsSide` and `AgentsChip` are unmounted; `AssistantProvider` and `DoorProvider`
  still wrap the app, so a guest's call through the door still runs on the page. Do not mount them
  again, or add an agent or assistant control anywhere, unless he asks.
- **The assistant** (`ui/src/assistant/`, `ui/electron/chatgpt.ts`, `chatgpt-core.ts`). It runs on the
  owner's ChatGPT plan; tokens stay in the main process. Its tools are in `assistant/tools.ts`. **A
  new tool must** return its own undo if it changes anything, mark what it makes as machine-made,
  refuse while Scrub is off today, and never read an ID number, a card or account number, a password
  or a saved sign-in. There is no delete tool; adding one is the owner's decision. Check the sign-in
  and request code with `node ui/scripts/assistant-check/run.mjs` (no account needed). Never sign in
  for the owner and never print or copy his tokens.

- **The door** (`ui/electron/door.ts`, `ui/src/door/`, doc 19). Outside agents (Claude Code, the Claude
  desktop app, a Paperclip worker) reach Axonix through one MCP server inside the app, on 127.0.0.1,
  with a token each in Credential Manager. It runs no tool itself: each call goes to the page and is
  run by the assistant's own `runTool`, so a guest gets the assistant's rules and its Undo. **Which
  tools a guest may call is the list `PAGE_TOOLS` in `door.ts`**: money is read-only and
  `finance_ids` is not offered, by the owner's decision; widening it is his to decide. A new agent
  is a new line in `DOOR_AGENTS`. Never print, log or copy a door token; `node scripts/door-agent.mjs`
  connects an agent without showing one. Test against a scratch run (section 5), never the real door.

`ui/electron/main.ts` is the main process for all of them. Behind it, a Rust core (`crates/`) treats the
surrounding Obsidian vault as the source of truth, indexes it, and serves it to Hermes agents over
MCP; `axonix-capture.exe` (a loopback server for the browser clipper) is started by the app.

The old Tauri shell (`crates/axonix-app`) and the separate Social build were retired and moved to
an archive folder outside the repo (Decision Log, 2026-09-16 REVERSAL and 2026-09-18).

This is one person's tool, not a product: prefer their stated preference over a general best
practice, and never trade their data for convenience.

## 2. Hard rules

1. **Never erase or modify the owner's data** unless they asked for that specific change in their
   own words. A request to change the *app* is never permission to change their *data*. The
   protocol — snapshot, rebuild, verify — is mandatory:
   [`.claude/skills/axonix-safe-change/SKILL.md`](.claude/skills/axonix-safe-change/SKILL.md).
2. **Rebuild and relaunch after every change** with `scripts/rebuild-app.ps1`, then prove the data
   survived (`verify` against your pre-change snapshot must say `PASS`).
3. **Never trust `%LOCALAPPDATA%` from an agent shell.** Some hosts virtualize it, so you see a stale
   private copy of the owner's data. `node scripts/finance-data-guard.mjs where` resolves the real
   file (`REAL yes`, a `\\localhost\C$` path). The app refuses to start from such a shell; the
   rebuild script launches it through `explorer.exe`. Never launch `Axonix.exe` directly.
4. **Anything machine-made is unverified.** Vault notes land `status: unverified`; imported or
   guessed categories carry an `auto` chip until a person confirms them. Never write `verified`.
5. **Follow `DESIGN.md`** for anything visual. It records the owner's own words on what they want and
   what they rejected; it outranks your taste.
6. **Ask before schema changes.** New fields are optional and additive; never rename or drop one.
   `migrate()` in `ui/src/finance/repo.ts` must carry every old record forward.
7. **Never click a system or security prompt for the owner** (Windows Firewall, UAC). Tell them.

## 3. Where things live

**Owner data (never edit by hand)**

| What | Where |
|---|---|
| Finance + digital IDs | `%LOCALAPPDATA%\Axonix\finance-data.json` |
| Tasks (one `.md` per task, folder per project; `.trash\` holds deleted ones) | `D:\05 Notes\My Vault\Tasks\` |
| Backups (startup ×20, named ×60; `tasks-<unix>-startup\` ×20) | `…\Axonix\backups\` |
| App log | `…\Axonix\logs\axonix-app.log` |
| Browser profile: social sessions, window state, split layout | `%LOCALAPPDATA%\Axonix Profile\` (`state.json`) |
| Saved sign-ins, statement passwords, the Google OAuth client and refresh token (`Axonix Google`) | Windows Credential Manager, never a file |
| Google Calendar state: account, the Axonix calendar id, calendars shown, last-synced blocks; offline copy of events | `%LOCALAPPDATA%\Axonix\calendar.json`, `calendar-cache.json` |
| Links between things, and what is in the Pocket (Lift) | `%LOCALAPPDATA%\Axonix\workspace.json` |
| The door: its port, when each agent last called, whether the chat panel is on. Nothing in it lets anyone in | `%LOCALAPPDATA%\Axonix\door.json` |
| Every call through the door (agent, tool, what it touched, how it ended; no arguments or results) | `%LOCALAPPDATA%\Axonix\logs\door.log` |
| Door tokens, one per agent (`claude`, `claude-desktop`, `claude-worker`). Never read out, copied or logged | Windows Credential Manager, `<agent>.Axonix Door` |
| Where Axonix starts Claude from (the terminal tab, the worker), and the worker's MCP config | `%USERPROFILE%\.axonix\` |
| The assistant's ChatGPT connection: this installation's id, the issued client id, who is connected, the chosen model | `%LOCALAPPDATA%\Axonix\assistant.json` |
| The assistant's ChatGPT tokens, encrypted by Windows for this user (`safeStorage`). Never read, copied, logged or printed | `%LOCALAPPDATA%\Axonix\assistant-credentials.bin` |
| Notes | Any `.md` in the vault; deletes go to the vault's `.trash\` |
| The vault | `D:\05 Notes\My Vault` |
| Storeroom (references: media + `item.md` per folder; `.trash\` holds deleted ones, `.cache\` is disposable) | `D:\04 Media\Storeroom\` (`AXONIX_STOREROOM` overrides) |
| The owner's design language (read by the global `design-language` skill) | `D:\05 Notes\My Vault\Design Language\` |

**Code**

| Path | Notes |
|---|---|
| `ui/electron/main.ts` | The only authority: finance file IO + backups, keyring, gold fetch, which site a `<webview>` may load, navigation rules, shortcuts, window state |
| `ui/electron/preload-host.ts` | The page's whole API (`window.axonixFinance`, `window.axonixSocial`) |
| `ui/electron/preload-guest.ts` | Runs inside each social page: unread badge, sign-in detection (only while on screen), pinch zoom, "pressed" signal for split view |
| `ui/electron/background.ts` | Freezes social pages that have been off screen for 2 min (CDP `Page.setWebLifecycleState`), wakes them on show and briefly every 2 min |
| `ui/electron/blocker.ts` | Tracker blocking per social session (EasyPrivacy, `blocklists/`); `AXONIX_NO_BLOCKER=1` turns it off |
| `ui/src/finance/` | `ledger.ts` is the maths (balances derive from checkpoints, never stored), `repo.ts` persistence + migrations, `desktop.ts` the typed bridge to the main process, `parse.ts` one-line entry, `pdf.ts`/`csv.ts` statement import |
| `ui/src/social/` | `apps.ts` (the six apps and their allowed hosts), `SocialApp.tsx` (layout, split view), `Site.tsx` (one page), `Dock.tsx` |
| `ui/electron/tasks.ts` | The Tasks file service: list, write (only if the file still holds the expected text), rename, trash, restore, mkdir, watcher, startup backup. Refuses any path outside `Tasks/` |
| `ui/electron/vault.ts` | Notes file service over the whole vault (same expected-text contract), `vault://` read-only image scheme, backlinks, watcher. Refuses dot-folders and Obsidian's excluded paths |
| `ui/electron/storeroom.ts` | The Storeroom's file service: list, add (files, bytes, text/SVG, links), patch a sidecar keeping unknown keys, trash/restore, `storeroom://` (thumbnails, ranges for video, 404 outside an item), link capture in a hidden sandboxed window, and the service Social's context menu calls. Never deletes: trash only |
| `ui/electron/gcal.ts` | Google Calendar: loopback + PKCE sign-in with the owner's own client, calendar list, events, and `syncBlocks` (two-way reconciliation against `calendar.json`). `AXONIX_GOOGLE_MOCK` (dev only) points it at a local fake |
| `ui/src/notes/` | `editor/` CodeMirror 6 (syntax extensions, live preview), `Reader.tsx` react-markdown, `NotesFrame.tsx`, `links.ts` resolution, `backend.ts` bridge |
| `ui/src/calendar/` | `CalendarContext.tsx` status, events cache and the sync loop; `CalendarFrame.tsx` the week; `CalendarSheet.tsx` connect and calendars |
| `ui/src/tasks/` | `taskfile.ts` reads and edits one file (YAML as a document, body kept), `TasksContext.tsx` optimistic changes, write queue, conflict retry and undo, `quickadd.ts` the one-line parser, `backend.ts` the bridge (localStorage in the dev server), `components/` board, card, sheet, dashboard |
| `ui/src/next/` | The new shell: `Shell.tsx` (ground, sidebar, page, top bar), `Dock.tsx` (since 2026-10-07 the rail on the left edge; the class names still say `nx-dock`), `charts.tsx`, `lift/` (Lift, the Pocket, links), `scrub/` (the ruler and the as-of lens), and one folder per module (`home/`, `finance/`, `tasks/`, `calendar/`, `notes/`, `storeroom/`, `social/`). State and file services are the first versions' own. `social/SocialNext.tsx` repeats `SocialApp.tsx`'s state machine around a different layout: fix a bug in one, fix it in the other |
| `ui/electron/door.ts` | The door: MCP over HTTP on 127.0.0.1, tokens, the allowed tool list, the relay to the page, presence events (`door:event`), `door.log` |
| `ui/electron/paperclip.ts` | Paperclip's local API (`127.0.0.1:3100/api`): the three `paperclip_*` door tools, what the Agents surface shows, starting Paperclip when first needed |
| `ui/electron/terminal.ts` | Claude inside Axonix: the real `claude` program in a console (node-pty), and the stream-json chat, which is refused unless the owner turned it on |
| `ui/src/door/` | The page's side: `DoorContext.tsx` runs a guest's call and keeps its Undo, `AgentsSide.tsx` the sidebar rows, `AgentCursor.tsx`, `AgentPanel.tsx` (Terminal, Chat, Steps, Setup), `AgentsSurface.tsx` (Paperclip without its window) |
| `ui/src/styles/` | `tokens.css`, `finance*.css`, `social.css`, `tasks.css`; `next.css` and `next-modules.css` are the new shell, scoped to `:root[data-nx]` so the first versions keep their look |
| `scripts/` | `rebuild-app.ps1`, `finance-data-guard.mjs`, `update-shortcut.ps1`, `door-stdio.mjs` (the door for clients that start MCP servers as programs), `door-agent.mjs` (connects an agent without showing a token) |

**Documents**

| Doc | Read it for |
|---|---|
| `DESIGN.md` | The design system and the owner's stated preferences (§13 is Social) |
| `BUILD.md` | Build commands and the traps |
| `docs/plan/01 Decision Log.md` | Why things are the way they are. **Append a dated entry for every decision**, newest first, under the marker |
| `docs/plan/05 Progress & Deliverables.md` | Milestones, deliverables, risk register (R1–R9) |
| `docs/plan/00 Implementation Plan.md` | Original plan; the phase list is historical |
| `docs/plan/06 …` to `11 …` | Researched but unbuilt |
| `docs/plan/14 Remaining Work.md` | What was open on 2026-10-02, with an audit at the end |
| `docs/plan/15 One Signal Plan.md` | The next project: one shell, one line, one bus, one door for agents. Planned, not built |
| `docs/plan/20 Calm Overhaul Plan.md` | The Hark-style overhaul with motion and fewer controls, planned 2026-10-07. Not built: it waits on five decisions that are the owner's (its §4) |
| `docs/plan/17 Agentic Architecture.md`, `19 Claude Pilot.md` | Many agents through one door; doc 19 is the Claude-only pilot, built 2026-10-04 |
| `docs/plan/archive/` | Superseded research notes |

## 4. Commands

```bash
cd ui && pnpm install          # once
cd ui && pnpm dev              # Home + Finance in a browser, port 5273 (localStorage, not the real file)
cd ui && pnpm build            # tsc --noEmit + vite build — must be green
cd ui && pnpm social:dev       # Social alone in Electron with hot reload (see §5 before running)
cd ui && pnpm app:build        # package Axonix.exe — prefer rebuild-app.ps1, which wraps it safely
cargo test --workspace         # Rust core
node scripts/finance-data-guard.mjs where | snapshot <name> | verify <backup>
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rebuild-app.ps1
```

Build output lives outside the vault: `D:\06 Projects\_build\cargo-target\axonix\release\Axonix\`.

## 5. How to verify your work

- **Finance UI:** `pnpm dev` (port 5273) uses browser `localStorage`, so it is safe to click through.
- **Tasks UI:** the same: in the dev server tasks live in localStorage (`axonix:tasks:fs`), never the
  vault. To test the real file service, run Electron against the dev server with **both**
  `LOCALAPPDATA` and `AXONIX_VAULT` pointed at scratch folders (`AXONIX_DEV=1`,
  `AXONIX_DEV_URL=http://localhost:5273/`, `--remote-debugging-port`), and copy `@napi-rs/keyring`
  next to the bundle as `build-app.mjs` does. Without `AXONIX_VAULT` it writes the real vault.
- **Google Calendar:** never test against the owner's Google account. In dev, set
  `AXONIX_GOOGLE_MOCK=http://127.0.0.1:<port>` and run a local fake of the OAuth and Calendar v3
  endpoints; the dev build uses its own `Axonix Google (dev)` credentials — disconnect with *forget the
  client* afterwards so none are left in Credential Manager. The dev server (browser) has a demo stand-in
  with made-up events (`localStorage` `axonix:gcal:demo`).
- **Storeroom:** the dev server has an in-memory stand-in with demo references (nothing survives a
  reload). For the main process, bundle `electron/storeroom.ts` + `preload-host.ts` into a scratch
  Electron script with `root` in a scratch folder and drive `window.axonixStoreroom` — never point a test
  at `D:\04 Media\Storeroom`, which is owner data.
- **The door:** build main and renderer into a scratch folder and start Electron on it with `AXONIX_DEV=1`
  and `LOCALAPPDATA`, `AXONIX_VAULT` and `AXONIX_STOREROOM` pointed at scratch folders (native
  modules copied beside the bundle, as `build-app.mjs` does). A dev run uses `door.dev.json`, a random
  port and its own `Axonix Door (dev)` tokens: delete those afterwards. Drive the door over HTTP and
  read the page over its DevTools socket. Do not delete task files behind a running app: its write
  queue then waits on a file that is gone.
- **Social:** run `pnpm social:dev` with `LOCALAPPDATA` pointed at an empty scratch folder and
  `--remote-debugging-port=9333`, then drive it with `playwright-core`'s `connectOverCDP`. The empty
  folder means neither the real finance file nor its sandbox copy can be touched; dev mode also uses
  its own "(dev)" Credential Manager entries. Windows may show a Firewall prompt for "Electron": ask
  the owner to press Cancel.
- **What the debugger can't show you:** CDP screenshots draw `<webview>` pages offset or half-painted
  — capture the real window from the screen instead (bring it to the front first). CDP key presses
  don't reach Electron's shortcut hook (`before-input-event`); send real keys only after confirming
  the test window is in the foreground, with scan codes (without them `code` is empty).
- **The desktop app:** `rebuild-app.ps1` must end with
  `Rebuilt, relaunched on the real data, data intact.`
- Never ask the owner to check something you can check yourself.

## 6. Traps that have already cost time

- **`<webview>` and scale.** A page attached or resized under a CSS `scale()` keeps drawing at the
  inverse scale. Anything that contains a page may translate and fade, never scale.
- **`<webview>` needs an explicit size.** Without `.soc-webview { width: 100%; height: 100% }` it falls
  back to 300 × 150 and paints a strip.
- **Hidden `<webview>`s miss resizes.** `resync` in `Site.tsx` nudges a page whose viewport disagrees
  with its element.
- **Clicks inside a page never reach the host page** (no pointer events, and often no focus change).
  The guest preload reports them (`axonix:pressed`).
- **`useAnimate` in effects + StrictMode** cancels entrance animations in development. `Site.tsx` uses
  the plain `animate` from `motion`.
- **Never rename the browser profile folder (`Axonix Profile`) or a partition (`persist:social-<app>`).**
  Cookies live there, so a rename signs the owner out of every site — it happened once, when the
  separate Social app was folded in (the old logins are stranded in `Axonix Social\`).
- **localStorage can lose its last write on a hard exit.** Anything that must agree with main-process
  state (split layout vs last app) goes in `state.json` via IPC.
- **Glass engine rules.** No `isolation`, `filter`, `opacity < 1`, `mask` or `mix-blend-mode` on a
  glass host or its ancestors, and no `z-index` on the lens layer — refraction turns off silently.
- **Don't `taskkill /IM node.exe`.** Stop only the process on the port you started.
- **A `<webview>` never learns it is hidden.** `document.visibilityState` stays `visible` whatever the
  CSS (electron/electron#28677), so Chromium never throttles a page behind the one on screen.
  `background.ts` freezes them instead; any new "is this page on screen" logic goes through it.
- **Social pages live in two places:** Social, and the Storeroom's side pane (either window). `main.ts`
  merges each window's `social:shown` list and counts a page shown while *any* Axonix window is on
  screen; every window that hosts pages goes through `guardHostWebviews`. Sign-in prompts and
  `passwords:fill` still only reach the main window's Social.
- **Google sign-in in a social page needs three things** (measured 2026-09-27 on Pinterest):
  `FedCm` in `disable-features` (Electron exposes FedCM but cannot serve it: "FedCM get() rejects with
  NetworkError", the button does nothing); `preload-chrome.js` registered as a *session* preload, so
  Chrome's `window.chrome` shape reaches the page **and** its sign-in popup (popups get no webview
  preload); and the `sec-ch-ua*` headers, which Electron 44 leaves off navigations — added in
  `prepareSessions` for main frames and subframes only. Don't remove any of them to "clean up".
  To re-test: a scratch Electron harness that loads `pinterest.com/login/` in a `<webview>` and clicks
  Google's button from inside its iframe (`frame.executeJavaScript(click, true)`; `sendInputEvent` on
  the guest never reaches that out-of-process iframe). Never type credentials into a test.
- **Never size a field by measuring it inside a Sheet.** A sheet's children render (and run their
  layout effects) before its `<dialog>` opens, so `scrollHeight` reads 0 and an auto-growing title
  collapsed to a 7px line (task sheet and Storeroom sheet, fixed 2026-09-28). Use CSS
  `field-sizing: content` instead. The dev server hides this bug: StrictMode runs effects twice and
  the second run lands after the dialog opens — check sizes in `vite build` + `vite preview`.
- **Webview drags:** a page's `dragend` can arrive before the host's `drop` (electron#2897). The
  Storeroom keeps the guest's drag report 1.5s past `dragend`, and falls back to the reported release
  point when no drop arrives.
- **Playwright's `connectOverCDP` attaches to every page and can thaw a frozen one.** To test
  freezing, talk to each page over its own DevTools socket (`/json/list`) instead.
- **`pointerenter` never fires on a guest page's `document`** (measured 2026-09-20). Watch
  `pointermove` (throttled) instead when a page has to report where the pointer is.
- **`border-radius` is not composited; `clip-path` is.** A radius animation freezes whenever the
  main thread is busy — creating a `<webview>` blocks it for 70-150ms — and the corners balloon into
  a pill. Round a growing box with `clip-path: inset(0 round R)`, and remember the drawn corner is
  R x the current scale (`Launch.tsx` divides it back out).
- **Keep performance measurable.** Idle Social must not restyle: no endless CSS animation on an
  element that is merely transparent (`display: none` it). Check `document.getAnimations()` and
  CDP `Performance.getMetrics` (`RecalcStyleCount`) while idle.

## 7. Definition of done

- [ ] `pnpm build` green; `tsc -p tsconfig.electron.json` green; `cargo test --workspace` if Rust changed
- [ ] Snapshot before, `rebuild-app.ps1` after, guard `PASS` against the snapshot
- [ ] Verified visually on the real window (or measured DOM), not assumed
- [ ] `DESIGN.md` updated if a surface changed; `docs/plan/01 Decision Log` entry appended;
      `05 Progress & Deliverables` ticked
- [ ] Report plainly: what changed, the guard result, the backup path, anything skipped and why
