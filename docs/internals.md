# hakoba internals

How hakoba works under the hood — the mechanics behind each command. None of this is needed to use it;
it's here for anyone changing hakoba or debugging a repo it has wired.

## Registry

The registry is [Verdaccio](https://verdaccio.org/) in a Docker container; `conf/config.yaml` configures
it (uplinks npmjs, anonymous publish for local dev), and packages live in a Docker volume that survives
`hakoba down`. `docker-compose.yml` names the compose project, so `hakoba up` from any repo addresses the
same stack rather than starting another. The registry URL comes from `HAKOBA_REGISTRY`
(default `http://localhost:4873`).

## Routing (`.npmrc`)

`attach`/`detach` edit `.npmrc` inside a `# >>> hakoba >>>` … `<<<` marker block, tag-commenting
(`#hakoba#`) any line they override so the original is restored verbatim. Scoped names get a
`@scope:registry` line; an unscoped pick (e.g. `aceify`) routes the default registry. A fresh `.npmrc`
is added to `.git/info/exclude`; a committed one is protected with `git update-index --skip-worktree`.
Nothing is ever committed.

## Publish → push

After publishing, hakoba re-resolves the published packages in every attached repo that routes one of
them, so their `node_modules` pick up the new build at once — the effect of `yalc push`, but through a
real registry.

The re-resolve matters more than it looks. A plain install — even `--force` — will **not** pick up an
in-place republish: the lockfile pins each version to an integrity hash, so the package manager reuses
the cached tarball for an unchanged version and never learns the bytes changed. hakoba forces it with
`<pm> update <packages>`, which re-reads the registry and pulls the new content while touching only the
lockfile (no `package.json` churn). Supported for **pnpm** and **npm**; yarn and bun aren't wired yet.

## The session-local lockfile

Re-resolving rewrites the lockfile, which would otherwise show up as churn on every publish. hakoba
treats it the way it treats `.npmrc`: on the first sync of a session it snapshots the committed lockfile
and hides the working copy (`git update-index --skip-worktree`, or `.git/info/exclude` if the repo has
no committed lockfile yet). From then on it churns invisibly.

- `detach` restores the snapshot — the committed lockfile is back and git is clean.
- `hakoba keep` (or `detach --keep`) **un-hides** it instead, handing you an ordinary working-tree change
  to `git commit` or `git checkout`. hakoba never runs git itself. Note that a kept lockfile pins
  hakoba dev-registry versions, so that repo then needs hakoba up to install.
- `attach --no-sync` routes the `.npmrc` without pulling, if you'd rather install yourself.

## The host-side ledger

To push on publish, hakoba remembers which repos are attached (and each one's pristine lockfile
baseline). That lives in a ledger under `~/.local/state/hakoba` (`$XDG_STATE_HOME`) — on the host, never
inside a repo and never in the container, since it holds host paths and the container stays a plain
Verdaccio.

## Package-manager choices

**Publishing uses your package manager.** The agent is detected with
[`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) (lockfiles,
the `packageManager` field, `devEngines`, install metadata) and it is not a cosmetic choice: `pnpm
publish` is what rewrites `workspace:*` dependencies into real ranges. Publishing a pnpm workspace with
npm ships a manifest still saying `workspace:*`, which no consumer can resolve.

**Unpublishing uses npm**, on purpose — it is a plain registry call with no workspace semantics, and the
alternatives delegate anyway (`pnpm unpublish --help` prints *"Usage: npm unpublish"*).

**Spawned managers get a clean environment.** A package manager exports its settings as `npm_config_*`,
and every manager reads `npm_config_*` back in — so running hakoba under one and spawning another hands
the second the first one's config, which is where `npm warn Unknown env config "verify-deps-before-run"`
came from. hakoba drops the inherited set, so a spawned manager reads its own config.
