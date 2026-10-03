#!/usr/bin/env node
// Автообновление BeesCAD из GitHub (установленная программа, без git-клона).
//
//   node update.mjs --app-dir <каталог программы> [--sha <коммит>] [--progress]
//
//   --sha <коммит>  — какой коммит ставить (сервер уже проверил GitHub, повторно
//                     не спрашиваем — экономим время и лимит GitHub API);
//   --progress      — печатать машиночитаемый прогресс строками «@@P {json}»
//                     (их разбирает scripts/server.mjs для полосы загрузки).
//
// Коды выхода: 0 — ничего не менялось; 10 — обновлено (нужно перезапустить
// сервер); 1 — ошибка (работаем на текущей версии); 2 — отменено пользователем.
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync, renameSync,
  createWriteStream, readdirSync, statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'https://github.com/danilka-revin/BeesCAD.git';
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const PROGRESS = args.includes('--progress');
const FORCED_SHA = argVal('--sha') || '';

const log = (s) => console.log('автообновление: ' + s);
function fail(msg) {
  console.error('автообновление: ' + msg);
  process.exit(1);
}

const P = (o) => { if (PROGRESS) process.stdout.write('@@P ' + JSON.stringify(o) + '\n'); };

const appDirRaw = argVal('--app-dir');
if (!appDirRaw) fail('нужен аргумент --app-dir <каталог>');
const APP_DIR = resolve(appDirRaw);
if (!existsSync(APP_DIR)) fail('нет каталога приложения: ' + APP_DIR);

const read = (name, dflt) => {
  try {
    const s = readFileSync(join(APP_DIR, name), 'utf8').trim();
    return s || dflt;
  } catch {
    return dflt;
  }
};
const repoUrl = read('repo.txt', DEFAULT_REPO);
const branch = process.env.BEESCAD_BRANCH || process.env.PCB_APP_BRANCH || read('branch.txt', 'main');
const currentSha = read('version.txt', '');

const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repoUrl);
if (!m) fail('не удалось разобрать URL репозитория: ' + repoUrl);
const [, owner, name] = m;
const short = (s) => (s || '').slice(0, 7);

const FALLBACK_RUNTIME_FILES = [
  'scripts/server.mjs',
  'scripts/update.mjs',
  'scripts/icon.svg',
];

async function runtimeFileList(srcRoot) {
  try {
    const mod = await import(pathToFileURL(join(srcRoot, 'scripts', 'runtime-files.mjs')).href);
    const list = mod.runtimeFiles(srcRoot);
    if (Array.isArray(list) && list.length) return list;
  } catch { /* исходник без манифеста */ }
  return FALLBACK_RUNTIME_FILES.filter((rel) => existsSync(join(srcRoot, rel)));
}

function stripComments(code) {
  const CODE = 0, LINE = 1, BLOCK = 2, STR = 3, TPL = 4;
  let out = '';
  let state = CODE;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1];
    if (state === CODE) {
      if (c === '/' && next === '/') { state = LINE; i++; continue; }
      if (c === '/' && next === '*') { state = BLOCK; i++; continue; }
      if (c === "'" || c === '"') state = STR;
      else if (c === '`') state = TPL;
    } else if (state === LINE) {
      if (c === '\n') { state = CODE; out += c; }
      continue;
    } else if (state === BLOCK) {
      if (c === '*' && next === '/') { state = CODE; i++; } else if (c === '\n') out += c;
      continue;
    } else if (c === '\\') {
      out += c + (next ?? '');
      i++;
      continue;
    } else if ((state === STR && (c === "'" || c === '"')) || (state === TPL && c === '`')) {
      state = CODE;
    }
    out += c;
  }
  return out;
}

function missingInAppDir(dir) {
  const SPECIFIER_RE = /\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g;
  const missing = new Set();
  for (const fname of readdirSync(dir)) {
    if (!/\.m?js$/.test(fname)) continue;
    let code = '';
    try { code = stripComments(readFileSync(join(dir, fname), 'utf8')); } catch { continue; }
    for (const match of code.matchAll(SPECIFIER_RE)) {
      const spec = match[1] || match[2];
      if (!existsSync(resolve(dir, spec))) missing.add(basename(spec));
    }
  }
  return [...missing].sort();
}

async function fetchSourceFile(file, sha) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${name}/${sha}/scripts/${file}`;
  const apiUrl = `https://api.github.com/repos/${owner}/${name}/contents/scripts/${file}?ref=${sha}`;
  let lastErr;
  for (const url of [rawUrl, apiUrl]) {
    try {
      const api = url === apiUrl;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: api
          ? { accept: 'application/vnd.github.raw', 'user-agent': 'beescad-updater' }
          : { 'user-agent': 'beescad-updater' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + url + ')');
      let text = await r.text();
      if (text.trimStart().startsWith('{')) {
        const j = JSON.parse(text);
        if (typeof j.content !== 'string') throw new Error('в ответе API нет содержимого файла');
        text = Buffer.from(j.content, j.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
      }
      if (!text.trim() || text.trimStart().startsWith('<')) throw new Error('в ответе не код модуля');
      return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function repairInstall() {
  let missing;
  try { missing = missingInAppDir(APP_DIR); } catch { return; }
  if (!missing.length) return;
  const sha = currentSha || latestSha;
  log('в установке не хватает файлов: ' + missing.join(', ') + ' — догружаю из GitHub');
  let fixed = 0;
  for (const fname of missing) {
    try {
      const text = await fetchSourceFile(fname, sha);
      const tmp = join(APP_DIR, fname + '.tmp');
      writeFileSync(tmp, text);
      renameSync(tmp, join(APP_DIR, fname));
      fixed++;
    } catch (e) {
      log('не удалось догрузить ' + fname + ': ' + (e?.message || e));
    }
  }
  if (fixed === missing.length) log('файлы установки восстановлены: ' + missing.join(', '));
  else log('восстановить всё не удалось — запустите установку заново: bash install-ubuntu.sh');
}

const CACHE = join(APP_DIR, '.update-cache');
mkdirSync(CACHE, { recursive: true });
const STATS_FILE = join(CACHE, 'stats.json');
const stats = (() => { try { return JSON.parse(readFileSync(STATS_FILE, 'utf8')); } catch { return {}; } })();
const saveStats = () => { try { writeFileSync(STATS_FILE, JSON.stringify(stats)); } catch { /* не важно */ } };

const LOCK = join(CACHE, 'lock');
try {
  const pid = Number(readFileSync(LOCK, 'utf8'));
  if (pid && pid !== process.pid) {
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* процесса нет */ }
    if (alive) { log('обновление уже выполняется (процесс ' + pid + ')'); process.exit(0); }
  }
} catch { /* нет блокировки */ }
writeFileSync(LOCK, String(process.pid));

let work = '';
let child = null;
const cleanup = () => {
  try { if (work) rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(LOCK, { force: true }); } catch { /* ignore */ }
};
const onSignal = () => {
  if (child) killTree(child);
  try { restoreModules(); } catch { /* ignore */ }
  cleanup();
  log('обновление отменено');
  process.exit(2);
};
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);

function killTree(ch) {
  if (!ch || ch.exitCode !== null) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-ch.pid, 'SIGTERM');
  } catch {
    try { ch.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

function run(cmd, argv, { cwd, env, timeout = 15 * 60_000, onLine } = {}) {
  return new Promise((resolveP) => {
    let out = '';
    const ch = spawn(cmd, argv, {
      cwd, env: { ...process.env, ...env }, windowsHide: true,
      detached: !IS_WIN, shell: IS_WIN && /^(npm|npx)$/.test(cmd),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = ch;
    const timer = setTimeout(() => { out += '\nпревышено время ожидания'; killTree(ch); }, timeout);
    const feed = (buf) => {
      const s = buf.toString();
      out = (out + s).slice(-20000);
      if (onLine) for (const l of s.split(/\r?\n|\r/)) if (l.trim()) onLine(l);
    };
    ch.stdout.on('data', feed);
    ch.stderr.on('data', feed);
    ch.on('error', (e) => { clearTimeout(timer); child = null; resolveP({ code: -1, out: String(e.message || e) }); });
    ch.on('close', (code) => { clearTimeout(timer); child = null; resolveP({ code: code ?? -1, out }); });
  });
}

const timeFrac = (elapsed, est) => {
  if (elapsed <= est) return 0.9 * (elapsed / est);
  return 0.9 + 0.09 * (1 - Math.exp(-(elapsed - est) / est));
};

async function lsRemote() {
  const r = await run('git', ['ls-remote', `https://github.com/${owner}/${name}.git`, `refs/heads/${branch}`], {
    timeout: 20_000, env: { GIT_TERMINAL_PROMPT: '0' },
  });
  const sha = (r.out.match(/^([0-9a-f]{40})\s+refs\/heads\//m) || [])[1];
  if (!sha) throw new Error('git ls-remote: ' + r.out.trim().split('\n')[0]);
  return sha;
}
async function apiCommit(ref) {
  const r = await fetch(`https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'beescad-updater' },
  });
  if (r.status === 404 || r.status === 422) return null;
  if (!r.ok) throw new Error('GitHub API HTTP ' + r.status);
  return r.json();
}

P({ stage: 'check', state: 'run', msg: 'Проверка версии на GitHub…' });
let latestSha = FORCED_SHA;
if (!latestSha) {
  try {
    latestSha = await Promise.any([
      lsRemote(),
      apiCommit(branch).then((c) => { if (!c?.sha) throw new Error('нет коммита'); return c.sha; }),
    ]);
  } catch (e) {
    log('нет связи с GitHub (' + (e?.errors?.[0]?.message || e?.message || e) + ') — остаёмся на текущей версии');
    cleanup();
    process.exit(0);
  }
  if (currentSha && currentSha === latestSha) {
    log('актуальная версия ' + short(currentSha) + ' — обновляться не нужно');
    await repairInstall();
    cleanup();
    process.exit(0);
  }
  if (currentSha) {
    try {
      const [cur, lat] = await Promise.all([apiCommit(currentSha), apiCommit(latestSha)]);
      const curDate = cur?.commit?.committer?.date || '';
      const latDate = lat?.commit?.committer?.date || '';
      if (!cur || (curDate && latDate && curDate >= latDate)) {
        log('установленная версия не старше ' + branch + ' — обновляться не нужно');
        await repairInstall();
        cleanup();
        process.exit(0);
      }
    } catch { /* API недоступен */ }
  }
}
P({ stage: 'check', state: 'done', msg: 'Новая версия: ' + short(latestSha) });
log('найдена новая версия: ' + short(latestSha) + (currentSha ? ' (текущая ' + short(currentSha) + ')' : ''));

work = join(CACHE, 'work-' + process.pid);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const d of readdirSync(CACHE)) {
  if (d.startsWith('work-') && d !== 'work-' + process.pid) rmSync(join(CACHE, d), { recursive: true, force: true });
}

function makeReporter() {
  const total = Number(stats.tarBytes) || 0;
  const t0 = Date.now();
  let last = 0;
  return {
    t0,
    report(bytes, hdrTotal = 0, force = false) {
      const now = Date.now();
      if (!force && now - last < 120) return;
      last = now;
      const tot = hdrTotal || total;
      const exact = !!hdrTotal;
      const speed = bytes / Math.max(0.001, (now - t0) / 1000);
      P({
        stage: 'download', state: 'run', bytes, total: tot, exact, speed,
        frac: tot ? Math.min(exact ? 1 : 0.97, bytes / tot) : null,
      });
    },
  };
}

async function downloadFetch(url, file) {
  const STALL_MS = 20_000;
  const ctl = new AbortController();
  let stallTimer;
  const bump = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => ctl.abort(new Error('нет данных ' + STALL_MS / 1000 + ' с')), STALL_MS);
  };
  bump();
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'beescad-updater' } });
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    const hdr = Number(r.headers.get('content-length')) || 0;
    const rep = makeReporter();
    const ws = createWriteStream(file);
    let bytes = 0;
    try {
      for await (const chunk of r.body) {
        bump();
        bytes += chunk.length;
        if (!ws.write(chunk)) await new Promise((res) => ws.once('drain', res));
        rep.report(bytes, hdr);
      }
    } finally {
      await new Promise((res) => ws.end(res));
    }
    return bytes;
  } catch (e) {
    const c = e?.cause;
    throw new Error((e?.message || String(e)) + (c ? ' (' + (c.code || c.message || c) + ')' : ''));
  } finally {
    clearTimeout(stallTimer);
  }
}

async function downloadCurl(url, file) {
  const rep = makeReporter();
  const iv = setInterval(() => {
    try { rep.report(statSync(file).size); } catch { /* файла ещё нет */ }
  }, 150);
  try {
    const r = await run('curl', [
      '-sS', '-L', '--fail', '--connect-timeout', '15',
      '--speed-limit', '1', '--speed-time', '20',
      '-A', 'beescad-updater', '-o', file, url,
    ], { timeout: 10 * 60_000 });
    if (r.code !== 0) throw new Error('curl: ' + (r.out.trim().split('\n').pop() || 'код ' + r.code));
    return statSync(file).size;
  } finally {
    clearInterval(iv);
  }
}

const curlOk = spawnSync('curl', ['--version'], { stdio: 'ignore', windowsHide: true }).status === 0;

async function download(url, file) {
  const t0 = Date.now();
  const ways = curlOk ? [downloadCurl, downloadFetch] : [downloadFetch];
  let lastErr;
  for (const way of ways) {
    try {
      rmSync(file, { force: true });
      const bytes = await way(url, file);
      if (!bytes) throw new Error('пустой архив');
      const secs = (Date.now() - t0) / 1000;
      P({ stage: 'download', state: 'done', bytes, total: bytes, exact: true, speed: bytes / Math.max(0.001, secs), frac: 1 });
      stats.tarBytes = bytes;
      return bytes;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const ball = join(work, 'src.tar.gz');
P({ stage: 'download', state: 'run', msg: 'Скачивание исходников…', frac: 0, bytes: 0, total: Number(stats.tarBytes) || 0 });
{
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await download(`https://codeload.github.com/${owner}/${name}/tar.gz/${latestSha}`, ball);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        P({ stage: 'download', state: 'run', msg: `Сбой загрузки (${e?.message || e}), попытка ${attempt + 1} из 3…`, frac: 0, bytes: 0 });
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  if (lastErr) {
    cleanup();
    fail('не удалось скачать обновление: ' + (lastErr?.message || lastErr));
  }
}

const src = join(work, 'src');
const cachedModules = join(CACHE, 'node_modules');
let modulesBorrowed = false;
function restoreModules() {
  const nm = join(src, 'node_modules');
  if (existsSync(nm)) {
    rmSync(cachedModules, { recursive: true, force: true });
    renameSync(nm, cachedModules);
  }
  modulesBorrowed = false;
}

try {
  P({ stage: 'extract', state: 'run', msg: 'Распаковка…', frac: null });
  mkdirSync(src);
  const ex = await run('tar', ['-xzf', ball, '--strip-components=1', '-C', src], { timeout: 120_000 });
  if (ex.code !== 0) throw new Error('tar: ' + ex.out.slice(0, 200));
  if (!existsSync(join(src, 'package.json'))) throw new Error('в архиве нет package.json');
  rmSync(ball, { force: true });
  P({ stage: 'extract', state: 'done', frac: 1 });

  const lockFile = existsSync(join(src, 'package-lock.json')) ? join(src, 'package-lock.json') : join(src, 'package.json');
  const lockText = readFileSync(lockFile, 'utf8');
  const lockHash = createHash('sha256').update(lockText).update(process.version).digest('hex');
  const hashFile = join(CACHE, 'node_modules.hash');
  const cachedHash = existsSync(hashFile) ? readFileSync(hashFile, 'utf8').trim() : '';

  if (cachedHash === lockHash && existsSync(join(cachedModules, '.package-lock.json'))) {
    renameSync(cachedModules, join(src, 'node_modules'));
    modulesBorrowed = true;
    P({ stage: 'deps', state: 'skip', msg: 'Зависимости не менялись — берём из кэша', frac: 1 });
    log('зависимости не менялись — взяты из кэша');
  } else {
    let pkgTotal = 0;
    try {
      const lock = JSON.parse(lockText);
      for (const [k, v] of Object.entries(lock.packages || {})) {
        if (!k || v.link) continue;
        if (v.optional) {
          if (v.os && !v.os.includes(process.platform)) continue;
          if (v.cpu && !v.cpu.includes(process.arch)) continue;
        }
        pkgTotal++;
      }
    } catch { /* без процента */ }
    rmSync(cachedModules, { recursive: true, force: true });
    rmSync(hashFile, { force: true });

    const est = Number(stats.depsMs) || 60_000;
    const t0 = Date.now();
    let fetched = 0;
    const tick = () => {
      const byTime = timeFrac(Date.now() - t0, est);
      const byCount = pkgTotal ? Math.min(1, fetched / pkgTotal) * 0.9 : 0;
      P({
        stage: 'deps', state: 'run', frac: Math.min(0.99, Math.max(byTime * 0.6, byCount + 0.09 * byTime)),
        msg: pkgTotal ? `Установка зависимостей: ${Math.min(fetched, pkgTotal)} из ${pkgTotal} пакетов` : 'Установка зависимостей…',
        count: fetched, countTotal: pkgTotal, est, elapsed: Date.now() - t0,
      });
    };
    tick();
    const iv = setInterval(tick, 300);
    const npmArgs = existsSync(join(src, 'package-lock.json'))
      ? ['ci', '--prefer-offline', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=http']
      : ['install', '--prefer-offline', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=http'];
    const ci = await run('npm', npmArgs, {
      cwd: src, timeout: 15 * 60_000,
      onLine: (l) => { if (/^npm http (fetch GET 200|cache)\b.*\.tgz/.test(l)) fetched++; },
    });
    clearInterval(iv);
    if (ci.code !== 0) {
      const errs = ci.out.split('\n').filter((l) => !/^npm http /.test(l)).join('\n').trim();
      throw new Error('npm: ' + errs.slice(-300));
    }
    stats.depsMs = Date.now() - t0;
    writeFileSync(hashFile, lockHash);
    modulesBorrowed = true;
    P({ stage: 'deps', state: 'done', frac: 1, msg: 'Зависимости установлены' });
  }

  {
    const est = Number(stats.buildMs) || 25_000;
    const t0 = Date.now();
    let modules = 0;
    let note = 'Сборка приложения…';
    const tick = () => P({
      stage: 'build', state: 'run', frac: timeFrac(Date.now() - t0, est), msg: note,
      est, elapsed: Date.now() - t0,
    });
    tick();
    const iv = setInterval(tick, 300);
    const viteBin = join(src, 'node_modules', 'vite', 'bin', 'vite.js');
    const onLine = (l) => {
      const mm = /(\d+)\s+modules? transformed/.exec(l);
      if (mm) { modules = Number(mm[1]); note = `Сборка: ${modules} модулей обработано, запись файлов…`; }
      else if (/rendering chunks/.test(l)) note = 'Сборка: формирование файлов…';
      else if (/transforming/.test(l)) note = 'Сборка: обработка модулей…';
    };
    const bd = existsSync(viteBin)
      ? await run(process.execPath, [viteBin, 'build', '--logLevel', 'info'], { cwd: src, onLine, env: { NO_COLOR: '1' } })
      : await run('npm', ['run', 'build', '--no-update-notifier'], { cwd: src, onLine });
    if (bd.code !== 0) { clearInterval(iv); throw new Error('сборка: ' + bd.out.slice(-300)); }
    const wv = await run(process.execPath, [join(src, 'scripts', 'write-version.mjs')], {
      cwd: src, env: { BEESCAD_BUILD_SHA: latestSha, BEESCAD_BUILD_BRANCH: branch, PSBEES_BUILD_SHA: latestSha, PSBEES_BUILD_BRANCH: branch },
    });
    clearInterval(iv);
    if (wv.code !== 0) throw new Error('write-version: ' + wv.out.slice(-200));
    if (!existsSync(join(src, 'dist', 'index.html'))) throw new Error('сборка не создала dist/index.html');
    try {
      const vf = join(src, 'dist', 'version.json');
      const v = existsSync(vf) ? JSON.parse(readFileSync(vf, 'utf8')) : {};
      if (v.sha !== latestSha) {
        writeFileSync(vf, JSON.stringify({ ...v, sha: latestSha, short: short(latestSha), branch }, null, 1) + '\n');
      }
    } catch { /* не критично */ }
    const pc = join(src, 'scripts', 'precompress.mjs');
    if (existsSync(pc)) {
      try { await run(process.execPath, [pc], { cwd: src }); } catch { /* не критично */ }
    }
    stats.buildMs = Date.now() - t0;
    P({ stage: 'build', state: 'done', frac: 1, msg: 'Сборка готова' });
  }

  P({ stage: 'install', state: 'run', frac: 0.2, msg: 'Установка новой версии…' });
  const staging = join(APP_DIR, '.install.tmp');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const rel of await runtimeFileList(src)) {
    const from = join(src, rel);
    if (existsSync(from)) cpSync(from, join(staging, basename(rel)));
  }
  const gaps = missingInAppDir(staging);
  if (gaps.length) throw new Error('новая версия неполная, не хватает модулей: ' + gaps.join(', '));
  const newDist = join(APP_DIR, 'dist.new');
  rmSync(newDist, { recursive: true, force: true });
  try { renameSync(join(src, 'dist'), newDist); } catch { cpSync(join(src, 'dist'), newDist, { recursive: true }); }
  rmSync(join(APP_DIR, 'dist.old'), { recursive: true, force: true });
  if (existsSync(join(APP_DIR, 'dist'))) renameSync(join(APP_DIR, 'dist'), join(APP_DIR, 'dist.old'));
  renameSync(newDist, join(APP_DIR, 'dist'));
  for (const f of readdirSync(staging)) cpSync(join(staging, f), join(APP_DIR, f));
  rmSync(staging, { recursive: true, force: true });
  writeFileSync(join(APP_DIR, 'version.txt'), latestSha + '\n');
  try {
    writeFileSync(join(APP_DIR, 'update.log'),
      new Date().toISOString() + ' обновлено до ' + short(latestSha) + ' (' + branch + ')\n');
  } catch { /* не важно */ }
  if (modulesBorrowed) restoreModules();
  saveStats();
  P({ stage: 'install', state: 'done', frac: 1, msg: 'Готово' });
  log('готово: установлена версия ' + short(latestSha));
  cleanup();
  process.exit(10);
} catch (e) {
  try { if (modulesBorrowed) restoreModules(); } catch { /* ignore */ }
  try { rmSync(join(APP_DIR, '.install.tmp'), { recursive: true, force: true }); } catch { /* ignore */ }
  saveStats();
  log('обновление не удалось, остаёмся на текущей версии (' + (e?.message || e) + ')');
  cleanup();
  process.exit(1);
}
