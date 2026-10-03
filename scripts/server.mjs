#!/usr/bin/env node
// Лёгкий статический сервер для BeesCAD (без внешних зависимостей).
// Использование: node server.mjs [порт] [корень] — по умолчанию 8080 и ./dist рядом.
// Ключи:
//   --self                    — сервер запущен из клона репозитория (dev/песочница);
//   --app-dir <dir>           — установленная программа (каталог с dist/, repo.txt, update.mjs);
//   --host <addr>             — интерфейс: 127.0.0.1 (по умолчанию) или 0.0.0.0,
//                               если сайт нужно открыть с другого устройства
//                               (второй компьютер, телефон, песочница/превью).
//                               Эндпоинты /update/* при этом остаются только для loopback.
// Также: import { startServer } from './server.mjs' (локальный лаунчер и тесты).
//
// Кнопка «Обновить с main» (HTTP):
//   GET  /update/check  — сверить установленную версию с веткой main на GitHub;
//   POST /update/run    — обновить (git fetch+merge+npm ci+build либо scripts/update.mjs);
//   GET  /update/status — ход выполнения: этапы, проценты, байты, скорость, ETA;
//                         ?since=<rev> — long-poll: ответ приходит сразу при изменении;
//   POST /update/cancel — отменить обновление (текущая версия остаётся).
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_REPO = 'https://github.com/danilka-revin/BeesCAD.git';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.stl': 'model/stl',
  '.obj': 'text/plain; charset=utf-8',
  '.step': 'text/plain; charset=utf-8',
  '.stp': 'text/plain; charset=utf-8',
};

async function pickRoot() {
  for (const p of [join(process.cwd(), 'dist'), join(here, 'dist'), join(here, '..', 'dist')]) {
    try {
      if ((await stat(p)).isDirectory()) return p;
    } catch { /* нет */ }
  }
  return join(here, 'dist');
}

function samePath(a, b) {
  const na = resolve(a), nb = resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function listen(server, port, host) {
  return new Promise((resolveP, reject) => {
    const onErr = (e) => reject(e);
    server.once('error', onErr);
    server.listen(port, host, () => {
      server.off('error', onErr);
      resolveP();
    });
  });
}

const IS_WIN = process.platform === 'win32';
const QUIET_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: IS_WIN ? '' : 'echo', NO_COLOR: '1', FORCE_COLOR: '0' };

const execFileP = (cmd, args, opts = {}) => new Promise((resolveP) => {
  execFile(cmd, args, {
    ...opts,
    env: { ...process.env, ...QUIET_ENV, ...(opts.env || {}) },
    timeout: opts.timeout ?? 60000,
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
    windowsHide: true,
    shell: IS_WIN && /^(npm|npx)$/.test(cmd),
  }, (err, stdout, stderr) => {
    resolveP({ err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
  });
});

function killTree(ch, sig = 'SIGTERM') {
  if (!ch || ch.exitCode !== null || ch.signalCode) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(ch.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-ch.pid, sig);
  } catch {
    try { ch.kill(sig); } catch { /* уже завершён */ }
  }
}

function spawnP(cmd, args, { cwd, env, timeout = 15 * 60_000, onLine, onSpawn } = {}) {
  return new Promise((resolveP) => {
    let out = '';
    let timedOut = false;
    let ch;
    try {
      ch = spawn(cmd, args, {
        cwd, env: { ...process.env, ...QUIET_ENV, ...(env || {}) },
        windowsHide: true, detached: !IS_WIN,
        shell: IS_WIN && /^(npm|npx)$/.test(cmd),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolveP({ code: -1, out: String(e?.message || e) });
      return;
    }
    onSpawn?.(ch);
    const timer = setTimeout(() => { timedOut = true; killTree(ch); }, timeout);
    let partial = '';
    const feed = (buf) => {
      const s = buf.toString();
      out = (out + s).slice(-40000);
      if (!onLine) return;
      const parts = (partial + s).split(/\r?\n|\r/);
      partial = parts.pop() || '';
      for (const l of parts) if (l.trim()) onLine(l);
    };
    ch.stdout.on('data', feed);
    ch.stderr.on('data', feed);
    ch.on('error', (e) => { clearTimeout(timer); resolveP({ code: -1, out: String(e?.message || e) }); });
    ch.on('close', (code, signal) => {
      clearTimeout(timer);
      if (partial.trim() && onLine) onLine(partial);
      resolveP({ code: code ?? -1, signal, out: timedOut ? out + '\nпревышено время ожидания' : out });
    });
  });
}

const hasCmdCache = new Map();
const hasCmd = (c) => {
  if (!hasCmdCache.has(c)) {
    hasCmdCache.set(c, execFileP(c, ['--version'], { timeout: 15000 }).then(({ err }) => !err));
  }
  return hasCmdCache.get(c);
};

async function gitP(args, opts = {}) {
  const r = await execFileP('git', args, opts);
  if (r.err) throw new Error((r.stderr || r.err.message || 'ошибка git').trim());
  return r.stdout.trim();
}

const short = (s) => String(s || '').slice(0, 7);
const isSha = (s) => /^[0-9a-f]{40}$/i.test(String(s || ''));

// Loopback-адрес клиента или нет. /update/* выполняет git pull + npm ci + сборку +
// перезапуск, поэтому эти эндпоинты доступны только с самого компьютера — даже если
// сам сайт намеренно открыт наружу (--host 0.0.0.0).
function isLoopbackAddr(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '').trim();
  if (!a) return true;
  if (a.toLowerCase().startsWith('::ffff:')) return isLoopbackAddr(a.slice(7));
  return a === '::1' || a === '127.0.0.1' || a.startsWith('127.');
}

const firstLine = (err, max = 260) => (String(err || '').trim().split('\n')[0] || '').slice(0, max);
const lastLines = (s, n = 4, max = 400) => String(s || '').trim().split('\n').filter(Boolean).slice(-n).join('\n').slice(-max);

function json(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function repoInfo(repoUrl) {
  const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repoUrl || '');
  if (!m) return null;
  return { owner: m[1], name: m[2], url: `https://github.com/${m[1]}/${m[2]}.git` };
}

async function githubJson(url, timeout = 10000) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'beescad-cad' },
    });
    if (!r.ok) throw Object.assign(new Error('GitHub HTTP ' + r.status), { http: true });
    return await r.json();
  } catch (e) {
    if (e?.http) throw e;
    const c = await execFileP('curl', ['-sS', '-L', '--fail', '-m', String(Math.ceil(timeout / 1000)),
      '-H', 'accept: application/vnd.github+json', '-A', 'beescad-cad', url], { timeout: timeout + 2000 });
    if (c.err) throw new Error('GitHub: ' + (e?.cause?.code || e?.message || e));
    return JSON.parse(c.stdout);
  }
}

let systemCaFlag = null;
const nodeCaArgs = async () => {
  if (systemCaFlag === null) {
    const r = await execFileP(process.execPath, ['--use-system-ca', '-e', '0'], { timeout: 10000 });
    systemCaFlag = !r.err;
  }
  return systemCaFlag ? ['--use-system-ca'] : [];
};

async function discoverRepo(appHome) {
  try {
    const u = await gitP(['remote', 'get-url', 'origin'], { cwd: appHome, timeout: 10000 });
    if (u) return u;
  } catch { /* нет remote/не git */ }
  try {
    const s = (await readFile(join(appHome, 'repo.txt'), 'utf8')).trim();
    if (s) return s;
  } catch { /* нет файла */ }
  return DEFAULT_REPO;
}

async function versionFromRoot(root) {
  try {
    const v = JSON.parse(await readFile(join(root, 'version.json'), 'utf8'));
    return { sha: String(v.sha || ''), short: String(v.short || short(v.sha)) };
  } catch {
    return { sha: '', short: '' };
  }
}

const STAGES = {
  install: [
    ['check', 'Проверка версии', 3],
    ['download', 'Скачивание', 20],
    ['extract', 'Распаковка', 3],
    ['deps', 'Зависимости', 36],
    ['build', 'Сборка', 33],
    ['install', 'Установка', 5],
  ],
  clone: [
    ['check', 'Проверка версии', 3],
    ['download', 'Скачивание (git fetch)', 20],
    ['extract', 'Применение изменений', 3],
    ['deps', 'Зависимости', 36],
    ['build', 'Сборка', 33],
    ['install', 'Установка', 5],
  ],
};

const timeFrac = (elapsed, est) => (elapsed <= est
  ? 0.9 * (elapsed / est)
  : 0.9 + 0.09 * (1 - Math.exp(-(elapsed - est) / est)));

function lockPackageCount(lockText) {
  try {
    const lock = JSON.parse(lockText);
    let n = 0;
    for (const [k, v] of Object.entries(lock.packages || {})) {
      if (!k || v.link) continue;
      if (v.optional) {
        if (v.os && !v.os.includes(process.platform)) continue;
        if (v.cpu && !v.cpu.includes(process.arch)) continue;
      }
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}

export async function startServer(opts = {}) {
  const argv = process.argv.slice(2);
  const cli = { port: null, root: null, appDir: null, host: null, self: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app-dir' || a === '--appdir') { cli.appDir = argv[++i]; continue; }
    if (a === '--host') { cli.host = argv[++i]; continue; }
    if (a === '--self') { cli.self = true; continue; }
    if (/^\d+$/.test(a)) { cli.port = a; continue; }
    cli.root = a;
  }

  const rawPort = opts.port ?? cli.port ?? process.env.PORT ?? 8080;
  const preferred = Number(rawPort);
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535) {
    throw new Error(`Некорректный порт «${rawPort}»: укажите число от 0 до 65535.`);
  }
  // По умолчанию слушаем только loopback. HOST=0.0.0.0 (или --host 0.0.0.0) открывает
  // сайт другим устройствам в сети — это нужно для превью/второго компьютера, но
  // тогда привилегированные эндпоинты /update/* остаются доступны лишь с loopback.
  const HOST = opts.host || cli.host || process.env.HOST || '127.0.0.1';
  const ROOT = resolve(opts.root || cli.root || process.env.WWW_ROOT || (await pickRoot()));
  const fallback = opts.fallbackPorts ?? 0;
  const explicitAppDir = opts.appDir || cli.appDir;
  const APP_DIR = explicitAppDir ? resolve(explicitAppDir) : (opts.self || cli.self ? resolve(join(here, '..')) : resolve(ROOT, '..'));
  const IS_SELF = (!!opts.self || cli.self) && !explicitAppDir;
  const STATS_FILE = join(APP_DIR, IS_SELF || !explicitAppDir ? 'node_modules/.cache/beescad-update.json' : '.update-cache/stats.json');

  const isGitClone = async () => {
    try { await stat(join(APP_DIR, '.git')); } catch { return false; }
    const t = await execFileP('git', ['-C', APP_DIR, 'rev-parse', '--is-inside-work-tree'], { timeout: 10000 });
    return !t.err;
  };
  const hasUpdateScript = async () => {
    try { await stat(join(APP_DIR, 'update.mjs')); return true; } catch { return false; }
  };

  const appBranch = async () => {
    try {
      const s = (await readFile(join(APP_DIR, 'branch.txt'), 'utf8')).trim();
      if (s) return s;
    } catch { /* нет файла */ }
    return 'main';
  };

  const localVersion = async () => {
    const v = await versionFromRoot(ROOT);
    if (isSha(v.sha)) return v;
    try {
      const s = (await readFile(join(APP_DIR, 'version.txt'), 'utf8')).trim();
      if (isSha(s)) return { sha: s, short: short(s) };
    } catch { /* нет */ }
    if (await isGitClone()) {
      const h = await execFileP('git', ['rev-parse', 'HEAD'], { cwd: APP_DIR, timeout: 10000 });
      if (!h.err && isSha(h.stdout.trim())) return { sha: h.stdout.trim(), short: short(h.stdout.trim()) };
    }
    return v;
  };

  let lastLatest = null;
  const latestOfBranch = async (branch) => {
    const repo = repoInfo(await discoverRepo(APP_DIR));
    if (!repo) throw new Error('Не удалось определить репозиторий GitHub (нет repo.txt и git remote).');
    const viaGit = (async () => {
      const ls = await execFileP('git', ['ls-remote', repo.url, `refs/heads/${branch}`], { timeout: 20000 });
      if (ls.err) throw new Error('git: ' + firstLine(ls.stderr || ls.err.message, 180));
      const sha = (ls.stdout.match(/^([0-9a-f]{40})\s+refs\/heads\//m) || [])[1];
      if (!sha) throw new Error('GitHub не вернул коммит ветки ' + branch + '.');
      return { sha };
    })();
    const viaApi = githubJson(`https://api.github.com/repos/${repo.owner}/${repo.name}/commits/${encodeURIComponent(branch)}`)
      .then((c) => {
        if (!isSha(c.sha)) throw new Error('API: нет коммита');
        return { sha: c.sha, date: c.commit?.committer?.date || '', msg: (c.commit?.message || '').split('\n')[0] };
      });
    let first;
    try {
      first = await Promise.any([viaGit, viaApi]);
    } catch (e) {
      const why = (e?.errors || []).map((x) => x?.message).filter(Boolean).join('; ');
      throw new Error('Не удалось связаться с GitHub' + (why ? ': ' + why : '') + '.');
    }
    let meta = first.msg !== undefined ? first : null;
    if (!meta) {
      meta = await Promise.race([
        viaApi.catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 3000)),
      ]);
      if (meta && meta.sha !== first.sha) meta = null;
    }
    viaGit.catch(() => {});
    viaApi.catch(() => {});
    lastLatest = { sha: first.sha, at: Date.now() };
    return { sha: first.sha, msg: meta?.msg || '', date: meta?.date || '', repo: `${repo.owner}/${repo.name}` };
  };

  const CHECK_TTL_MS = 60_000;
  let checkCache = null;
  const dropCheckCache = () => { checkCache = null; };

  const checkUpdate = async (res, force = false) => {
    if (!force && checkCache && Date.now() - checkCache.at < CHECK_TTL_MS) {
      return json(res, 200, { ...checkCache.body, cached: true });
    }
    try {
      const branch = await appBranch();
      const [gitOk, npmOk, local, latest, clone] = await Promise.all([
        hasCmd('git'), hasCmd('npm'), localVersion(), latestOfBranch(branch), isGitClone(),
      ]);

      let behind = 0;
      if (!local.sha || local.sha !== latest.sha) {
        behind = 1;
        if (local.sha && gitOk && clone) {
          const count = await execFileP('git', ['rev-list', '--count', `${local.sha}..${latest.sha}`], { cwd: APP_DIR, timeout: 15000 });
          if (!count.err && Number.isFinite(Number(count.stdout.trim()))) {
            behind = Number(count.stdout.trim());
          }
        }
      }

      const body = {
        ok: true,
        repo: latest.repo,
        branch,
        local: short(local.sha),
        latest: short(latest.sha),
        latestSha: latest.sha,
        latestMsg: latest.msg,
        latestDate: latest.date,
        behind,
        updateAvailable: behind > 0,
        mode: clone ? 'clone' : 'install',
        tooling: { git: clone ? gitOk : true, npm: npmOk },
        cached: false,
      };
      checkCache = { at: Date.now(), body };
      return json(res, 200, body);
    } catch (e) {
      return json(res, 502, { ok: false, error: e && e.message ? e.message : String(e) });
    }
  };

  const freshState = () => ({
    status: 'idle', phase: '', started: null, done: null,
    from: '', to: '', changes: 0, output: '', error: '',
    mode: '', stages: [], stage: '', pct: 0, bytes: 0, total: 0, exact: false,
    speed: 0, eta: null, elapsed: 0, count: 0, countTotal: 0, cancelable: false,
    restart: false, rev: 0,
  });
  const upd = { state: freshState(), child: null, cancelled: false, waiters: new Set() };
  const bump = () => {
    upd.state.rev++;
    for (const w of upd.waiters) w();
    upd.waiters.clear();
  };
  const setState = (patch) => { Object.assign(upd.state, patch); bump(); };

  const recompute = () => {
    const st = upd.state;
    let sum = 0, got = 0;
    for (const s of st.stages) {
      sum += s.weight;
      if (s.state === 'done' || s.state === 'skip') got += s.weight;
      else if (s.state === 'run') got += s.weight * (s.frac ?? 0);
    }
    const pct = sum ? Math.max(st.pct, Math.min(1, got / sum)) : 0;
    const elapsed = st.started ? Date.now() - Date.parse(st.started) : 0;
    let eta = null;
    if (pct > 0.04 && pct < 1) {
      const raw = (elapsed * (1 - pct)) / pct;
      eta = st.eta == null ? raw : st.eta * 0.7 + raw * 0.3;
    }
    st.pct = pct;
    st.elapsed = elapsed;
    st.eta = pct >= 1 ? 0 : eta;
  };

  const stageUpdate = (id, patch) => {
    const st = upd.state;
    const s = st.stages.find((x) => x.id === id);
    if (!s) return;
    if (patch.state === 'run' || patch.state === 'done' || patch.state === 'skip') {
      for (const o of st.stages) {
        if (o === s) break;
        if (o.state === 'wait' || o.state === 'run') { o.state = 'done'; o.frac = 1; }
      }
    }
    if (patch.state) s.state = patch.state;
    if (patch.frac !== undefined && patch.frac !== null) s.frac = Math.max(0, Math.min(1, patch.frac));
    if (patch.state === 'done' || patch.state === 'skip') s.frac = 1;
    if (patch.msg) {
      s.msg = patch.msg;
      st.phase = patch.msg;
    }
    st.stage = id;
    if (id === 'download') {
      for (const k of ['bytes', 'total', 'exact', 'speed']) if (patch[k] !== undefined) st[k] = patch[k];
    }
    if (patch.count !== undefined) st.count = patch.count;
    if (patch.countTotal !== undefined) st.countTotal = patch.countTotal;
    st.cancelable = !['extract', 'install'].includes(id) || s.state === 'done';
    recompute();
    bump();
  };

  const log = (s) => {
    upd.state.output = (upd.state.output + (upd.state.output ? '\n' : '') + s).split('\n').slice(-200).join('\n');
    upd.state.phase = s;
    bump();
  };

  const loadStats = async () => { try { return JSON.parse(await readFile(STATS_FILE, 'utf8')); } catch { return {}; } };
  const saveStats = async (s) => {
    try {
      await mkdir(dirname(STATS_FILE), { recursive: true });
      await writeFile(STATS_FILE, JSON.stringify(s));
    } catch { /* не важно */ }
  };

  const track = (ch) => { upd.child = ch; };
  const checkCancelled = () => { if (upd.cancelled) throw Object.assign(new Error('Обновление отменено.'), { cancelled: true }); };

  const npmCi = async (cwd, stats) => {
    const lockText = await readFile(join(cwd, 'package-lock.json'), 'utf8').catch(() => '');
    const total = lockPackageCount(lockText);
    const est = Number(stats.depsMs) || 60_000;
    const t0 = Date.now();
    let fetched = 0;
    const tick = () => {
      const byTime = timeFrac(Date.now() - t0, est);
      const byCount = total ? Math.min(1, fetched / total) * 0.9 : 0;
      stageUpdate('deps', {
        state: 'run', frac: Math.min(0.99, Math.max(byTime * 0.6, byCount + 0.09 * byTime)),
        msg: total ? `Установка зависимостей: ${Math.min(fetched, total)} из ${total} пакетов` : 'Установка зависимостей…',
        count: Math.min(fetched, total), countTotal: total,
      });
    };
    tick();
    const iv = setInterval(tick, 300);
    const r = await spawnP('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=http'], {
      cwd, onSpawn: track,
      onLine: (l) => { if (/^npm http (fetch GET 200|cache)\b.*\.tgz/.test(l)) fetched++; },
    });
    clearInterval(iv);
    upd.child = null;
    checkCancelled();
    if (r.code !== 0) {
      const errs = r.out.split('\n').filter((l) => !/^npm http /.test(l)).join('\n');
      throw new Error('npm ci: ' + lastLines(errs, 4, 400));
    }
    stats.depsMs = Date.now() - t0;
    stageUpdate('deps', { state: 'done', msg: 'Зависимости установлены', count: total, countTotal: total });
  };

  const viteBuild = async (cwd, outRel, stats, extraEnv = {}) => {
    const est = Number(stats.buildMs) || 25_000;
    const t0 = Date.now();
    let note = 'Сборка приложения…';
    const tick = () => stageUpdate('build', { state: 'run', frac: timeFrac(Date.now() - t0, est), msg: note });
    tick();
    const iv = setInterval(tick, 300);
    const onLine = (l) => {
      const mm = /(\d+)\s+modules? transformed/.exec(l);
      if (mm) note = `Сборка: ${mm[1]} модулей обработано, запись файлов…`;
      else if (/rendering chunks/.test(l)) note = 'Сборка: формирование файлов…';
      else if (/transforming/.test(l)) note = 'Сборка: обработка модулей…';
    };
    const viteBin = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
    let bd;
    try {
      await stat(viteBin);
      bd = await spawnP(process.execPath, [viteBin, 'build', '--outDir', outRel, '--emptyOutDir', '--logLevel', 'info'], { cwd, onLine, onSpawn: track });
    } catch {
      bd = await spawnP('npx', ['vite', 'build', '--outDir', outRel, '--emptyOutDir'], { cwd, onLine, onSpawn: track });
    }
    upd.child = null;
    checkCancelled();
    if (bd.code !== 0) { clearInterval(iv); throw new Error('Сборка не удалась: ' + lastLines(bd.out, 4, 400)); }
    const wv = await spawnP(process.execPath, [join(cwd, 'scripts', 'write-version.mjs'), outRel], { cwd, env: extraEnv });
    clearInterval(iv);
    if (wv.code !== 0) throw new Error('write-version: ' + lastLines(wv.out, 2, 200));
    const pc = join(cwd, 'scripts', 'precompress.mjs');
    try {
      await stat(pc);
      await spawnP(process.execPath, [pc, outRel], { cwd });
    } catch { /* не критично */ }
    stats.buildMs = Date.now() - t0;
    stageUpdate('build', { state: 'done', msg: 'Сборка готова' });
  };

  const swapDist = async (fromDir) => {
    const cur = ROOT;
    const old = ROOT + '.old';
    await rm(old, { recursive: true, force: true });
    try { await rename(cur, old); } catch { /* dist не было */ }
    try {
      await rename(fromDir, cur);
    } catch (e) {
      try { await rename(old, cur); } catch { /* ignore */ }
      throw e;
    }
  };

  const runUpdate = async (res) => {
    if (upd.state.status === 'busy') return json(res, 409, { ok: false, error: 'Обновление уже выполняется. Подождите.', ...upd.state });
    dropCheckCache();
    const clone = await isGitClone();
    const mode = clone ? 'clone' : 'install';
    const local = await localVersion();
    upd.cancelled = false;
    upd.state = {
      ...freshState(), rev: upd.state.rev + 1,
      status: 'busy', started: new Date().toISOString(), mode,
      from: short(local.sha), phase: 'Подготовка…', cancelable: true,
      stages: STAGES[mode].map(([id, label, weight]) => ({ id, label, weight, state: 'wait', frac: 0, msg: '' })),
    };
    bump();

    const finish = (patch) => {
      dropCheckCache();
      const st = upd.state;
      if (patch.status === 'error' || patch.status === 'cancelled') {
        for (const s of st.stages) if (s.state === 'run') s.state = patch.status === 'error' ? 'error' : 'wait';
      } else if (patch.status === 'done') {
        for (const s of st.stages) if (s.state !== 'skip') { s.state = 'done'; s.frac = 1; }
        st.pct = 1;
      }
      upd.child = null;
      setState({ done: new Date().toISOString(), cancelable: false, eta: patch.status === 'done' ? 0 : null, ...patch });
    };

    (async () => {
      const stats = await loadStats();
      try {
        if (!(await hasCmd('npm'))) throw new Error('На этом компьютере не найден npm — установите Node.js и повторите.');
        let newSha = '';
        let changes = 0;

        if (clone) {
          if (!(await hasCmd('git'))) throw new Error('Не найден git — установите его (sudo apt install git) и повторите.');
          const branch = await appBranch();
          stageUpdate('check', { state: 'run', msg: 'Проверка рабочей копии…' });
          const stR = await execFileP('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: APP_DIR, timeout: 20000 });
          if (stR.stdout.trim()) throw new Error('В рабочей копии есть незакоммиченные изменения. Сохраните их (git stash) или обновитесь командой git pull.');
          const head = await gitP(['rev-parse', 'HEAD'], { cwd: APP_DIR });
          stageUpdate('check', { state: 'done' });

          stageUpdate('download', { state: 'run', frac: 0, msg: `Скачивание изменений (git fetch origin ${branch})…` });
          const unit = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, bytes: 1 };
          const fr = await spawnP('git', ['fetch', '--progress', '--no-tags', '--no-recurse-submodules', 'origin', branch], {
            cwd: APP_DIR, timeout: 10 * 60_000, onSpawn: track,
            onLine: (l) => {
              const mm = /^(?:remote: )?(Counting|Compressing|Receiving|Resolving)[^:]*:\s+(\d+)%/.exec(l);
              if (!mm) return;
              const p = Number(mm[2]) / 100;
              const [a, b] = { Counting: [0, 0.05], Compressing: [0.05, 0.1], Receiving: [0.1, 0.92], Resolving: [0.92, 1] }[mm[1]];
              const patch = { state: 'run', frac: a + (b - a) * p };
              const sz = /,\s+([\d.]+)\s+(KiB|MiB|GiB|bytes)(?:\s+\|\s+([\d.]+)\s+(KiB|MiB|GiB|bytes)\/s)?/.exec(l);
              if (sz) {
                patch.bytes = Number(sz[1]) * unit[sz[2]];
                if (sz[3]) patch.speed = Number(sz[3]) * unit[sz[4]];
              }
              patch.msg = mm[1] === 'Receiving' ? 'Скачивание объектов…' : mm[1] === 'Resolving' ? 'Обработка изменений…' : 'Подготовка на сервере GitHub…';
              stageUpdate('download', patch);
            },
          });
          upd.child = null;
          checkCancelled();
          if (fr.code !== 0) throw new Error('Не удалось скачать обновления: ' + lastLines(fr.out.replace(/\r/g, '\n'), 2, 240));
          const remote = await gitP(['rev-parse', 'FETCH_HEAD'], { cwd: APP_DIR });
          stageUpdate('download', { state: 'done', msg: 'Изменения скачаны' });

          const countR = await execFileP('git', ['rev-list', '--count', `HEAD..${remote}`], { cwd: APP_DIR });
          changes = countR.err ? 0 : (Number(countR.stdout.trim()) || 0);
          if (head === remote || changes === 0) {
            return finish({ status: 'done', to: short(head), changes: 0, phase: `Уже актуальная версия — новых коммитов в ${branch} нет.` });
          }

          stageUpdate('extract', { state: 'run', frac: 0.3, msg: `Применяем ${changes} нов. коммит(ов)…` });
          const lockChanged = (await execFileP('git', ['diff', '--quiet', head, remote, '--', 'package-lock.json'], { cwd: APP_DIR })).err;
          const mg = await execFileP('git', ['merge', '--ff-only', '--no-edit', remote], { cwd: APP_DIR, timeout: 60000 });
          if (mg.err) throw new Error('Не удалось применить обновление (локальная ветка не из main или впереди неё): ' + firstLine(mg.stderr, 200));
          stageUpdate('extract', { state: 'done', msg: 'Изменения применены' });

          let modulesOk = false;
          try { await stat(join(APP_DIR, 'node_modules', '.package-lock.json')); modulesOk = true; } catch { /* нет */ }
          if (!lockChanged && modulesOk) {
            stageUpdate('deps', { state: 'skip', msg: 'Зависимости не менялись — пропускаем npm ci' });
          } else {
            await npmCi(APP_DIR, stats);
          }
          checkCancelled();

          await viteBuild(APP_DIR, 'dist.new', stats);
          stageUpdate('install', { state: 'run', frac: 0.5, msg: 'Установка новой версии…' });
          await swapDist(join(APP_DIR, 'dist.new'));
          newSha = remote;
        } else if (await hasUpdateScript()) {
          const updArgs = [...(await nodeCaArgs()), join(APP_DIR, 'update.mjs'), '--app-dir', APP_DIR, '--progress'];
          if (lastLatest && Date.now() - lastLatest.at < 10 * 60_000) updArgs.push('--sha', lastLatest.sha);
          const r = await spawnP(process.execPath, updArgs, {
            cwd: APP_DIR, timeout: 30 * 60_000, onSpawn: track,
            onLine: (l) => {
              if (l.startsWith('@@P ')) {
                try {
                  const p = JSON.parse(l.slice(4));
                  stageUpdate(p.stage, p);
                } catch { /* битая строка */ }
              } else {
                log(l.replace(/^автообновление:\s*/, ''));
              }
            },
          });
          upd.child = null;
          checkCancelled();
          if (r.code === 2) throw Object.assign(new Error('Обновление отменено.'), { cancelled: true });
          if (r.code === 0) {
            return finish({ status: 'done', to: local.short, changes: 0, phase: lastLines(r.out.replace(/@@P .*\n?/g, ''), 1, 200).replace(/^автообновление:\s*/, '') || 'Актуальная версия — обновлений нет.' });
          }
          if (r.code !== 10) {
            const msg = lastLines(r.out.replace(/@@P .*\n?/g, ''), 3, 400) || 'ошибка обновления';
            throw new Error(msg.replace(/автообновление:\s*/g, ''));
          }
          newSha = await readFile(join(APP_DIR, 'version.txt'), 'utf8').then((s) => s.trim()).catch(() => '');
          changes = 1;
        } else {
          throw new Error('Не удалось определить способ обновления: каталог программы не клон git и нет update.mjs. Обновитесь вручную: git pull && bash install-ubuntu.sh');
        }

        if (clone) await saveStats(stats);
        finish({
          status: 'done', from: short(local.sha), to: short(newSha), changes, restart: !IS_SELF,
          phase: IS_SELF
            ? 'Обновление установлено. Перезагрузите страницу.'
            : 'Обновление установлено. Перезапускаем программу…',
        });

        if (IS_SELF) return;
        setTimeout(restartSelf, 600);
      } catch (e) {
        if (clone) await saveStats(stats);
        if (e?.cancelled || upd.cancelled) {
          await rm(join(APP_DIR, 'dist.new'), { recursive: true, force: true }).catch(() => {});
          return finish({ status: 'cancelled', phase: 'Обновление отменено — работаем на текущей версии.' });
        }
        finish({ status: 'error', error: e && e.message ? e.message : String(e), phase: 'Обновление не удалось — работаем на текущей версии.' });
      }
    })();

    return json(res, 202, { ok: true, ...upd.state });
  };

  const cancelUpdate = (res) => {
    if (upd.state.status !== 'busy') return json(res, 409, { ok: false, error: 'Обновление не выполняется.' });
    if (!upd.state.cancelable) return json(res, 409, { ok: false, error: 'Сейчас отменить нельзя: идёт замена файлов, осталось несколько секунд.' });
    upd.cancelled = true;
    killTree(upd.child);
    setState({ phase: 'Отмена…', cancelable: false });
    return json(res, 200, { ok: true });
  };

  const statusUpdate = (req, res, url) => {
    const since = Number(url.searchParams.get('since'));
    if (!Number.isFinite(since) || url.searchParams.get('since') === null || upd.state.rev !== since) {
      if (upd.state.status === 'busy') recompute();
      return json(res, 200, upd.state);
    }
    let done = false;
    const reply = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      upd.waiters.delete(reply);
      if (upd.state.status === 'busy') recompute();
      json(res, 200, upd.state);
    };
    const t = setTimeout(reply, 25000);
    upd.waiters.add(reply);
    req.on('close', () => { if (!done) { done = true; clearTimeout(t); upd.waiters.delete(reply); } });
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end('{"ok":true}');
        return;
      }
      if (url.pathname === '/version') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        try {
          const v = JSON.parse(await readFile(join(ROOT, 'version.json')));
          res.end(JSON.stringify({ ok: true, ...v }));
        } catch {
          res.end('{"ok":true,"sha":"dev"}');
        }
        return;
      }

      if (url.pathname.startsWith('/update/')) {
        if (!isLoopbackAddr(req.socket && req.socket.remoteAddress)) {
          return json(res, 403, {
            ok: false,
            error: 'Обновление доступно только с этого компьютера (127.0.0.1). Откройте BeesCAD локально или обновите его в терминале.',
          });
        }
        const cmd = url.pathname.slice('/update/'.length);
        if (cmd === 'status') return statusUpdate(req, res, url);
        if (cmd === 'check') return await checkUpdate(res, url.searchParams.get('force') === '1');
        if (cmd === 'run') return await runUpdate(res);
        if (cmd === 'cancel') return cancelUpdate(res);
        return json(res, 404, { ok: false, error: 'неизвестная команда обновления' });
      }

      let decodedPath;
      try { decodedPath = decodeURIComponent(url.pathname); }
      catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request');
        return;
      }
      let path = normalize(decodedPath).replace(/^([/\\])+/, '');
      if (!path || path.endsWith('/')) path = join(path, 'index.html');
      const full = join(ROOT, path);
      const staticRel = relative(ROOT, full);
      if (staticRel === '..' || staticRel.startsWith('..' + sep) || isAbsolute(staticRel)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let data, type = MIME[extname(full).toLowerCase()];
      let hashed = false;
      let mtimeMs = 0;
      try {
        mtimeMs = (await stat(full)).mtimeMs;
        data = await readFile(full);
        hashed = /(^|[/\\])assets[/\\]/.test(path);
      } catch (e) {
        if (extname(path) || path.startsWith('assets/')) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('not found');
          return;
        }
        try { data = await readFile(join(ROOT, 'index.html')); }
        catch { throw e; }
        type = 'text/html; charset=utf-8';
      }
      const fileHeaders = {
        'content-type': type || 'application/octet-stream',
        'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      };
      const accept = String(req.headers['accept-encoding'] || '');
      const packedExt = /\bbr\b/.test(accept) ? '.br' : /\bgzip\b/.test(accept) ? '.gz' : '';
      let body = data;
      let encoding = '';
      if (packedExt) {
        try {
          const packed = await readFile(full + packedExt);
          if (packed.length < data.length) { body = packed; encoding = packedExt === '.br' ? 'br' : 'gzip'; }
        } catch { /* предсжатого файла нет — отдаём обычный */ }
      }
      const etag = `W/"${body.length.toString(16)}-${Math.floor(mtimeMs).toString(16)}${encoding ? '-' + encoding : ''}"`;
      const headers = {
        ...fileHeaders,
        etag,
        ...(encoding ? { 'content-encoding': encoding, 'content-length': String(body.length), vary: 'accept-encoding' } : {}),
      };
      if (req.headers['if-none-match'] === etag) {
        delete headers['content-length'];
        res.writeHead(304, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  const restartSelf = () => {
    const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, BEESCAD_RESTARTED: '1', PSBEES_RESTARTED: '1' },
    });
    child.unref();
    const pidFiles = upd.state.mode === 'clone'
      ? [join(APP_DIR, 'node_modules', '.cache', 'run-server.pid')]
      : [join(APP_DIR, 'server.pid')];
    for (const f of pidFiles) {
      mkdir(dirname(f), { recursive: true }).then(() => writeFile(f, String(child.pid) + '\n')).catch(() => {});
    }
    server.close();
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 300);
  };

  const retryBusy = (process.env.BEESCAD_RESTARTED === '1' || process.env.PSBEES_RESTARTED === '1') ? 40 : 0;
  let port = preferred;
  for (let i = 0, busyTries = 0; i <= fallback; i++) {
    try {
      await listen(server, port, HOST);
      break;
    } catch (e) {
      if (e && e.code === 'EADDRINUSE' && busyTries < retryBusy) {
        busyTries++;
        i--;
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      if (e && e.code === 'EADDRINUSE' && i < fallback) {
        port = preferred === 0 ? 0 : port + 1;
        continue;
      }
      throw e;
    }
  }
  delete process.env.BEESCAD_RESTARTED;
  delete process.env.PSBEES_RESTARTED;

  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  const urlHost = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST;
  const url = `http://${urlHost}:${actual}`;
  console.log(`BeesCAD: ${url}  (корень: ${ROOT})`);
  console.log(`${url}/healthz`);
  const exposed = HOST === '0.0.0.0' || HOST === '::' || !isLoopbackAddr(HOST);
  if (exposed) {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) console.log(`В локальной сети: http://${ni.address}:${actual}`);
      }
    }
    console.log('Сайт открыт для сети; обновление (/update/*) доступно только с этого компьютера.');
  }
  return { port: actual, host: HOST, root: ROOT, url, server };
}

const launchedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return samePath(fileURLToPath(import.meta.url), entry)
      || import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
})();

if (launchedDirectly) {
  startServer().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
