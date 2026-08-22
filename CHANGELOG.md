# hakoba

## 0.2.2

### Patch Changes

- [`455fb2c`](https://github.com/moros-oxus/hakoba/commit/455fb2c5d2236b7eb3bfddbdfb08b4e293d9230a) - Publishing works again when npmjs carries the same version: the unpublish-first step runs from a neutral directory (npm 11 mangled the spec against the surrounding workspace and the failure was swallowed), and the registry config makes locally-developed scopes authoritative — no npmjs proxy for them — so the same-version overwrite never conflicts with a published copy, and stale proxy-cache metadata can no longer block a publish.
