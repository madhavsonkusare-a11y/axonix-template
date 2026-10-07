# Axonix

> **This is the public template of Axonix.** It holds the code and made-up sample data only: no vault,
> no finance or identity data. The planning documents under `docs/plan/` are not included, so links to
> them from `AGENTS.md`, `DESIGN.md` and `CHANGELOG.md` do not resolve. Build output paths are set for
> the author's machine in `.cargo/config.toml`, `scripts/rebuild-app.ps1`, `scripts/update-shortcut.ps1`
> and `ui/scripts/build-app.mjs`; point them at a folder of your own before building.

A local-first desktop workspace for one person, on Windows. It ships as one app, **`Axonix.exe`**
(Electron + React), with seven modules in one window, opened from a glass dock:

- **Home** — the day at a glance: what is next, what is due, how the month is going.
- **Finance** — net worth, accounts and cards, spending, transactions, Indian gold rates, digital IDs.
- **Tasks** — one Markdown file per task in the vault: today, upcoming, a board, projects, a timeline.
- **Calendar** — week, day, month and timeline; time blocks are tasks; two-way sync with Google Calendar.
- **Notes** — the vault's notes in a block editor, with a library, types, projects and collections.
- **Storeroom** — an inspiration library: drop, paste or right-click-save images, SVG, video, links and
  notes; each reference is a folder with a stable id (`R0042`) that agents can name. Also opens in its
  own window.
- **Social** — Instagram, X, Threads, Reddit, LinkedIn and Pinterest, with split view and saved sign-ins.

**Axonix on the mark** is the assistant: Ctrl+J, or drop anything on the mark in the dock. It runs on the
owner's own ChatGPT plan ("Sign in with ChatGPT"), reads and changes the workspace through tools, shows
each step, and every change has Undo.

Two more things work across all of them. **Lift:** hold anything and it comes off the page as glass: a
transaction, a task, a card, a chart, a figure, the words you have selected, or a file, link or picture
dragged in from outside. Drop it on another module, a day, a project or another thing to convert,
schedule, keep or link it. **Scrub:** press T and drag the ruler, and every module shows
itself as of that day, with a forecast ahead of today.

Each module has two versions. The current one lives in `ui/src/next/` (the "Paper + Glass" shell); the
first version still ships and opens as "Legacy …" from each module's sidebar.

Alongside the app, a Rust core (`crates/`) reads an Obsidian vault, indexes it, and exposes it to
agents over MCP. Files stay the truth; the index is a cache you can delete. The vault is a separate
folder, not this repository.

**Read before changing anything:** [`AGENTS.md`](AGENTS.md) (orientation and the rules),
[`DESIGN.md`](DESIGN.md) (the design system), [`BUILD.md`](BUILD.md) (how to build).
Plan and history live in [`docs/plan/`](docs/plan/): `00 Implementation Plan.md`,
`01 Decision Log.md`, `05 Progress & Deliverables.md`. What changed and when: [`CHANGELOG.md`](CHANGELOG.md).

## The one rule

The owner's money and identity data lives in `%LOCALAPPDATA%\Axonix\finance-data.json`. It is never
erased or modified unless they ask for that specific change, and the app is rebuilt and verified
after every change. The protocol is mandatory:
[`.claude/skills/axonix-safe-change/SKILL.md`](.claude/skills/axonix-safe-change/SKILL.md).

## Layout

| Path | What it is |
|---|---|
| `ui/electron/` | Electron main process and preloads — the app's only access to disk, keyring and network |
| `ui/src/next/` | The current shell and every module's current version; `lift/` and `scrub/` run across them |
| `ui/src/finance/` | The finance tracker: frames, sheets, ledger maths, parsing, persistence |
| `ui/src/tasks/`, `ui/src/calendar/`, `ui/src/notes/` | Tasks, Calendar and Notes: state, file services, sheets, the editor |
| `ui/src/storeroom/` | The Storeroom: library state, grid, item panel, its own window |
| `ui/src/social/` | Social: pages, split view, overview, sign-ins |
| `ui/src/home/`, `App.tsx` | The first launcher, the module switch, the command palette |
| `crates/axonix-vault` | Files as truth: frontmatter, wikilinks, verify status, atomic writes |
| `crates/axonix-index` | SQLite + FTS5 over the vault; rebuildable |
| `crates/axonix-mcp` | MCP server exposing vault tools to Hermes |
| `crates/axonix-agent` | Hermes client; its types never leak past this crate |
| `crates/axonix-capture` | Loopback capture server (127.0.0.1:8787, bearer token) for the clipper |
| `crates/axonix-shell` | Windows shell integration, stubbed for a later phase |
| `extension/` | MV3 browser extension that clips pages into the vault |
| `scripts/` | `rebuild-app.ps1` (the safe rebuild) and `finance-data-guard.mjs` |

## Build

```bash
cd ui && pnpm install
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rebuild-app.ps1
```

That script is the supported way to build: it snapshots the data, stops the dev server, packages
`Axonix.exe`, relaunches it outside any sandbox and verifies every record survived. Details and the
traps that cost hours are in [`BUILD.md`](BUILD.md).

## Invariants

1. **Files are the truth.** The SQLite index is a cache; delete it and it rebuilds. No proprietary
   container, ever.
2. **Agents write unverified.** Anything an agent or an import produces lands as
   `status: unverified` (vault) or carries an `auto` chip (tracker) until a person confirms it.
3. **Local.** Assets, fonts and brand marks are vendored; nothing is hot-linked, and the core works
   offline. Market data says where it came from and when, and is never invented.
4. **The owner's data is theirs.** See the one rule above.
