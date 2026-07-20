import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Finding the packages in a workspace, without needing to know how the workspace is configured. */

const SKIP = new Set(['node_modules', '.git', 'dist', '.aceify', '.next']);

function findPackageJsons(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) findPackageJsons(join(dir, e.name), out);
    } else if (e.name === 'package.json') {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Publishable packages in a workspace: named, versioned, not private. */
export function publishablePackages(cwd) {
  const out = [];
  for (const file of findPackageJsons(cwd)) {
    const j = readJson(file);
    if (j?.name && j.version && j.private !== true) {
      out.push({ name: j.name, version: j.version, dir: dirname(file) });
    }
  }
  return out;
}

/** Every dependency name declared anywhere in the workspace. */
export function dependencyNames(cwd) {
  const names = new Set();
  for (const file of findPackageJsons(cwd)) {
    const j = readJson(file);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const name of Object.keys(j?.[field] ?? {})) names.add(name);
    }
  }
  return [...names];
}

/**
 * Where each of `names` is actually declared: the manifest's dir, the dependency field, and the
 * version range. This is what lets a re-resolve remove-and-re-add a package with its exact original
 * spec, in the right workspace project and the right field, leaving package.json unchanged.
 *
 * Only the installed fields are considered — a `peerDependencies`-only entry isn't a package you
 * install, so there is nothing to re-resolve.
 */
export function dependencyDeclarations(cwd, names) {
  const wanted = new Set(names);
  const out = [];
  for (const file of findPackageJsons(cwd)) {
    const j = readJson(file);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, spec] of Object.entries(j?.[field] ?? {})) {
        if (wanted.has(name)) out.push({ name, dir: dirname(file), field, spec });
      }
    }
  }
  return out;
}
