#!/usr/bin/env node
/**
 * finance-data-guard — proves a change did not erase or alter the owner's data.
 *
 *   node scripts/finance-data-guard.mjs where
 *       Prints the data file this script will use, and any sandboxed shadow
 *       copies it found. Run it first if in doubt.
 *
 *   node scripts/finance-data-guard.mjs snapshot <label>
 *       Copies the REAL finance-data.json into its backups folder and prints
 *       the backup path plus record counts. Run BEFORE any change.
 *
 *   node scripts/finance-data-guard.mjs verify <backup-path>
 *       Compares the real file with that backup. Every record that existed
 *       before must still exist, unchanged. New records are fine. Exits 1 and
 *       lists each missing or changed record otherwise. Run AFTER the rebuild
 *       and relaunch.
 *
 *   node scripts/finance-data-guard.mjs restore <backup-path>
 *       Puts a backup back (after snapshotting the current file first). Only
 *       when the owner asks for it.
 *
 * No dependencies; Node 18+.
 *
 * WHICH FILE IS REAL — read this before changing path logic.
 * Shells started by the Claude desktop app (an MSIX package) run inside its
 * file-system virtualization: a write under %LOCALAPPDATA% lands in
 * %LOCALAPPDATA%\Packages\<app>\LocalCache\Local, and from then on that private
 * copy SHADOWS the real file for every process in the sandbox — node, this
 * script, and any app it launches. On 2026-09-13 a rebuild relaunched Axonix
 * inside it: the app opened a stale copy, the owner's accounts and balances
 * looked deleted, and this script's PASS had compared the copy with itself.
 * The admin share \\localhost\C$ is served by Windows' file server, outside any
 * sandbox, so it always reaches the real file. This script uses it whenever it
 * can, and refuses to guess when it cannot.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function sandboxShadows(local) {
  const packages = join(local, 'Packages');
  if (!existsSync(packages)) return [];
  const found = [];
  for (const pkg of readdirSync(packages)) {
    const dir = join(packages, pkg, 'LocalCache', 'Local', 'Axonix');
    try {
      if (existsSync(dir)) found.push(dir);
    } catch {
      // Unreadable package folders cannot be shadowing us.
    }
  }
  return found;
}

function resolveData() {
  const local = process.env.LOCALAPPDATA;
  if (!local) {
    const dir = join(process.env.HOME ?? '.', '.local', 'share', 'Axonix');
    return { dir, real: true, shadows: [] };
  }
  const shadows = sandboxShadows(local);
  const drive = /^([A-Za-z]):\\(.*)$/.exec(local);
  if (drive) {
    const unc = `\\\\localhost\\${drive[1].toUpperCase()}$\\${drive[2]}\\Axonix`;
    if (existsSync(unc)) return { dir: unc, real: true, shadows };
  }
  // No admin share. %LOCALAPPDATA% is only trustworthy if nothing shadows it.
  return { dir: join(local, 'Axonix'), real: shadows.length === 0, shadows };
}

const DATA = resolveData();
const LIVE = join(DATA.dir, 'finance-data.json');
const BACKUPS = join(DATA.dir, 'backups');

function requireReal(action) {
  if (DATA.real) return;
  console.error(`REFUSING to ${action}: sandboxed copies of the data exist:`);
  for (const s of DATA.shadows) console.error(`  - ${s}`);
  console.error(`and the real folder cannot be reached through \\\\localhost\\C$ from this shell,`);
  console.error(`so ${LIVE} may be one of those copies. Run this from a normal terminal instead.`);
  process.exit(3);
}

/** Collections and the field that identifies a record in each. */
const COLLECTIONS = {
  accounts: 'id',
  methods: 'id',
  transactions: 'id',
  categories: 'id',
  budgets: 'category',
  subscriptions: 'id',
  ids: 'id',
};

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function counts(doc) {
  return Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, Array.isArray(doc[k]) ? doc[k].length : 0]));
}

/** Key-order-insensitive deep equality. */
function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => same(a[k], b[k]));
}

function where() {
  console.log(`DATA ${LIVE}`);
  console.log(`REAL ${DATA.real ? 'yes' : 'NOT PROVEN'}`);
  for (const s of DATA.shadows) console.log(`SHADOW ${s}  (sandbox copy — never the owner's live data)`);
}

function snapshot(label = 'manual') {
  requireReal('snapshot');
  console.log(`DATA ${LIVE}`);
  if (!existsSync(LIVE)) {
    console.log(`No data file yet at ${LIVE} — nothing to protect.`);
    return;
  }
  mkdirSync(BACKUPS, { recursive: true });
  const safe = label.replace(/[^a-z0-9-]/gi, '-').slice(0, 40);
  const dest = join(BACKUPS, `finance-data-${Math.floor(Date.now() / 1000)}-${safe}.json`);
  copyFileSync(LIVE, dest);
  console.log(`BACKUP ${dest}`);
  console.log(`COUNTS ${JSON.stringify(counts(read(dest)))}`);
}

function verify(backupPath) {
  requireReal('verify');
  console.log(`DATA ${LIVE}`);
  if (!backupPath || !existsSync(backupPath)) {
    console.error('verify needs the backup path printed by `snapshot`.');
    process.exit(2);
  }
  if (!existsSync(LIVE)) {
    console.error(`FAIL the live data file is gone: ${LIVE}`);
    process.exit(1);
  }
  const before = read(backupPath);
  const after = read(LIVE);
  const problems = [];

  if (before.version !== after.version) {
    problems.push(`schema version changed ${before.version} → ${after.version} (a migration ran — the owner must approve this)`);
  }
  for (const [name, key] of Object.entries(COLLECTIONS)) {
    const now = new Map((after[name] ?? []).map((r) => [r[key], r]));
    for (const record of before[name] ?? []) {
      const id = record[key];
      if (!now.has(id)) problems.push(`${name}: "${id}" was DELETED`);
      else if (!same(record, now.get(id))) problems.push(`${name}: "${id}" was MODIFIED`);
    }
  }

  console.log(`BEFORE ${JSON.stringify(counts(before))}`);
  console.log(`AFTER  ${JSON.stringify(counts(after))}`);
  if (problems.length) {
    console.error(`FAIL ${problems.length} existing record(s) changed:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('PASS every existing record is still present and unchanged');
}

function restore(backupPath) {
  requireReal('restore');
  if (!backupPath || !existsSync(backupPath)) {
    console.error('restore needs a backup path.');
    process.exit(2);
  }
  read(backupPath); // refuse to restore something that is not JSON
  snapshot('before-restore');
  writeFileSync(LIVE, readFileSync(backupPath));
  console.log(`RESTORED ${backupPath} → ${LIVE}`);
}

const [command, rawArg] = process.argv.slice(2);
// Git Bash collapses a leading `\\` to `\`, which turns `\\localhost\C$\…` into
// a path that does not exist. Accept `\localhost\…` and `//localhost/…` too.
const arg = rawArg?.replace(/^[\\/]{1,2}localhost[\\/]/i, '\\\\localhost\\');
if (command === 'where') where();
else if (command === 'snapshot') snapshot(arg);
else if (command === 'verify') verify(arg);
else if (command === 'restore') restore(arg);
else {
  console.error('usage: finance-data-guard.mjs where | snapshot <label> | verify <backup> | restore <backup>');
  process.exit(2);
}
