import { execFileSync } from 'node:child_process';

/**
 * Running child processes, and the one subtlety that matters: **package-manager config leaks through
 * the environment**.
 */

/**
 * A package manager exports its own settings to child processes as `npm_config_*`, and every package
 * manager reads `npm_config_*` back in as config. So running hakoba under one manager and spawning
 * another hands the second one the first one's settings. npm parses what it can and warns about the
 * rest:
 *
 * ```
 * npm warn Unknown env config "verify-deps-before-run".
 * npm warn Unknown env config "npm-globalconfig".
 * npm warn Unknown env config "_jsr-registry".
 * ```
 *
 * Those are pnpm's settings, arriving in npm. The noise is the visible half; the real problem is that
 * an inherited `npm_config_registry` is config we never asked for. A spawned manager should read its
 * own config from the project it runs in, so we drop the inherited set on the way out.
 */
export function cleanEnv(env = process.env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.toLowerCase().startsWith('npm_config_')) out[key] = value;
  }
  return out;
}

/** Run a command, returning stdout. Throws on a non-zero exit. */
export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

/** Run a command, swallowing output and errors; true when it exited zero. */
export function shOk(cmd, args, opts = {}) {
  try {
    sh(cmd, args, { stdio: 'ignore', ...opts });
    return true;
  } catch {
    return false;
  }
}

/** Run a package manager: inherits stdio, and never inherits another manager's config. */
export function shPm(cmd, args, opts = {}) {
  return sh(cmd, args, { stdio: 'inherit', env: cleanEnv(), ...opts });
}

/** Run a package manager, swallowing failure (e.g. unpublishing something that was never there). */
export function shPmOk(cmd, args, opts = {}) {
  return shOk(cmd, args, { env: cleanEnv(), ...opts });
}
