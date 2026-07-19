import { existsSync } from 'node:fs';
import { shPm, shPmOk } from './exec.mjs';
import * as gitfile from './gitfile.mjs';
import * as lockfile from './lockfile.mjs';
import * as npmrc from './npmrc.mjs';
import { dependencyNames, publishablePackages } from './packages.mjs';
import { detectAgent, publishCommand, unpublishCommand } from './pm.mjs';
import * as registry from './registry.mjs';
import { REGISTRY } from './registry.mjs';
import * as state from './state.mjs';
import * as ui from './ui.mjs';

/** The commands. Each one is the whole of what a verb does; `bin/hakoba.mjs` only wires them up. */

export function up() {
  registry.up();
  ui.log.success(`registry up at ${ui.chalk.cyan(REGISTRY)}`);
}

export function down() {
  registry.down();
  ui.log.success('registry stopped');
}

export async function status(cwd) {
  const isUp = await registry.isUp();
  ui.log.step(
    `registry ${ui.chalk.cyan(REGISTRY)}: ${isUp ? ui.chalk.green('up') : ui.chalk.red('DOWN')}`,
  );
  if (isUp) {
    const names = await registry.localPackages();
    ui.log.step(`published locally: ${names.length ? names.join(', ') : ui.chalk.dim('(none)')}`);
  }
  ui.log.step(
    `this repo: ${npmrc.isAttached(cwd) ? ui.chalk.green('attached') : ui.chalk.dim('not attached')}`,
  );
  const agent = await detectAgent(cwd);
  const lf = lockfile.lockfilePath(cwd, agent);
  if (lf && state.hasBaseline(cwd, lf)) {
    ui.log.step(`lockfile: ${ui.chalk.yellow('held')} (synced this session)`);
  }
  ui.log.step(`state: ${ui.chalk.dim(state.ledgerHome())}`);
}

export async function publish(cwd, opts) {
  registry.ensureToken();
  const all = publishablePackages(cwd);
  if (!all.length) {
    ui.log.error('no publishable packages found here');
    process.exitCode = 1;
    return;
  }

  const chosen = await ui.choose(all, 'Publish which packages?', opts);
  if (!chosen.length) return ui.log.warn('nothing selected');

  const agent = await detectAgent(cwd);
  const { cmd, args, note } = publishCommand(agent, REGISTRY);
  if (note) ui.log.warn(note);

  for (const pkg of chosen) {
    // Unpublish first so a stable version can be overwritten in place — no dev tags, so consumers'
    // version ranges never have to change to see the new build.
    const prior = unpublishCommand(`${pkg.name}@${pkg.version}`, REGISTRY);
    shPmOk(prior.cmd, prior.args, { cwd });
    shPm(cmd, args, { cwd: pkg.dir });
  }
  ui.log.success(`published ${chosen.map((p) => p.name).join(', ')} → ${REGISTRY}`);

  // Push: bring every attached repo that routes one of these packages up to the new bytes.
  const published = new Set(chosen.map((p) => p.name));
  const targets = state
    .list()
    .filter((e) => existsSync(e.path) && e.packages.some((p) => published.has(p)));
  if (targets.length) {
    ui.log.step(`pushing to ${targets.length} attached repo(s)…`);
    for (const target of targets) {
      try {
        await sync(target.path);
      } catch (err) {
        ui.log.warn(`sync failed for ${target.path}: ${err?.message ?? err}`);
      }
    }
  }
}

export async function unpublish(cwd, opts) {
  const all = publishablePackages(cwd);
  if (!all.length) {
    ui.log.error('no packages found here');
    process.exitCode = 1;
    return;
  }

  const chosen = await ui.choose(all, 'Remove which packages from the registry?', opts);
  if (!chosen.length) return ui.log.warn('nothing selected');
  if (!(await ui.confirm(`Unpublish ${chosen.length} package(s)?`, opts))) return ui.log.warn('aborted');

  for (const pkg of chosen) {
    const { cmd, args } = unpublishCommand(pkg.name, REGISTRY);
    shPm(cmd, args, { cwd });
  }
  ui.log.success(`unpublished ${chosen.map((p) => p.name).join(', ')}`);
}

export async function attach(cwd, opts) {
  const local = new Set(await registry.localPackages());
  if (!local.size) ui.log.warn('no locally-published packages found — is the registry up?');

  // Eligible = a dependency of this repo that also exists in the local registry. `--all` widens that
  // to everything published, for wiring up a dependency the repo does not declare yet.
  let eligible = dependencyNames(cwd)
    .filter((n) => local.has(n))
    .map((name) => ({ name }));
  if (opts.all) eligible = [...local].map((name) => ({ name }));

  if (!eligible.length) {
    ui.log.error('nothing eligible to attach (no deps match local packages)');
    process.exitCode = 1;
    return;
  }

  const chosen = await ui.choose(eligible, 'Route which packages at the local registry?', opts);
  if (!chosen.length) return ui.log.warn('nothing selected');

  const names = chosen.map((c) => c.name);
  npmrc.apply(cwd, npmrc.routingLines(names, REGISTRY));
  state.record(cwd, names);
  ui.log.success(`attached ${names.join(', ')} → ${REGISTRY}`);

  // Pull the routed packages in by default (`--no-sync` to only route the .npmrc).
  if (opts.sync === false) {
    ui.log.info('routed only — run `hakoba sync` to pull them into node_modules.');
  } else {
    await sync(cwd);
  }
}

export async function detach(cwd, opts = {}) {
  const agent = await detectAgent(cwd);
  const lf = lockfile.lockfilePath(cwd, agent);
  const held = Boolean(lf && state.hasBaseline(cwd, lf));

  if (held) {
    // Un-hide either way; the difference is whether we revert the lockfile or leave the dev one.
    gitfile.unhide(cwd, lockfile.lockfileName(agent));
    if (opts.keep) {
      ui.log.info('lockfile kept, un-hidden — `git commit` it to keep, or `git checkout` to discard');
      ui.log.info('note: a kept lockfile pins hakoba dev versions — it needs hakoba up to install');
    } else {
      state.restoreBaseline(cwd, lf);
    }
  }

  const wasAttached = npmrc.restore(cwd);
  state.forget(cwd);

  if (!wasAttached && !held) return ui.log.info('not attached');
  ui.log.success(
    opts.keep && held
      ? 'detached — lockfile kept, .npmrc restored'
      : held
        ? 'detached — .npmrc + lockfile restored'
        : 'detached — .npmrc restored',
  );
}

/**
 * Bring this repo's node_modules up to the latest published bytes for the packages it routes, while
 * its *committed* lockfile stays pristine. On the first sync of a session we snapshot the lockfile and
 * hide it from git; from then on it churns invisibly, and `detach` puts the snapshot back.
 */
export async function sync(cwd) {
  const entry = state.get(cwd);
  if (!entry) {
    ui.log.error('not attached — run `hakoba attach` first');
    process.exitCode = 1;
    return;
  }
  if (!(await registry.isUp())) {
    ui.log.error(`registry ${REGISTRY} is down — run \`hakoba up\``);
    process.exitCode = 1;
    return;
  }

  const agent = await detectAgent(cwd);
  const lf = lockfile.lockfilePath(cwd, agent);
  // Snapshot + hide once per session, before the first re-resolve churns the lockfile — even if the
  // repo has no lockfile yet (an `.absent` baseline; sync is about to create one, so hide it too).
  if (lf && !state.hasBaseline(cwd, lf)) {
    state.saveBaseline(cwd, lf);
    gitfile.hide(cwd, lockfile.lockfileName(agent));
  }

  lockfile.reresolve(cwd, agent, entry.packages);
  ui.log.success(
    `synced ${entry.packages.join(', ')} → ${ui.chalk.cyan(cwd)} ${ui.chalk.dim('(lockfile held)')}`,
  );
}

/**
 * Un-hide the current lockfile so the consumer can decide to keep it (`git commit`) or throw it away
 * (`git checkout`). hakoba never runs git — it only stops hiding the change, and drops the baseline so
 * it no longer reverts this lockfile (the repo stays attached; a later `sync` re-manages it). It is
 * the consumer's from here.
 */
export async function keep(cwd) {
  const agent = await detectAgent(cwd);
  const lf = lockfile.lockfilePath(cwd, agent);
  if (!lf || !state.hasBaseline(cwd, lf)) {
    return ui.log.info('nothing to keep — no held lockfile (run `hakoba sync` first)');
  }
  gitfile.unhide(cwd, lockfile.lockfileName(agent));
  state.clearBaseline(cwd, lf);
  ui.log.success('lockfile un-hidden — `git commit` it to keep, or `git checkout` it to discard');
  ui.log.info('note: a kept lockfile pins hakoba dev versions — it needs hakoba up to install');
}
