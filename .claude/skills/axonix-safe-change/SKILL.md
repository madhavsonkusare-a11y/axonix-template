---
name: axonix-safe-change
description: Mandatory protocol for ANY change to the Axonix app (UI, Rust, data model, assets, config). Guarantees the owner's existing data is never erased or modified unless they explicitly ask, and that the desktop app is rebuilt and relaunched after every change. Use before touching code in this repo, and whenever asked to "change", "fix", "add", "update", "rebuild" or "polish" anything in Axonix.
---

# Axonix safe-change protocol

Axonix is a desktop app the owner uses every day with **real financial and identity data**.
Two rules are absolute, and every change you make in this repo must follow both:

1. **Existing data is never erased or modified unless the owner explicitly says so** in their
   own words for that specific data ("delete my ICICI account", "reset everything"). A request
   to change *the app* is never permission to change *their data*.
2. **The desktop app is rebuilt and relaunched after every change**, and you prove the data
   survived before reporting done.

If you cannot satisfy both, stop and tell the owner why instead of proceeding.

For anything visual (layout, colour, type, motion, copy, new screens), also follow
[`DESIGN.md`](../../../DESIGN.md) at the repo root. It records the design system and the owner's stated preferences.

---

## Where the real data lives

| What | Where |
|---|---|
| Finance + Digital IDs (the owner's data) | `%LOCALAPPDATA%\Axonix\finance-data.json` |
| Automatic backups (last 40) | `…\AppData\Local\Axonix\backups\finance-data-<unix>-<reason>.json` |
| App log (written by the app on every launch) | `…\AppData\Local\Axonix\logs\axonix-app.log` |
| Notes vault (also owner data) | `D:\05 Notes\My Vault` |

### ⚠ Your shell may be sandboxed — `%LOCALAPPDATA%` can LIE

If you run inside the **Claude desktop app** (or any MSIX-packaged host), every process you start
(Bash, PowerShell, node, and any `.exe` you launch) sees a **virtualized** `%LOCALAPPDATA%`. Once a
private copy exists under `%LOCALAPPDATA%\Packages\<host>\LocalCache\Local\Axonix`, it **shadows** the
real folder: reads return the stale copy, writes go into it, and the owner's real file is invisible.

On 2026-09-13 this made the owner's accounts and balances look **deleted**. A rebuild relaunched the
app from a sandboxed shell, so the app opened the stale copy, and the data check compared that copy
with itself and passed. The real data was intact, but the owner saw it vanish. Never repeat this:

- **Never read, copy, or reason about `%LOCALAPPDATA%\Axonix` directly.** Use
  `node scripts/finance-data-guard.mjs where`. It must print `REAL yes` and a
  `DATA \\localhost\C$\…` path; `SHADOW` lines are sandbox copies and never the owner's data.
- **Never launch `Axonix.exe` directly from an agent shell.** Use `rebuild-app.ps1` (it starts the
  app through `explorer.exe`, outside the sandbox) or `explorer.exe "<exe>"`. The app also refuses to
  start inside a sandbox, and `Axonix.exe --sandbox-check` exits `10` if your shell is sandboxed.
  (To test, run a separate instance with `LOCALAPPDATA` pointed at a scratch folder: BUILD.md.)
- **Prove the relaunch opened the real file:** a new `-startup.json` backup must appear in the REAL
  backups folder (the script checks this).
- **Never delete, move, or "sync" a shadow copy** without the owner's explicit OK.

The app itself also backs the file up at every launch (`-startup`) and before reset, demo load
and restore, writes atomically, refuses to save malformed data, and stops saving for the session
if the file cannot be read. Do not weaken any of that.

The **dev server** (`pnpm dev`, port 5273) and Playwright use **browser localStorage**, not the real
file. Test there freely. The **desktop app** uses the real file — treat it as production.

---

## The protocol

### 1. Before changing anything — snapshot

```bash
node scripts/finance-data-guard.mjs snapshot before-<short-change-name>
```

Keep the printed `BACKUP` path. You will verify against it at the end.

### 2. While changing code

- **Never** run, click, or script these against the desktop app unless the owner asked in this
  conversation: *Load demo*, *Reset*, *Restore a backup*, *Delete* on any account / method /
  transaction / ID, or anything that writes `finance-data.json`.
- **Never** edit, move, truncate, or re-save `finance-data.json` or anything in `backups\` by hand.
- Exercise new features in the **dev server or Playwright** (isolated localStorage), not in the
  desktop app with the owner's data.
- **Schema changes must be additive.** New fields are optional. Never rename or drop a field or
  collection. If the shape must change, bump `version`, extend `migrate()` in
  `ui/src/finance/repo.ts` so every old record carries over, test it on a **copy** of a backup
  in the browser, and **ask the owner before shipping it** — the guard reports a version change
  as a failure on purpose.
- Changing defaults (`starterData`, `DEFAULT_CATEGORIES`) must not alter records the owner already
  has; defaults only apply to brand-new data files.
- Reducer actions that remove records (`DELETE_*`, `RESET`, `LOAD_DEMO`) must stay behind an
  explicit user confirmation in the UI.

### 3. After every change — rebuild, relaunch, verify

One command does it all (snapshot, graceful close, stop the Vite server only, the Electron build
and package, relaunch, log checks, data verification):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\rebuild-app.ps1"
```

It must end with **`Rebuilt, relaunched on the real data, data intact.`** Then also verify against
the snapshot you took in step 1, since it covers the whole change and not just the build. If the owner
used the app in between, their own edits show as `MODIFIED`/new records; list them and confirm they
match what the owner did, never "fix" them:

```bash
node scripts/finance-data-guard.mjs verify "<BACKUP path from step 1>"
```

`PASS` is required. New records are fine; any `DELETED`, `MODIFIED` or version change is a
failure.

If you must do the steps by hand, the non-negotiables are in `BUILD.md`:
- build with `node ui/scripts/build-app.mjs`, with the app closed (its exe is locked while it runs);
- stop the dev server on 5273 first — **only that process**, never `taskkill /IM node.exe`;
- the app log must say `frontend source: embedded dist dev_mode=false`;
- launch through `explorer.exe`, then confirm a new startup backup in the real backups folder.

### 4. If verification fails

1. Do not make further changes.
2. Tell the owner exactly which records the guard listed.
3. Only restore if they ask:
   `node scripts/finance-data-guard.mjs restore "<BACKUP path>"` (it snapshots the current file
   first), then relaunch the app.

### 5. Report

State, plainly: what changed, that the app was rebuilt and relaunched, the guard result
(`PASS` + before/after counts), and the backup path. If any step was skipped, say which and why.

---

## Quick checklist

- [ ] `where` says `REAL yes` with a `\\localhost\C$` path (sandboxed shells)
- [ ] `snapshot` taken, backup path noted
- [ ] No destructive action run against the desktop app or its data file
- [ ] Schema unchanged, or migration additive + tested on a copy + approved by the owner
- [ ] `tsc` / build green
- [ ] `rebuild-app.ps1` → "Rebuilt, relaunched on the real data, data intact."
- [ ] `verify` against the step-1 backup → `PASS`
- [ ] Reported change, rebuild, guard result, backup path
