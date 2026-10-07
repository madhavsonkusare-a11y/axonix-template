# Building Axonix

Axonix is one Electron app (`ui/electron/` + `ui/src/`): Home, Finance and Social in one
window. The Rust crates are the vault, index, agent, MCP server and capture server.

## The desktop app

Always through the rebuild script — it snapshots the owner's finance data first, closes the
running app, builds, relaunches through Explorer (outside any sandbox) and proves the data
survived:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rebuild-app.ps1
```

It runs `ui/scripts/build-app.mjs`, which type-checks the main process, builds the renderer
with Vite, bundles `electron/*.ts` with esbuild, compiles the tracker blocklist, and packages
to `D:\06 Projects\_build\cargo-target\axonix\release\Axonix\Axonix.exe`. Never run that script on
its own while the app is open (the exe is locked), and never start `Axonix.exe` from an agent
shell — see `.claude/skills/axonix-safe-change/SKILL.md`.

**Kill the dev server first** when judging a build: a live Vite server makes a broken build
look like it works. The rebuild script stops the one on port 5273.

## Social during development

```bash
cd ui && pnpm social:dev     # Social with hot reload; own "Axonix (dev)" profile and "(dev)" credentials
```

Point `LOCALAPPDATA` at a scratch folder when testing from an agent shell, so neither the real
finance file nor its sandbox copy is touched. Verify pages with an OS capture of the window:
CDP screenshots draw `<webview>` guests offset.

## Tracker blocklist

`ui/electron/blocklists/easyprivacy.txt` is vendored and compiled into `easyprivacy.bin` at build
time (`ui/scripts/blocklist.mjs`); `axonix-exceptions.txt` beside it holds our own allow rules.
Refresh the list every few months:

```bash
cd ui && node scripts/blocklist.mjs --update
```

## Rust workspace

```bash
cargo test --workspace
cargo build --release -p axonix-capture
```

The app starts `axonix-capture.exe` (loopback `127.0.0.1:8787`) from beside its own exe or the
folder above it.

## Extension

```bash
cd extension && pnpm install && pnpm run build   # → dist/, load unpacked in Chrome
```
