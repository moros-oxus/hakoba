import { detect } from 'package-manager-detector/detect';

/**
 * Which package manager to run, and how to ask it to publish.
 *
 * Detection is `package-manager-detector`'s job: it walks up from the cwd checking lockfiles, the
 * `packageManager` field, `devEngines`, and install metadata — strictly more than the lockfile sniff
 * this replaces.
 *
 * Publishing is *not* its job. Its command table covers install/add/run/execute/uninstall and friends,
 * so `resolveCommand` has nothing to say about `publish` — the one thing hakoba actually does. That
 * table lives here instead.
 */

/** Fallback when a directory belongs to no project at all. */
const DEFAULT_AGENT = 'npm';

/**
 * The detected agent for `cwd`, e.g. `pnpm` or `yarn@berry`. Falls back to npm, which every Node
 * install has.
 */
export async function detectAgent(cwd) {
  const found = await detect({ cwd });
  return found?.agent ?? DEFAULT_AGENT;
}

/**
 * How each agent spells "publish this package to `registry`".
 *
 * This matters more than it looks. `pnpm publish` is what rewrites `workspace:*` dependencies into
 * real version ranges on the way out — publish a pnpm workspace with npm and the tarball's manifest
 * still says `workspace:*`, which no consumer can resolve. So the agent is not a cosmetic choice.
 *
 * `null` means "we don't know how to publish with this agent"; the caller falls back to npm and says
 * so, rather than inventing a command line.
 */
const PUBLISH = {
  npm: (registry) => ['publish', '--registry', registry],
  // --no-git-checks: hakoba publishes work in progress, which is the whole point.
  pnpm: (registry) => ['publish', '--registry', registry, '--no-git-checks'],
  'pnpm@6': (registry) => ['publish', '--registry', registry, '--no-git-checks'],
  yarn: (registry) => ['publish', '--registry', registry, '--non-interactive'],
  // Berry moved npm-facing commands under `yarn npm`, and takes the registry from config only.
  'yarn@berry': null,
  bun: (registry) => ['publish', '--registry', registry],
  deno: null,
  nub: null,
  aube: null,
};

/**
 * The command to publish from `dir` with `agent`. Returns `{ cmd, args, note? }` — `note` is set when
 * we fell back to npm, so the caller can tell the user why.
 */
export function publishCommand(agent, registry) {
  const build = PUBLISH[agent];
  if (build) return { cmd: agentBin(agent), args: build(registry) };
  return {
    cmd: 'npm',
    args: PUBLISH.npm(registry),
    note: `${agent} has no publish command hakoba knows — using npm`,
  };
}

/**
 * The command to remove `spec` from `registry`.
 *
 * Always npm, deliberately. Unpublish is a plain registry operation with no workspace semantics to
 * respect, and the alternatives don't implement it: `pnpm unpublish --help` prints "Usage: npm
 * unpublish" — it delegates. Spawning npm ourselves is the same work with one less layer, and (via
 * `shPm`) a clean environment.
 */
export function unpublishCommand(spec, registry) {
  return { cmd: 'npm', args: ['unpublish', spec, '--registry', registry, '--force'] };
}

/** The binary for an agent — the version suffix is detection detail, not a command. */
function agentBin(agent) {
  return agent.split('@')[0];
}
