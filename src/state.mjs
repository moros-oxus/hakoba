import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * hakoba's host-side memory. It tracks which repos are attached (so a publish knows who to push to)
 * and keeps each repo's pristine lockfile baseline (so a detach can put it back). It lives **outside
 * every repo and outside the container** — under `~/.local/state/hakoba` (XDG) — because it holds host
 * paths and nothing about local development should leak into the projects being wired.
 */

function stateDir() {
  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  return join(base, 'hakoba');
}

const ledgerFile = () => join(stateDir(), 'attachments.json');

/** A stable short id for a repo path — names its baseline folder without leaking the path. */
function repoId(cwd) {
  return createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12);
}

function read() {
  try {
    return JSON.parse(readFileSync(ledgerFile(), 'utf8'));
  } catch {
    return { version: 1, repos: {} };
  }
}

function writeLedger(data) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(ledgerFile(), `${JSON.stringify(data, null, 2)}\n`);
}

/** Where the ledger lives, for `status` messages. */
export function ledgerHome() {
  return stateDir();
}

/** Record (or refresh) an attachment: the local packages this repo routes at the registry. */
export function record(cwd, packages) {
  const data = read();
  data.repos[resolve(cwd)] = {
    id: repoId(cwd),
    packages,
    attachedAt: new Date().toISOString(),
  };
  writeLedger(data);
}

/** Drop an attachment and its baseline snapshot. */
export function forget(cwd) {
  const data = read();
  delete data.repos[resolve(cwd)];
  writeLedger(data);
  rmSync(join(stateDir(), repoId(cwd)), { recursive: true, force: true });
}

/** This repo's attachment record, or undefined. */
export function get(cwd) {
  return read().repos[resolve(cwd)];
}

/** Every attachment, as `{ path, packages, ... }`. */
export function list() {
  return Object.entries(read().repos).map(([path, v]) => ({ path, ...v }));
}

function baselineDir(cwd) {
  return join(stateDir(), repoId(cwd));
}

function snapPath(cwd, lockfilePath) {
  return join(baselineDir(cwd), basename(lockfilePath));
}

/** True once a session baseline has been snapshotted — i.e. the lockfile is currently held. */
export function hasBaseline(cwd, lockfilePath) {
  const snap = snapPath(cwd, lockfilePath);
  return existsSync(snap) || existsSync(`${snap}.absent`);
}

/**
 * Snapshot the pristine lockfile before the session starts mutating it. A repo with no committed
 * lockfile yet gets an `.absent` marker instead, so detach can delete the one sync creates.
 */
export function saveBaseline(cwd, lockfilePath) {
  mkdirSync(baselineDir(cwd), { recursive: true });
  const snap = snapPath(cwd, lockfilePath);
  if (existsSync(lockfilePath)) copyFileSync(lockfilePath, snap);
  else writeFileSync(`${snap}.absent`, '');
}

/** Put the lockfile back to its pre-session state — the default detach. */
export function restoreBaseline(cwd, lockfilePath) {
  const snap = snapPath(cwd, lockfilePath);
  if (existsSync(snap)) copyFileSync(snap, lockfilePath);
  else if (existsSync(`${snap}.absent`) && existsSync(lockfilePath)) {
    rmSync(lockfilePath, { force: true });
  }
}

/** Forget just the baseline (keep the attachment) — hakoba stops managing/reverting this lockfile. */
export function clearBaseline(cwd, lockfilePath) {
  const snap = snapPath(cwd, lockfilePath);
  rmSync(snap, { force: true });
  rmSync(`${snap}.absent`, { force: true });
}
