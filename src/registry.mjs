import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sh } from './exec.mjs';

/** The Verdaccio container, and talking to it. */

/** The hakoba repo root — where docker-compose.yml lives. */
const SELF = dirname(dirname(fileURLToPath(import.meta.url)));

export const REGISTRY = (
  process.env.HAKOBA_REGISTRY || 'http://localhost:4873'
).replace(/\/$/, '');

/** Verdaccio accepts any token in this setup; it exists to satisfy npm's auth check. */
const TOKEN = 'hakoba-local';

const COMPOSE = join(SELF, 'docker-compose.yml');

function httpGet(path) {
  return new Promise((resolve) => {
    const url = new URL(path, `${REGISTRY}/`);
    const lib = url.protocol === 'https:' ? https : http;
    lib
      .get(url, (r) => {
        let body = '';
        r.on('data', (d) => {
          body += d;
        });
        r.on('end', () => resolve({ status: r.statusCode ?? 0, body }));
      })
      .on('error', () => resolve({ status: 0, body: '' }));
  });
}

/**
 * Start the registry. `docker-compose.yml` names the compose project, so this is the same stack no
 * matter which directory (or which repo's local install) invokes it — bringing it up twice is a
 * no-op, not a second container.
 */
export function up() {
  sh('docker', ['compose', '-f', COMPOSE, 'up', '-d'], { stdio: 'inherit' });
}

export function down() {
  sh('docker', ['compose', '-f', COMPOSE, 'down'], { stdio: 'inherit' });
}

/** True when the registry answers. */
export async function isUp() {
  return (await httpGet('/-/ping')).status === 200;
}

/** Names of every package published to the local registry. */
export async function localPackages() {
  const r = await httpGet('/-/verdaccio/data/packages');
  if (r.status !== 200) return [];
  try {
    return JSON.parse(r.body).map((p) => p.name);
  } catch {
    return [];
  }
}

/** Put an auth token for the local registry in `~/.npmrc`, so publishes are allowed. */
export function ensureToken() {
  const rc = join(homedir(), '.npmrc');
  const host = REGISTRY.replace(/^https?:/, '');
  const content = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
  if (!content.includes(`${host}/:_authToken=`)) {
    writeFileSync(rc, `${content.replace(/\s*$/, '')}\n${host}/:_authToken=${TOKEN}\n`);
  }
}
