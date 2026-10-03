import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { resolve, join } from 'node:path';
import { startServer } from '../scripts/server.mjs';

const root = resolve('node_modules/.cache/server-test-static');
await rm(root, { recursive: true, force: true });
await mkdir(join(root, 'assets'), { recursive: true });
await writeFile(join(root, 'index.html'), '<!doctype html><title>BeesCAD test</title>');
await writeFile(join(root, 'version.json'), JSON.stringify({ sha: 'test-sha', short: 'test-sha' }));
await writeFile(join(root, 'assets', 'app.js'), 'export const ok = true;');

async function withServer(opts, body) {
  const handle = await startServer(opts);
  try {
    await body(handle);
  } finally {
    await new Promise((resolveClose) => {
      handle.server.close(() => resolveClose());
      handle.server.closeAllConnections?.();
    });
  }
}

const notes = [];

try {
  await withServer({ port: 0, host: '127.0.0.1', root, self: true }, async ({ url }) => {
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
  });

  // Сайт, открытый наружу (--host 0.0.0.0): страницы должны открываться с другого
  // устройства, а привилегированное обновление — оставаться только для loopback.
  let lanIp = null;
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) { lanIp = ni.address; break; }
    }
    if (lanIp) break;
  }
  if (lanIp) {
    await withServer({ port: 0, host: '0.0.0.0', root, self: true }, async ({ port }) => {
      const lan = `http://${lanIp}:${port}`;
      const home = await fetch(lan + '/');
      assert.equal(home.status, 200, 'сайт не открывается по внешнему адресу');
      assert.match(await home.text(), /BeesCAD/);

      const asset = await fetch(lan + '/assets/app.js');
      assert.equal(asset.status, 200);

      const updateFromLan = await fetch(lan + '/update/status');
      assert.equal(updateFromLan.status, 403, '/update/* должен быть закрыт для сети');
      assert.equal((await updateFromLan.json()).ok, false);

      const runFromLan = await fetch(lan + '/update/run', { method: 'POST' });
      assert.equal(runFromLan.status, 403);

      const updateLocal = await fetch(`http://127.0.0.1:${port}/update/status`);
      assert.equal((await updateLocal.json()).status, 'idle');
    });
  } else {
    notes.push('проверка внешнего адреса пропущена: в системе нет не-loopback IPv4');
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

for (const n of notes) process.stdout.write('BeesCAD server smoke: ' + n + '\n');
process.stdout.write('BeesCAD server smoke OK: static app, version, update status, health, 404, path traversal, доступ по сети.\n');
