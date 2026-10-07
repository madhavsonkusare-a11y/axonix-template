# Changelog

What changed in Axonix, newest first. Written for the owner and for agents picking the work up.
The detail behind each entry is in [`docs/plan/01 Decision Log.md`](docs/plan/01%20Decision%20Log.md);
the open work is in [`docs/plan/05 Progress & Deliverables.md`](docs/plan/05%20Progress%20%26%20Deliverables.md).

Entries before 2026-10-02 were reconstructed from those two documents, not written at the time.
There are no release tags yet: the app is rebuilt in place by `scripts/rebuild-app.ps1`.

## 2026-10-07 — Calm: how Axonix moves

### Changed
- **Things arrive out of a blur** and sharpen, instead of sliding or popping. Leaving is faster.
- **Moving between modules** is one move: the old page blurs away while the next arrives, and the
  rail holds still.
- **A task grows out of its card** into its panel.
- **Every module stands on the hour's sky**, with borderless panels. Home is as it was.
- **Selections slide as a plain thumb.** The glass lens is gone from pages.
- **Panels** are frosted, start below the window's buttons, and open without the stutter they had.
- **Counts roll** when they change: the board, the Projects line, the rail's badge.
- From the keyboard, all of this is instant.

### Removed
- Search from the top bar (the mark in the rail and Ctrl K remain).
- "Legacy …" rows from five sidebars (they are in Ctrl K).
- Finance's settings icon, Calendar's second Google Calendar row, Templates in Notes' empty page,
  "Open Tasks" and "Open Finance" on Home, the add line's expand button.

### Added
- A page of the moves, for tuning: `design-explore/calm-overhaul/index.html`.
- `localStorage` `axonix.next.vt` = `off` turns the two view-transition moves off.

## 2026-10-07 — Tasks | Projects, and the rail

### Changed
- **Tasks is two things now, with one switch between them** in the middle of the top bar.
  - **Tasks** is the kanban board and nothing else. One row above it chooses whose tasks show: All,
    Inbox, or one project.
  - **Projects** holds the rest: today's actions, the agenda, the next two weeks, momentum, every
    project in one list, and each project's workspace.
- **The dock is a rail on the left edge**, as drawn in pen.dev. The modules are a column of tiles; the
  Pocket, the clock and the mark are at its foot. Pages no longer keep a strip clear at the bottom, so
  every module is taller.
- **Tasks stands on the hour's sky**, the same five moods as Home, dark at every hour.
- A board card shows less: title, project, due, today's time block, subtasks.
- A project lists its tasks instead of holding a second board, with one link to the board.

### Added
- **Actions.** In Projects, a task due today is a card whose opening verb is its button: press "Pay"
  and "Pay the water bill" is done, with Undo.
- **Delete finished**, at the foot of the board's Done column. It asks first, moves every finished
  task that is showing to the trash, and one Undo brings them back.
- "Projects" in Ctrl K.

### Removed
- From the second Tasks: the sidebar, the Today and Upcoming pages, List mode, the Project, Due and
  Priority menus, swimlanes, and the Research and Legacy rows (Research is on a project that needs it;
  Legacy Tasks is in Ctrl K). The task panel's Close pill.
- The dock's glass, dragging it to another edge, and the gap under every page.
- **Claude and the assistant from the screen:** the agents' rows and chip, the cursor, Claude's panel,
  the Agents surface, the ask panel (Ctrl+J) and "Ask Axonix" in Ctrl K. The door, the assistant's
  engine and their code are kept and can be shown again.

### Fixed
- The page began under the window's minimise, maximise and close buttons, which sat on its corner. It
  now starts below them.

### Not built
- The gear, the four circles and the "M" from the pen.dev frame: nothing exists for them to open yet.

## 2026-10-04 — Claude at the door (pilot)

### Added
- **The door.** Axonix now has one way in for outside agents: an MCP server inside the app, on this
  computer only, with a token per agent in Windows Credential Manager. It offers the assistant's own
  tools for tasks, the calendar and notes, and the three money *reads*. Recording money and identity
  documents are not offered. Every call is in `logs/door.log`.
- **Claude Code is connected** (user scope), so any Claude Code session can add a task, finish one,
  write a note or read the month. What it makes is marked machine-made and carries Undo.
- **Agents in the sidebar.** An agent that has really connected has a row: its mark, its name, the
  program and plan it runs on, and Idle, Acting or Waiting on you.
- **A cursor.** When a call touches a task or a note that is on screen, a cursor with the agent's
  name glides to it and the row lights once. Otherwise the agent's row pulses.
- **Talk to Claude inside Axonix.** Press Claude's row: a panel with the real Claude Code in a
  terminal, the steps it took (each change with Undo), and Setup. A chat drawn by Axonix exists and is
  **off** until you turn it on under Setup.
- **Claude desktop app, chat side:** a small bridge (`scripts/door-stdio.mjs`) is in its config.
- **Paperclip:** a "Claude worker" (heartbeat off, $5 a month, its own token). Claude can file a work
  order for it; **Agents** (the sidebar heading) shows the roster, work orders, runs and spend, and
  is where you assign an order, so Paperclip's own window is not needed.
- A skill for Claude Code, `~/.claude/skills/axonix`, with the house rules.

## 2026-10-03 — Everything is liftable

### Added
- **Hold anything.** A card, a chart, a figure, a heading, a sidebar entry, a panel, a whole view:
  held still for half a second, it lifts. No component has to opt in.
- **Selected text** lifts too, including in a note.
- **From outside the window:** drag in a file, a link, a picture or text. Drop it on a module's
  tile, the Pocket, the mark, a day, a task, or the page.
- New places to drop: the Storeroom tile keeps a link or a picture; the Finance tile opens a
  statement for import; a link or text dropped on a task goes into its notes.
- Accounts, ways to pay, categories, budgets, subscriptions, documents, projects and days are
  things in their own right: they can be kept, linked and asked about.
- A part of a page kept in the Pocket opens its view and is marked for a moment.

### Changed
- The Pocket's slot is always visible, so the dock no longer shifts when something is picked up.
- A panel on the right edge steps aside while something is held.
- Digital IDs are never read off the screen: a lifted document carries its name and expiry only.

## 2026-10-02 — The assistant

### Added
- **Axonix on the mark.** Ctrl+J, "Ask Axonix" in the command bar, or drop a lifted thing on the mark.
  It answers questions about money, tasks, the calendar and notes, and can add a task, change a
  task, record a payment and write a note. Each step is shown as it happens; each change has Undo.
- **Sign in with ChatGPT.** The assistant runs on the owner's ChatGPT plan (Plus or Pro): no API key.
  Tokens are kept encrypted by Windows and never reach the page.
- `node ui/scripts/assistant-check/run.mjs`: 31 checks of the sign-in and request code against a
  local stand-in for OpenAI.

### Changed
- Dropping a thing on the mark asks Axonix about it (it used to search for its name).

### Dropped
- The light theme. Dark is the only theme.

### Not yet
- Nothing has been run against OpenAI's servers: that needs the owner's sign-in.

## 2026-10-02 — Lift, the Pocket, Scrub

### Added
- **Lift.** Hold a transaction, task, time block, event, note or reference and it comes off the page
  as glass. Drop it on the Pocket, the mark, the Tasks, Notes or Calendar tile, a day, a project or
  another thing. A drop converts, schedules, moves or links, and every one has Undo.
- **The Pocket**, in the dock: keep up to twelve things and carry them between modules.
- **Links** between things, shown from both ends in each thing's panel.
- **Scrub.** T, or the clock in the dock, opens a ruler. Every module shows itself as of the day on
  it: warm when looking back, blue when looking ahead. Finance shows what is on a schedule as Expected
  rows. Nothing can be changed while another day is showing.
- **Quick add in the command bar.** "paid 450 chai" opens the Add sheet filled in.
- A new file, `%LOCALAPPDATA%\Axonix\workspace.json`, holds links and the Pocket.
- This changelog.

### Changed
- The Storeroom's own window shows the new Storeroom, without a dock. The first version opens from
  its sidebar.
- Calendar: T no longer jumps to today (it opens the ruler). The Today button still does.
- README: lists all seven modules and the new shell.

## 2026-10-02 — Paper + Glass: every module in the new shell

### Added
- A new shell (`ui/src/next/`): one sheet of paper per window, a glass dock that snaps to any edge, a
  sidebar with each module's views first, panels that open from the right edge.
- Second versions of Home, Finance, Tasks, Calendar, Notes, Storeroom and Social in that shell.
- Calendar gained Day, Month and a five-week Timeline, a small month in the sidebar, and drawing a
  block on an empty slot.
- Notes gained a card library grouped by when a note was last edited.
- The command palette finds tasks and notes as well as transactions.

### Kept
- Every first version still ships and opens as "Legacy …". Data, files and features are unchanged.

## 2026-09-27 — Storeroom, phase 1
- An inspiration library: drop, paste, save from Social, capture links. One folder per reference with
  a stable id. Its own window.

## 2026-09-22 — Notes v2
- A block editor for the vault's notes, with note types, projects, collections and a trash.

## 2026-09-20 — Tasks: project workspaces, Calendar
- Project dashboards, a timeline, and a week calendar with time blocks and Google Calendar sync.

## 2026-09-16 — Social
- Six social apps inside Axonix, with split view and saved sign-ins.

## 2026-09-12 — Home and Finance
- The launcher and the finance tracker replace the earlier vault dashboards. The app moves to Electron.
