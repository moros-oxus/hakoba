<img src="./docs/assets/hakoba-logo-v3.svg" alt="Hakoba: Local staging yard" />

<!-- <div style="display:flex; flex-direction: row; align-items: center; width: 100%; gap: 4rem; justify-content: center; background-color: #16161a; margin-bottom: 2em;">
<img src="./docs/assets/hakoba-logo-v2.svg" alt="Hakoba: Local staging yard"  style="aspect-ratio: 1/1; max-height: 20em;"/>
<div style="display: flex; flex-direction: column;  background-image: linear-gradient(to right, #ff4d4d, #ff4d4d); background-position: bottom left; background-size: 44% 4px; background-repeat: no-repeat; padding-bottom: 10px;">
  <h1 style="color: #e0e4e6; font-size: 72px; line-height: .75em; font-weight: 800; letter-spacing: 2; border: none; margin: 0;">hakoba</h1>
  <p style="color: #ff4d4d; font-size: 14px; font-weight: 600; letter-spacing: 8; margin:0; text-transform: uppercase;">Local Staging Yard</p>
</div>
</div> -->

A local **dev-registry bridge** over [Verdaccio](https://verdaccio.org/). Publish work-in-progress
packages to a private registry on your machine, then let any repo **attach** to consume them exactly
like real dependencies — everything else passes straight through to npmjs.

It replaces fragile `link:` / `npm link` bridges: consumers resolve WIP packages by semver, and because
pnpm's lockfile is integrity-only, uplinked packages produce byte-identical lockfiles (no churn).

## Install

```bash
npm install hakoba --save-dev
```

Every repo can hold its own copy. `docker-compose.yml` names the compose project, so `hakoba up`
addresses the same stack no matter which copy runs it: bringing it up from a second repo attaches to
the container that is already running rather than starting another.

Then run it through your package manager (`pnpm hakoba status`, `npx hakoba status`, or a script).

## Use

```bash
hakoba up                 # start the registry (docker; once per session)
hakoba status             # registry state + locally-published packages + this repo's attach state

# from a package/workspace you're developing:
hakoba publish            # publish its packages to the local registry (unpublish-first overwrite)

# from a repo that should consume them:
hakoba attach             # route matching deps at the local registry (edits .npmrc)
#   … develop; your PM install now resolves those packages from the registry …
hakoba detach             # restore .npmrc exactly

hakoba down               # stop the registry
```

- `publish`, `unpublish` and `attach` **ask** when you run them in a terminal, with every candidate
  pre-selected — deselect what you don't want. Piped, redirected, or in CI there is nobody to ask, so
  they take every candidate; `-y/--yes` forces that behaviour anywhere.
- `attach` offers every eligible dependency (a repo dep that is also published locally); `--all` offers
  everything published, for wiring up a dependency the repo does not declare yet. Scoped names get a
  `@scope:registry` line; an unscoped pick (e.g. `aceify`) routes the default registry.
- `attach`/`detach` edit only `.npmrc`, inside a `# >>> hakoba >>>` … `<<<` marker block, and
  tag-comment (`#hakoba#`) any line they override. A fresh `.npmrc` is added to `.git/info/exclude`;
  a committed one is protected with `git update-index --skip-worktree`. Nothing is ever committed.

## Config

Verdaccio config is in [`conf/config.yaml`](conf/config.yaml) (uplinks npmjs, anonymous publish for
local dev). Packages are stored in a Docker volume. Override the registry URL with
`HAKOBA_REGISTRY`.

## Notes

**Publishing uses your package manager.** The agent is detected with
[`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) (lockfiles,
the `packageManager` field, `devEngines`, install metadata) and it is not a cosmetic choice: `pnpm
publish` is what rewrites `workspace:*` dependencies into real ranges. Publishing a pnpm workspace with
npm ships a manifest still saying `workspace:*`, which no consumer can resolve.

**Unpublishing uses npm**, on purpose — it is a plain registry call with no workspace semantics, and
the alternatives delegate anyway (`pnpm unpublish --help` prints *"Usage: npm unpublish"*).

**Spawned managers get a clean environment.** A package manager exports its settings as `npm_config_*`,
and every manager reads `npm_config_*` back in — so running hakoba under one and spawning another hands
the second the first one's config, which is where `npm warn Unknown env config "verify-deps-before-run"`
came from. hakoba drops the inherited set, so a spawned manager reads its own config.
