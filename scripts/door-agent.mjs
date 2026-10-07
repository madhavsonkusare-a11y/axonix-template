#!/usr/bin/env node
/**
 * door-agent — connects an agent to Axonix's door without a token ever being
 * printed or typed.
 *
 *   node scripts/door-agent.mjs status
 *       Where the door is, and which agents hold a token. No token is shown.
 *
 *   node scripts/door-agent.mjs claude-code
 *       Registers the door with Claude Code for this user (`claude mcp add
 *       --scope user`, HTTP, the token as a header in ~/.claude.json, which is
 *       backed up first). Every Claude Code session then has the door: the
 *       terminal, Axonix's terminal tab, the desktop app's Code tab, Remote
 *       Control from the phone.
 *
 *   node scripts/door-agent.mjs claude-desktop [--wait]
 *       Adds the stdio bridge to the Claude desktop app's chat
 *       (claude_desktop_config.json, backed up first). The config holds no
 *       token: the bridge reads it from Credential Manager when it starts.
 *       The desktop app must be closed, or it overwrites the change; with
 *       --wait this waits for it to close and then writes. Run it from a
 *       normal terminal, not from inside the desktop app's own Code tab,
 *       which closes with the app.
 *
 *   node scripts/door-agent.mjs worker-config
 *       Writes the MCP config Paperclip's Claude worker is started with
 *       (%USERPROFILE%\.axonix\claude-worker.mcp.json): the same bridge, as
 *       `claude-worker`. No token in it either.
 *
 * Axonix must have been opened once: the app makes the tokens.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const bridge = join(repo, 'scripts', 'door-stdio.mjs');
const require = createRequire(join(repo, 'ui', 'package.json'));
const AGENTS = ['claude', 'claude-desktop', 'claude-worker'];
const home = process.env.USERPROFILE ?? '.';

function doorFile() {
  const local = join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Axonix');
  const twin = /^([A-Za-z]):\\(.*)$/.exec(local);
  for (const dir of [twin ? `\\\\localhost\\${twin[1].toUpperCase()}$\\${twin[2]}` : null, local]) {
    if (!dir) continue;
    try {
      const file = join(dir, 'door.json');
      if (existsSync(file)) return { file, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch {
      // The next place is tried.
    }
  }
  return null;
}

const tokenOf = (agent) => {
  const { Entry } = require('@napi-rs/keyring');
  return new Entry('Axonix Door', agent).getPassword() ?? null;
};

function backup(file) {
  if (!existsSync(file)) return null;
  const copy = `${file}.before-axonix-door-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(file, copy);
  return copy;
}

const door = doorFile();
const command = process.argv[2] ?? 'status';

if (command === 'status') {
  console.log(door ? `DOOR ${door.url} (pid ${door.pid}, opened ${door.startedAt})\nFILE ${door.file}` : 'DOOR not found: open Axonix once.');
  for (const agent of AGENTS) console.log(`TOKEN ${agent} ${tokenOf(agent) ? 'held' : 'missing'}`);
  for (const [agent, seen] of Object.entries(door?.seen ?? {})) console.log(`SEEN ${agent} ${seen.at}${seen.client ? ` as ${seen.client}` : ''}`);
} else if (command === 'claude-code') {
  const token = tokenOf('claude');
  if (!door?.url || !token) throw new Error('The door or the token for claude was not found. Open Axonix once, then run this again.');
  const config = join(home, '.claude.json');
  const copy = backup(config);
  if (copy) console.log(`BACKUP ${copy}`);
  // `claude` is a .cmd shim on Windows, so it goes through the shell; the token is passed in the environment, never on a command line that is echoed.
  const run = (line) => spawnSync(line, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, AXONIX_DOOR_HEADER: `Authorization: Bearer ${token}` } });
  run('claude mcp remove axonix --scope user');
  const added = run(`claude mcp add --transport http --scope user axonix ${door.url} --header "%AXONIX_DOOR_HEADER%"`);
  if (added.status !== 0) throw new Error(`claude mcp add failed: ${(added.stderr || added.stdout).replaceAll(token, '<token>').trim()}`);
  console.log(`REGISTERED axonix -> ${door.url} for Claude Code (user scope)`);
} else if (command === 'claude-desktop') {
  // The desktop app keeps this file in memory and writes it back whenever a preference changes, so an
  // edit made while it is running is lost within minutes (it happened on 2026-10-04). It has to be closed.
  const running = () => {
    const found = spawnSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -match 'WindowsApps\\\\Claude_|AnthropicClaude' }).Count"], { encoding: 'utf8', windowsHide: true });
    return Number.parseInt(found.stdout.trim(), 10) > 0;
  };
  if (running()) {
    if (!process.argv.includes('--wait')) {
      console.error('The Claude desktop app is running, and would overwrite this change.\nQuit it (tray icon, Quit), then run this again. Or run it with --wait from a normal terminal and then quit Claude: the change is made the moment it closes.');
      process.exit(3);
    }
    console.log('Waiting for the Claude desktop app to close. Quit it now (tray icon, Quit).');
    while (running()) await new Promise((r) => setTimeout(r, 1000));
    // Its last write lands as it goes.
    await new Promise((r) => setTimeout(r, 1500));
  }
  // The desktop app is a packaged app: its config may live under its package folder instead of %APPDATA%.
  const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const places = [join(roaming, 'Claude', 'claude_desktop_config.json')];
  const packages = join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'Packages');
  if (existsSync(packages)) for (const pkg of readdirSync(packages).filter((p) => /claude/i.test(p))) places.push(join(packages, pkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  const found = places.filter((p) => existsSync(p));
  const targets = found.length ? found : [places[0]];
  for (const file of targets) {
    const copy = backup(file);
    if (copy) console.log(`BACKUP ${copy}`);
    let config = {};
    try {
      config = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // A new file.
    }
    config.mcpServers = { ...(config.mcpServers ?? {}), axonix: { command: 'node', args: [bridge, '--agent', 'claude-desktop'] } };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`WROTE ${file}`);
  }
  console.log('Open the Claude desktop app: its chat now has Axonix.');
} else if (command === 'worker-config') {
  const dir = join(home, '.axonix');
  mkdirSync(join(dir, 'claude-worker'), { recursive: true });
  const file = join(dir, 'claude-worker.mcp.json');
  writeFileSync(file, `${JSON.stringify({ mcpServers: { axonix: { command: 'node', args: [bridge, '--agent', 'claude-worker'] } } }, null, 2)}\n`);
  console.log(`WROTE ${file}\nCWD ${join(dir, 'claude-worker')}`);
} else {
  console.error('usage: door-agent.mjs status | claude-code | claude-desktop | worker-config');
  process.exit(2);
}
