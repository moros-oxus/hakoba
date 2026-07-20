import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv, sh, shPm } from './exec.mjs';
import { dependencyDeclarations } from './packages.mjs';
import { REGISTRY } from './registry.mjs';

/**
 * The consumer-side lockfile: where it lives per package manager, and how to make the routed packages
 * re-resolve so an in-place republish is actually picked up.
 */

const LOCKFILES = {
  npm: 'package-lock.json',
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  bun: 'bun.lockb',
};

/** The lockfile a given agent writes; version suffixes (`pnpm@6`) share the base agent's file. */
export function lockfileName(agent) {
  return LOCKFILES[agent] ?? LOCKFILES[agent.split('@')[0]] ?? null;
}

export function lockfilePath(cwd, agent) {
  const name = lockfileName(agent);
  return name ? join(cwd, name) : null;
}

// ── forcing a re-resolution ──────────────────────────────────────────────────────────────────────

/**
 * How each agent adds and removes a dependency. Both take the same `--save-*` flags to pin the field.
 */
const AGENTS = {
  pnpm: { add: 'add', remove: 'remove' },
  npm: { add: 'install', remove: 'uninstall' },
};

/** package.json field → the `--save-*` flag that puts a re-added package back in it. */
const SAVE = {
  dependencies: '--save-prod',
  devDependencies: '--save-dev',
  optionalDependencies: '--save-optional',
};

/** pnpm's on-disk name for a registry host: the URL host with `:` → `+`, e.g. `localhost+4873`. */
function registryHost() {
  return new URL(REGISTRY).host.replace(/:/g, '+');
}

/** pnpm's cache root — an explicit `cacheDir` config if set, else env-paths' per-platform default. */
function pnpmCacheDir() {
  try {
    const configured = sh('pnpm', ['config', 'get', 'cacheDir'], { env: cleanEnv() }).trim();
    if (configured && configured !== 'undefined') return configured;
  } catch {
    // fall through to the default
  }
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Caches', 'pnpm');
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'pnpm', 'Cache');
  }
  return join(process.env.XDG_CACHE_HOME || join(home, '.cache'), 'pnpm');
}

/**
 * Forget pnpm's cached packument for the dev registry, so a re-resolution fetches the republished
 * bytes instead of a stale version→integrity map. Scoped to the dev host under each `metadata*` dir —
 * every other registry's cache is left untouched, and pnpm simply refetches this one on demand.
 */
function forgetMetadata() {
  const cache = pnpmCacheDir();
  if (!existsSync(cache)) return;
  const host = registryHost();
  for (const dir of readdirSync(cache)) {
    if (!dir.startsWith('metadata')) continue;
    const hostDir = join(cache, dir, host);
    if (existsSync(hostDir)) rmSync(hostDir, { recursive: true, force: true });
  }
}

/**
 * Re-resolve the routed `packages` from the registry in `cwd` — the mechanism `sync` relies on to pick
 * up an in-place, same-version republish.
 *
 * This is the crux, and it is harder than it looks. A same-version republish is invisible to a plain
 * install, to `--force`, *and* to `<pm> update`: the lockfile pins the version to an integrity hash — a
 * frozen snapshot of the old bytes — and nothing keyed on the version (which didn't change) ever
 * reopens it. Even deleting the lockfile isn't enough: the manager reuses the existing node_modules and
 * its own resolution caches and reconstructs the same pins. The one thing that forces a genuine
 * re-resolution is to **remove** each routed package (freeing its resolution) and **add** it back with
 * its original spec — an explicit resolve that bypasses every reuse path — after forgetting the dev
 * registry's cached metadata. package.json ends up exactly as it was; only the lockfile churns.
 */
export function reresolve(cwd, agent, packages) {
  const base = agent.split('@')[0];
  const verbs = AGENTS[base];
  if (!verbs) {
    throw new Error(`hakoba sync supports pnpm and npm for now, not ${agent}`);
  }

  // pnpm serves a cached packument past a same-version republish; npm revalidates via etag on its own.
  if (base === 'pnpm') forgetMetadata();

  // Rewrite each project's manifest once: group the routed packages by where + how they're declared,
  // then remove-then-add the whole group so package.json is only ever briefly incomplete.
  const groups = new Map();
  for (const decl of dependencyDeclarations(cwd, packages)) {
    const key = `${decl.dir}\0${decl.field}`;
    if (!groups.has(key)) groups.set(key, { dir: decl.dir, field: decl.field, decls: [] });
    groups.get(key).decls.push(decl);
  }

  for (const { dir, field, decls } of groups.values()) {
    const names = decls.map((d) => d.name);
    const specs = decls.map((d) => `${d.name}@${d.spec}`);
    shPm(base, [verbs.remove, ...names], { cwd: dir });
    shPm(base, [verbs.add, SAVE[field], ...specs].filter(Boolean), { cwd: dir });
  }
}
