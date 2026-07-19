import { join } from 'node:path';
import { shPm } from './exec.mjs';

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

/**
 * How each agent re-resolves specific packages.
 *
 * This is the crux. A plain install — even `--force` — will **not** pick up a same-version republish:
 * the lockfile pins the version to an integrity hash, so the manager reuses the cached tarball and
 * never learns the bytes changed. `pnpm update <pkgs>` re-reads the registry and pulls the new
 * content, touching only the lockfile (no `package.json` churn) — measured, and the mechanism sync
 * relies on. Other agents aren't wired yet rather than guessing a wrong command.
 */
const UPDATE = {
  pnpm: (pkgs) => ['update', ...pkgs],
};

/** Re-resolve `packages` from the registry in `cwd`, updating node_modules + the lockfile. */
export function reresolve(cwd, agent, packages) {
  const build = UPDATE[agent] ?? UPDATE[agent.split('@')[0]];
  if (!build) {
    throw new Error(`hakoba sync supports pnpm for now, not ${agent}`);
  }
  shPm(agent.split('@')[0], build(packages), { cwd });
}
