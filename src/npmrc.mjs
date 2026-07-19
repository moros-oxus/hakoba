import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sh, shOk } from './exec.mjs';

/**
 * The attach/detach mechanism: routing chosen packages at the local registry by editing `.npmrc`,
 * reversibly, and keeping the edit out of git.
 */

export const START = '# >>> hakoba >>>';
const END = '# <<< hakoba <<<';
const TAG = '#hakoba# ';

// ── git ────────────────────────────────────────────────────────────────────────────────────────

function gitDir(cwd) {
  try {
    return sh('git', ['rev-parse', '--git-dir'], { cwd }).trim();
  } catch {
    return null;
  }
}

function isTracked(cwd, file) {
  return shOk('git', ['ls-files', '--error-unmatch', file], { cwd });
}

function excludePath(cwd) {
  const g = gitDir(cwd);
  return g ? join(cwd, g, 'info', 'exclude') : null;
}

function addExclude(cwd, entry) {
  const p = excludePath(cwd);
  if (!p) return;
  const content = existsSync(p) ? readFileSync(p, 'utf8') : '';
  if (!content.split('\n').includes(entry)) {
    writeFileSync(p, `${content.replace(/\s*$/, '')}\n${entry}\n`);
  }
}

function removeExclude(cwd, entry) {
  const p = excludePath(cwd);
  if (!p || !existsSync(p)) return;
  const kept = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l !== entry);
  writeFileSync(p, kept.join('\n'));
}

// ── the marker block ───────────────────────────────────────────────────────────────────────────

function keyOf(line) {
  const m = line.match(/^\s*([^#=][^=]*?)\s*=/);
  return m ? m[1].trim() : null;
}

/** Remove our marker block and un-comment any lines we had tagged. Restores the file's prior state. */
export function strip(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split('\n')) {
    if (line.trim() === START) {
      inBlock = true;
      continue;
    }
    if (line.trim() === END) {
      inBlock = false;
      continue;
    }
    if (inBlock) continue;
    out.push(line.startsWith(TAG) ? line.slice(TAG.length) : line);
  }
  return out.join('\n');
}

/** Build the `.npmrc` lines that route the chosen packages at the registry. */
export function routingLines(names, registry) {
  const lines = [];
  const scopes = new Set();
  let unscoped = false;
  for (const name of names) {
    if (name.startsWith('@')) scopes.add(name.split('/')[0]);
    else unscoped = true;
  }
  for (const scope of scopes) lines.push(`${scope}:registry=${registry}`);
  if (unscoped) lines.push(`registry=${registry}`);
  return lines;
}

/** Write the marker block, tag-commenting any existing line it overrides, and keep it out of git. */
export function apply(cwd, lines) {
  const file = join(cwd, '.npmrc');
  const existed = existsSync(file);
  let body = strip(existed ? readFileSync(file, 'utf8') : '');
  const keys = new Set(lines.map(keyOf));
  body = body
    .split('\n')
    .map((line) => {
      const k = keyOf(line);
      return k && keys.has(k) && !line.trim().startsWith('#') ? TAG + line : line;
    })
    .join('\n')
    .replace(/\s*$/, '');
  const result = [body, START, ...lines, END, '']
    .filter((l, i) => !(i === 0 && l === ''))
    .join('\n');
  writeFileSync(file, result);
  if (!existed) addExclude(cwd, '.npmrc');
  else if (isTracked(cwd, file)) {
    shOk('git', ['update-index', '--skip-worktree', '.npmrc'], { cwd });
  }
}

/** Undo {@link apply}. Returns false when there was nothing attached. */
export function restore(cwd) {
  const file = join(cwd, '.npmrc');
  if (!existsSync(file)) return false;
  const restored = strip(readFileSync(file, 'utf8'));
  if (restored.trim() === '') {
    unlinkSync(file);
    removeExclude(cwd, '.npmrc');
  } else {
    writeFileSync(file, `${restored.replace(/\s*$/, '')}\n`);
    if (isTracked(cwd, file)) {
      shOk('git', ['update-index', '--no-skip-worktree', '.npmrc'], { cwd });
    } else removeExclude(cwd, '.npmrc');
  }
  return true;
}

/** Whether this repo currently has a hakoba block. */
export function isAttached(cwd) {
  const file = join(cwd, '.npmrc');
  return existsSync(file) && readFileSync(file, 'utf8').includes(START);
}
