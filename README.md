<img src="./docs/assets/hakoba-logo-v3.svg" alt="" aria-hidden />

# hakoba

> Local staging yard

A local **dev-registry bridge** over [Verdaccio](https://verdaccio.org/). Publish work-in-progress
packages to a private registry on your machine, then let any repo **attach** to consume them exactly
like real dependencies — everything else passes straight through to npmjs.

It replaces fragile `link:` / `npm link` bridges: consumers resolve WIP packages by semver, a publish
**pushes** the new build straight into every attached repo's `node_modules`, and hakoba keeps the
lockfile churn a local registry causes out of git — the same way it keeps `.npmrc` out — so your
tracked files stay clean while you iterate.

## Install

> [!WARNING] Docker required!

> [!IMPORTANT] Supported Package Managers
> Only `pnpm` and `npm` are officially supported at this time.

```bash
# npm
npm install --save-dev hakoba
npx hakoba <command>

# pnpm
pnpm add --save-dev hakoba
pnpm dlx hakoba <command>        # or: pnpx hakoba <command>

```

## Use

Run through your package manager — `pnpm hakoba <command>`, `npx hakoba <command>`, or a script.

```bash
hakoba up                 # start the registry (docker; once per session)
hakoba status             # registry state + local packages + this repo's attach/sync state

# from a package/workspace you're developing:
hakoba publish            # publish its packages (unpublish-first overwrite), then push to attached repos

# from a repo that should consume them:
hakoba attach             # route matching deps (.npmrc) + pull them into node_modules
hakoba sync               # pull the latest published package(s) again (also runs automatically on a publish)
hakoba keep               # un-hide the lockfile so you can commit or discard it (hakoba never commits)
hakoba detach             # restore .npmrc + the baseline lockfile

hakoba down               # stop the registry
```

## CLI

### `up`

Start the registry (docker; once per session).

### `down`

Stop the registry.

### `status`

Show the registry state, the locally-published packages, and this repo's attach/sync state.

### `publish`

Publish this workspace's packages to the registry

| option | description |
| --- | --- |
| `-y, --yes` | skip prompts; publish every candidate. |

> [!TIP]- publish mechanics
> (unpublish-first, so a stable version is overwritten
in place), then **push** to every attached repo that routes one of them — their `node_modules` pick up
the new build immediately, with no lockfile churn in git.



### `unpublish`

Remove packages from the registry.

| option | description |
| --- | --- |
| `-y, --yes` | skip prompts; remove every candidate. |

### `attach`

Route this repo's matching dependencies at the registry (via `.npmrc`) and pull them into
`node_modules`. Eligible = a repo dependency that is also published locally; scoped names get a
`@scope:registry` line, an unscoped pick (e.g. `aceify`) routes the default registry. Fully reversible
and never committed.

| option | description |
| --- | --- |
| `-y, --yes` | skip prompts; route every eligible candidate. |
| `--all` | offer every published package, not just this repo's dependencies. |
| `--no-sync` | route the `.npmrc` only; don't pull into `node_modules`. |

> [!TIP]- attach mechanics
> `attach` does two things: it routes `.npmrc` at the local registry, and it installs to **pull the
> package's code into `node_modules`** — that pull is the point. The install rewrites the lockfile (a
> republish changes its integrity), so hakoba keeps that churn out of git for you; `sync` pulls a newer
> build later, `keep` hands you the lockfile if you want to commit it, `detach` restores it.
>
> `--no-sync` stops at routing, with **no pull** — handy to pre-wire a package that isn't published yet
> (a plain `attach` would try to pull and fail), or when you'd rather run the install yourself. The
> common case wants the pull, which is why it's the default.

### `detach`

Undo `attach`: restore `.npmrc` and the baseline lockfile.

| option | description |
| --- | --- |
| `--keep` | un-hide the current lockfile instead of restoring the baseline. |

### `sync`

Pull the latest published package(s) into `node_modules`; 

> [!WARNING]
> Re-resolve is available for supported package-managers only

> [!TIP]- sync mechanics
> The committed lockfile stays pristine. Runs automatically on `publish` for every attached repo. 


### `keep`

Un-hide the current lockfile so you can `git commit` or `git checkout` it. hakoba never commits.

## Environment

- `HAKOBA_REGISTRY` — the registry URL hakoba publishes to and routes at. Defaults to
  `http://localhost:4873`.
