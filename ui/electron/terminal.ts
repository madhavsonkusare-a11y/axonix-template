/**
 * Claude inside Axonix, two ways (doc 19, P4).
 *
 * **The terminal** runs the real `claude` program in a real Windows console
 * (ConPTY, through node-pty) and the page draws it with xterm.js. It is
 * exactly what runs in Windows Terminal, so the owner's Claude plan is used
 * by Anthropic's own program and nothing else.
 *
 * **The chat panel** starts the same program with `--input-format stream-json
 * --output-format stream-json` and the page draws the conversation itself. It
 * is the unmodified program with the owner's own sign-in, but whether an app
 * driving it counts as the owner using it is an open question (doc 16, U9),
 * so it is refused here unless the owner has turned it on.
 *
 * Only `claude` is ever started, in a small folder of its own. It reaches
 * Axonix's data through the door, like any other guest.
 */
import { ipcMain, type WebContents } from 'electron';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Pty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface Options {
  isHost: (sender: WebContents) => boolean;
  host: () => WebContents | null;
  chatPanelOn: () => boolean;
}

/** Where Claude is started: an empty folder of its own, never the vault or the repo. */
function workFolder(): string {
  const dir = path.join(process.env.USERPROFILE ?? '.', '.axonix', 'claude');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function claudeInstalled(): boolean {
  try {
    return execFileSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim().length > 0;
  } catch {
    return false;
  }
}

const size = (v: unknown, lo: number, hi: number, otherwise: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : otherwise);

export function registerTerminal({ isHost, host, chatPanelOn }: Options) {
  // ---- the terminal --------------------------------------------------------

  let pty: Pty | null = null;

  ipcMain.handle('term:start', (event, cols: unknown, rows: unknown) => {
    if (!isHost(event.sender)) return { ok: false, error: 'Not allowed from this window.' };
    if (pty) return { ok: true, running: true };
    if (!claudeInstalled()) return { ok: false, error: 'Claude Code is not installed on this computer (the `claude` command was not found).' };
    try {
      // Loaded on first use: a native module, kept out of the bundle (build-app.mjs).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodePty = require('@lydell/node-pty') as { spawn(file: string, args: string[], options: Record<string, unknown>): Pty };
      // `claude` may be a .cmd shim; cmd.exe runs either.
      const started = nodePty.spawn('cmd.exe', ['/d', '/c', 'claude'], {
        name: 'xterm-256color',
        cols: size(cols, 20, 400, 100),
        rows: size(rows, 5, 200, 30),
        cwd: workFolder(),
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      });
      pty = started;
      started.onData((data) => host()?.send('term:data', data));
      started.onExit(({ exitCode }) => {
        if (pty === started) pty = null;
        host()?.send('term:exit', exitCode);
      });
      return { ok: true, running: false };
    } catch (e) {
      return { ok: false, error: `The terminal could not be started: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` };
    }
  });
  ipcMain.on('term:input', (event, data: unknown) => {
    if (isHost(event.sender) && typeof data === 'string' && data.length <= 65_536) pty?.write(data);
  });
  ipcMain.on('term:resize', (event, cols: unknown, rows: unknown) => {
    if (!isHost(event.sender) || !pty) return;
    try {
      pty.resize(size(cols, 20, 400, 100), size(rows, 5, 200, 30));
    } catch {
      /* it ended between the check and the call */
    }
  });
  ipcMain.on('term:kill', (event) => {
    if (isHost(event.sender)) pty?.kill();
  });

  // ---- the chat panel (off unless the owner turned it on) ------------------

  let chat: ChildProcess | null = null;
  let buffer = '';

  const startChat = (): ChildProcess => {
    // Door tools are allowed without a question; every other tool is refused, since nobody is there to be asked.
    const child = spawn('cmd.exe', ['/d', '/c', 'claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'mcp__axonix'], {
      cwd: workFolder(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    buffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (text: string) => {
      buffer += text;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        try {
          host()?.send('chat:event', JSON.parse(line));
        } catch {
          /* not a message */
        }
      }
    });
    let complaint = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      complaint = (complaint + text).slice(-600);
    });
    child.once('exit', (code) => {
      if (chat === child) chat = null;
      host()?.send('chat:event', { type: 'axonix_exit', code, error: code ? complaint.trim() : undefined });
    });
    return child;
  };

  ipcMain.handle('chat:send', (event, text: unknown) => {
    if (!isHost(event.sender)) return { ok: false, error: 'Not allowed from this window.' };
    if (!chatPanelOn()) return { ok: false, error: 'The chat panel is turned off.' };
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000) return { ok: false, error: 'That cannot be sent.' };
    if (!claudeInstalled()) return { ok: false, error: 'Claude Code is not installed on this computer.' };
    try {
      chat ??= startChat();
      chat.stdin?.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })}\n`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  });
  ipcMain.on('chat:stop', (event) => {
    if (!isHost(event.sender) || !chat?.pid) return;
    // The shim's child is the real program: stop the tree.
    spawn('taskkill', ['/pid', String(chat.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  });

  return {
    close: () => {
      pty?.kill();
      if (chat?.pid) spawn('taskkill', ['/pid', String(chat.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    },
  };
}
