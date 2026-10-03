import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startServer } from '../scripts/server.mjs';

const root = resolve('node_modules/.cache/server-test-static');
await rm(root, { recursive: true, force: true });
await mkdir(join(root, 'assets'), { recursive: true });
await writeFile(join(root, 'index.html'), '<!doctype html><title>BeesCAD test</title>');
await writeFile(join(root, 'version.json'), JSON.stringify({ sha: 'test-sha', short: 'test-sha' }));
await writeFile(join(root, 'assets', 'app.js'), 'export const ok = true;');
const { server, url } = await startServer({ port: 0, host: '127.0.0.1', root, self: true });
try {
  const home = await fetch(url + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /BeesCAD/);

  const health = await fetch(url + '/healthz');
  assert.deepEqual(await health.json(), { ok: true });

  const version = await fetch(url + '/version');
  assert.equal(version.status, 200);
  assert.equal((await version.json()).short, 'test-sha');

  const idleUpdate = await fetch(url + '/update/status');
  assert.equal((await idleUpdate.json()).status, 'idle');

  const missing = await fetch(url + '/assets/does-not-exist.js');
  assert.equal(missing.status, 404);

  const traversal = await fetch(url + '/..%2Fpackage.json');
  assert.ok(traversal.status === 403 || traversal.status === 404);
} finally {
  await new Promise((resolveClose) => {
    server.close(() => resolveClose());
    server.closeAllConnections?.();
  });
  await rm(root, { recursive: true, force: true });
}

process.stdout.write('BeesCAD server smoke OK: static app, version, update status, health, 404, path traversal.\n');
