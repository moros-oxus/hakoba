import { shPm, shPmOk } from './exec.mjs';
import * as npmrc from './npmrc.mjs';
import { dependencyNames, publishablePackages } from './packages.mjs';
import { detectAgent, publishCommand, unpublishCommand } from './pm.mjs';
import * as registry from './registry.mjs';
import { REGISTRY } from './registry.mjs';
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

  npmrc.apply(cwd, npmrc.routingLines(chosen.map((c) => c.name), REGISTRY));
  ui.log.success(`attached ${chosen.map((c) => c.name).join(', ')} → ${REGISTRY}`);
  ui.log.info('run your package manager install to pick up the local versions.');
}

export function detach(cwd) {
  if (!npmrc.restore(cwd)) return ui.log.info('not attached');
  ui.log.success('detached — .npmrc restored');
}
