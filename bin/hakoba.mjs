#!/usr/bin/env node
// Hakoba — a local dev-registry bridge over Verdaccio.
//
// Publish WIP packages to a local registry, then let any repo `attach` to consume them like real
// dependencies (everything else passes through to npmjs). State is deliberately minimal: the tool
// derives what it needs from package.json, the running registry, and the `.npmrc` it edits.
//
// This file is wiring only — every verb lives in `src/commands.mjs`.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import * as commands from '../src/commands.mjs';
import { REGISTRY } from '../src/registry.mjs';
import * as ui from '../src/ui.mjs';

const SELF = dirname(dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(join(SELF, 'package.json'), 'utf8'));

const program = new Command();

program
  .name('hakoba')
  .description(`local dev-registry bridge (${REGISTRY})`)
  .version(version)
  .showHelpAfterError();

/**
 * Selection is interactive on a TTY and takes everything otherwise, so `--yes` is how a script says
 * "don't ask". There is no `-i`: being asked is the default when someone is there to answer.
 */
const YES = ['-y, --yes', 'skip prompts; take the default action (every candidate)'];

program
  .command('up')
  .description('start the registry')
  .action(() => commands.up());

program
  .command('down')
  .description('stop the registry')
  .action(() => commands.down());

program
  .command('status')
  .description("registry + local packages + this repo's attach state")
  .action(() => commands.status(process.cwd()));

program
  .command('publish')
  .description("publish this workspace's packages (unpublish-first overwrite)")
  .option(...YES)
  .action((opts) => commands.publish(process.cwd(), opts));

program
  .command('unpublish')
  .description('remove packages from the registry')
  .option(...YES)
  .action((opts) => commands.unpublish(process.cwd(), opts));

program
  .command('attach')
  .description('route local packages in this repo (via .npmrc)')
  .option(...YES)
  .option('--all', "offer every published package, not just this repo's dependencies")
  .action((opts) => commands.attach(process.cwd(), opts));

program
  .command('detach')
  .description('undo attach (restore .npmrc)')
  .action(() => commands.detach(process.cwd()));

program.hook('preAction', (_program, action) => ui.intro(`hakoba ${action.name()}`));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  ui.log.error(error?.message || String(error));
  process.exitCode = 1;
}
