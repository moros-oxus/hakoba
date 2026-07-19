import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, shOk } from './exec.mjs';

/**
 * Keeping hakoba's session edits out of git — the shared mechanism behind both `.npmrc` and the
 * session-local lockfile. A tracked file is hidden with `skip-worktree`; a file hakoba created is
 * added to `.git/info/exclude`. Nothing is ever committed.
 */

function gitDir(cwd) {
  try {
    return sh('git', ['rev-parse', '--git-dir'], { cwd }).trim();
  } catch {
    return null;
  }
}

/** Whether git tracks `file` in `cwd`. */
export function isTracked(cwd, file) {
  return shOk('git', ['ls-files', '--error-unmatch', file], { cwd });
}

function excludePath(cwd) {
  const g = gitDir(cwd);
  return g ? join(cwd, g, 'info', 'exclude') : null;
}

/** Add `entry` to `.git/info/exclude` (idempotent). */
export function addExclude(cwd, entry) {
  const p = excludePath(cwd);
  if (!p) return;
  const content = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (!content.split('\n').includes(entry)) {
    writeFileSync(p, `${content.replace(/\s*$/, '')}\n${entry}\n`);
  }
}

/** Remove `entry` from `.git/info/exclude`. */
export function removeExclude(cwd, entry) {
  const p = excludePath(cwd);
  if (!p || !existsSync(p)) return;
  const kept = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l !== entry);
  writeFileSync(p, kept.join('\n'));
}

/** Toggle the skip-worktree bit on a tracked file. */
export function skipWorktree(cwd, file, on) {
  shOk(
    'git',
    ['update-index', on ? '--skip-worktree' : '--no-skip-worktree', file],
    { cwd },
  );
}

/**
 * Hide a file's working-tree changes from git: skip-worktree if tracked, else mark it excluded. Used
 * for the session-local lockfile (always tracked) and available for any other session file.
 */
export function hide(cwd, file) {
  if (isTracked(cwd, file)) skipWorktree(cwd, file, true);
  else addExclude(cwd, file);
}

/** Undo {@link hide}. */
export function unhide(cwd, file) {
  if (isTracked(cwd, file)) skipWorktree(cwd, file, false);
  else removeExclude(cwd, file);
}
