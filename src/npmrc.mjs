import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addExclude,
  isTracked,
  removeExclude,
  skipWorktree,
} from './gitfile.mjs';

/**
 * The attach/detach mechanism: routing chosen packages at the local registry by editing `.npmrc`,
 * reversibly, and keeping the edit out of git (via `gitfile`).
 */

export const START = '# >>> hakoba >>>';
const END = '# <<< hakoba <<<';
const TAG = '#hakoba# ';

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
  else if (isTracked(cwd, file)) skipWorktree(cwd, '.npmrc', true);
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
    if (isTracked(cwd, file)) skipWorktree(cwd, '.npmrc', false);
    else removeExclude(cwd, '.npmrc');
  }
  return true;
}

/** Whether this repo currently has a hakoba block. */
export function isAttached(cwd) {
  const file = join(cwd, '.npmrc');
  return existsSync(file) && readFileSync(file, 'utf8').includes(START);
}
