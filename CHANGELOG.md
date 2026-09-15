# hakoba

## 0.2.3

### Patch Changes

- [`d5cca49`](https://github.com/moros-oxus/hakoba/commit/d5cca49913a8a1e3e75db357f57f0461a1fa4822) - `publish` now routes each package's scope at the local registry on the command line, so publishing from a repo whose `.npmrc` points its own scope at another registry (a company feed) lands here rather than silently going there. Every publish is then verified against the registry, and a package that did not arrive fails the run instead of reporting success.

## 0.2.2

### Patch Changes

- [`455fb2c`](https://github.com/moros-oxus/hakoba/commit/455fb2c5d2236b7eb3bfddbdfb08b4e293d9230a) - Publishing works again when npmjs carries the same version: the unpublish-first step runs from a neutral directory (npm 11 mangled the spec against the surrounding workspace and the failure was swallowed), and the registry config makes locally-developed scopes authoritative — no npmjs proxy for them — so the same-version overwrite never conflicts with a published copy, and stale proxy-cache metadata can no longer block a publish.
