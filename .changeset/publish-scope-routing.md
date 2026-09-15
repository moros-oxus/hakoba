---
"hakoba": patch
---

`publish` now routes each package's scope at the local registry on the command line, so publishing from a repo whose `.npmrc` points its own scope at another registry (a company feed) lands here rather than silently going there. Every publish is then verified against the registry, and a package that did not arrive fails the run instead of reporting success.
