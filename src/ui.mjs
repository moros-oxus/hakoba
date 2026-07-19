import * as p from '@clack/prompts';
import chalk from 'chalk';

/** Talking to the person running the command — and knowing when there isn't one. */

export { chalk };
export const log = p.log;
export const note = p.note;

/**
 * Whether to prompt. A pipe, a CI job, or an explicit `--yes` means nobody is there to answer, so the
 * command takes its default action instead of hanging on a prompt nobody can see.
 *
 * Both ends have to be a terminal, and they can differ: clack's `isTTY` asks about an *output* stream,
 * which says nothing about whether stdin can be read — `hakoba publish < /dev/null` has a perfectly
 * good stdout and nobody to type. Checking only one side either renders a prompt into a pipe or waits
 * forever on input that will never come.
 */
export function canPrompt({ yes = false } = {}) {
  return (
    !yes && Boolean(process.stdin.isTTY) && p.isTTY(process.stdout) && !p.isCI()
  );
}

/** Bail out the way clack expects, so a cancelled prompt doesn't read as a crash. */
export function cancelled(message = 'cancelled') {
  p.cancel(message);
  process.exit(0);
}

/**
 * Pick from `items` (each `{ name }` or a string). Prompts on a TTY; otherwise returns everything,
 * which is what a script or CI run wants.
 *
 * Everything is pre-selected, so the prompt reads as "here's what I'm about to do, deselect what you
 * don't want" — the same outcome as the non-interactive path, with a chance to intervene.
 */
export async function choose(items, message, opts = {}) {
  if (!canPrompt(opts) || items.length === 0) return items;

  const options = items.map((it, i) => ({
    value: i,
    label: it.name ?? String(it),
    hint: it.version,
  }));
  const picked = await p.multiselect({
    message,
    options,
    initialValues: options.map((o) => o.value),
    required: false,
  });
  if (p.isCancel(picked)) cancelled();
  return items.filter((_, i) => picked.includes(i));
}

/** Confirm a destructive step. Non-interactive runs proceed — they asked for it on the command line. */
export async function confirm(message, opts = {}) {
  if (!canPrompt(opts)) return true;
  const ok = await p.confirm({ message });
  if (p.isCancel(ok)) cancelled();
  return ok;
}

/** A spinner for work with no output of its own. */
export function spinner(message) {
  const s = p.spinner();
  s.start(message);
  return s;
}

export function intro(title) {
  p.intro(chalk.bgCyan.black(` ${title} `));
}

export function outro(message) {
  p.outro(message);
}
