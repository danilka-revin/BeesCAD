// Автообновление BeesCAD из GitHub: проверка новой версии, live-прогресс,
// отмена операции, ожидание перезапуска production-сервера и перезагрузка UI.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconRefresh } from './icons';

export interface UpdateStage {
  id: string;
  label: string;
  weight: number;
  state: 'wait' | 'run' | 'done' | 'skip' | 'error';
  frac: number;
  msg: string;
}

interface UpdateStatus {
  status: 'idle' | 'busy' | 'done' | 'error' | 'cancelled';
  phase?: string;
  started?: string;
  from?: string;
  to?: string;
  changes?: number;
  output?: string;
  error?: string;
  mode?: string;
  stages?: UpdateStage[];
  stage?: string;
  pct?: number;
  bytes?: number;
  total?: number;
  exact?: boolean;
  speed?: number;
  eta?: number | null;
  elapsed?: number;
  count?: number;
  countTotal?: number;
  cancelable?: boolean;
  restart?: boolean;
  rev?: number;
}

interface CheckResult {
  ok: boolean;
  repo?: string;
  branch?: string;
  local?: string;
  latest?: string;
  latestSha?: string;
  latestMsg?: string;
  latestDate?: string;
  behind?: number;
  updateAvailable?: boolean;
  mode?: string;
  tooling?: { git: boolean; npm: boolean };
  cached?: boolean;
  error?: string;
}

type Phase = 'idle' | 'checking' | 'ready' | 'running' | 'done' | 'error' | 'cancelled';

interface State {
  phase: Phase;
  msg: string;
  detail: string[];
  from: string;
  to: string;
  repo: string;
  branch: string;
  latestMsg: string;
  latestSha: string;
  behind: number;
  updateAvailable: boolean;
  tooling: { git: boolean; npm: boolean };
  status: UpdateStatus | null;
  reload: 'none' | 'waiting' | 'manual';
}

const SEEN_KEY = 'beescad.update.seen';
const CHECK_INTERVAL_MS = 30 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(url: string, init?: RequestInit, timeout = 30_000): Promise<T | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, signal: ctl.signal });
    const text = await r.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } finally {
    window.clearTimeout(timer);
  }
}

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 Б';
  if (n < 1024) return `${Math.round(n)} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} МБ`;
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)} мин ${String(s % 60).padStart(2, '0')} с`;
}

export function useUpdater(enabled = true) {
  const [state, setState] = useState<State>({
    phase: 'idle',
    msg: '',
    detail: [],
    from: '',
    to: '',
    repo: '',
    branch: 'main',
    latestMsg: '',
    latestSha: '',
    behind: 0,
    updateAvailable: false,
    tooling: { git: true, npm: true },
    status: null,
    reload: 'none',
  });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) || '';
    } catch {
      return '';
    }
  });
  const runningRef = useRef(false);
  const aliveRef = useRef(true);
  const unsupportedRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const markSeen = useCallback((sha: string) => {
    if (!sha) return;
    setSeen(sha);
    try {
      localStorage.setItem(SEEN_KEY, sha);
    } catch {
      /* ignore */
    }
  }, []);

  const applyStatus = useCallback((s: UpdateStatus) => {
    setState((current) => ({
      ...current,
      status: s,
      from: s.from || current.from,
      to: s.to || current.to,
      msg: s.phase || current.msg,
      detail: (s.output || '').split('\n').filter(Boolean),
    }));
  }, []);

  const awaitRestart = useCallback(async (expect: string) => {
    setState((s) => ({ ...s, reload: 'waiting' }));
    const until = Date.now() + 90_000;
    let sawDown = false;
    await sleep(800);
    while (aliveRef.current && Date.now() < until) {
      try {
        const v = await getJson<{ ok?: boolean; sha?: string; short?: string }>('/version', undefined, 2500);
        const cur = String(v?.short || v?.sha || '');
        if (v?.ok && expect && cur.startsWith(expect.slice(0, 7))) {
          window.location.reload();
          return;
        }
        if (v?.ok && sawDown && !expect) {
          window.location.reload();
          return;
        }
      } catch {
        sawDown = true;
      }
      await sleep(700);
    }
    if (aliveRef.current) setState((s) => ({ ...s, reload: 'manual' }));
  }, []);

  const follow = useCallback(async (initialRev = -1) => {
    let rev = initialRev;
    let fails = 0;
    while (aliveRef.current) {
      let s: UpdateStatus | null = null;
      try {
        const url = '/update/status' + (rev >= 0 ? `?since=${rev}` : '');
        s = await getJson<UpdateStatus>(url, undefined, 35_000);
        fails = 0;
      } catch {
        if (++fails > 40) {
          setState((x) => ({ ...x, phase: 'error', msg: 'Сервер не отвечает. Проверьте, что программа запущена, и повторите.' }));
          return;
        }
        await sleep(750);
        continue;
      }
      if (!s) {
        await sleep(700);
        continue;
      }
      rev = Number(s.rev) || 0;
      applyStatus(s);
      if (s.status === 'done') {
        const changed = (s.changes ?? 0) > 0;
        setState((x) => ({
          ...x,
          phase: 'done',
          msg: s?.phase || 'Обновление установлено.',
          updateAvailable: changed ? false : x.updateAvailable,
        }));
        if (changed) {
          if (s.restart) void awaitRestart(s.to || '');
          else setState((x) => ({ ...x, reload: 'manual' }));
        }
        return;
      }
      if (s.status === 'cancelled') {
        setState((x) => ({ ...x, phase: 'cancelled', msg: s?.phase || 'Обновление отменено.' }));
        return;
      }
      if (s.status === 'error') {
        setState((x) => ({ ...x, phase: 'error', msg: s?.error || 'Обновление не удалось.' }));
        return;
      }
      if (s.status === 'idle') {
        setState((x) => ({ ...x, phase: 'error', msg: 'Сервер перезапустился — нажмите «Проверить ещё раз».' }));
        return;
      }
    }
  }, [applyStatus, awaitRestart]);

  const check = useCallback(async (opts: { silent?: boolean; force?: boolean } = {}) => {
    const silent = !!opts.silent;
    if (runningRef.current) return;
    if (!silent) setState((s) => ({ ...s, phase: 'checking', msg: 'Проверяем обновления на GitHub…' }));
    try {
      const result = await getJson<CheckResult>(`/update/check${opts.force ? '?force=1' : ''}`, undefined, 40_000);
      lastCheckAtRef.current = Date.now();
      if (!result) {
        unsupportedRef.current = true;
        if (!silent) {
          setState((s) => ({
            ...s,
            phase: 'error',
            msg: 'Встроенное обновление доступно в production-запуске. На Ubuntu запустите ярлык приложения или bash run.sh.',
          }));
        }
        return;
      }
      if (result.ok) {
        setState((s) => ({
          ...s,
          phase: silent && s.phase !== 'idle' ? s.phase : 'ready',
          repo: result.repo || s.repo,
          branch: result.branch || 'main',
          from: result.local || s.from,
          to: result.latest || s.to,
          latestSha: result.latestSha || s.latestSha,
          latestMsg: result.latestMsg || '',
          behind: result.behind ?? 0,
          updateAvailable: !!result.updateAvailable,
          tooling: result.tooling || s.tooling,
        }));
      } else if (!silent) {
        setState((s) => ({ ...s, phase: 'error', msg: result.error || 'Не удалось проверить обновления.' }));
      }
    } catch {
      lastCheckAtRef.current = Date.now();
      if (!silent) {
        setState((s) => ({ ...s, phase: 'error', msg: 'GitHub или локальный сервер не ответили вовремя. Проверьте интернет и повторите.' }));
      }
    }
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState((s) => ({ ...s, phase: 'running', msg: 'Запуск обновления…', detail: [], status: null, reload: 'none' }));
    try {
      const response = await getJson<UpdateStatus & { ok?: boolean }>(
        '/update/run',
        { method: 'POST' },
        30_000,
      );
      if (!response || (!response.ok && response.status !== 'busy')) {
        throw new Error((response as unknown as { error?: string } | null)?.error || 'Не удалось начать обновление.');
      }
      await follow(Number(response.rev) || -1);
    } catch (e) {
      setState((s) => ({ ...s, phase: 'error', msg: e instanceof Error ? e.message : 'Ошибка обновления.' }));
    } finally {
      runningRef.current = false;
    }
  }, [follow]);

  const cancel = useCallback(async () => {
    try {
      const response = await getJson<{ ok?: boolean; error?: string }>('/update/cancel', { method: 'POST' }, 10_000);
      if (response && !response.ok && response.error) {
        setState((s) => ({ ...s, msg: response.error || s.msg }));
      }
    } catch {
      /* статус придёт через long-poll */
    }
  }, []);

  // Подхват уже выполняющегося обновления (например, страница обновилась посреди процесса).
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    void getJson<UpdateStatus>('/update/status', undefined, 5_000).then((s) => {
      if (stopped || !s || s.status !== 'busy' || runningRef.current) return;
      runningRef.current = true;
      setState((x) => ({ ...x, phase: 'running' }));
      setOpen(true);
      void follow(Number(s.rev) || -1).finally(() => { runningRef.current = false; });
    }).catch(() => {});
    return () => { stopped = true; };
  }, [enabled, follow]);

  // Тихая проверка на старте, затем раз в 30 минут и при возвращении во вкладку.
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let start: number | undefined;
    const tick = async () => {
      if (runningRef.current || unsupportedRef.current) return;
      await check({ silent: true });
    };
    start = window.setTimeout(() => void tick(), 4_000);
    timer = window.setInterval(() => void tick(), CHECK_INTERVAL_MS);
    const wake = () => {
      if (!document.hidden && Date.now() - lastCheckAtRef.current > 5 * 60_000) void tick();
    };
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      if (start) window.clearTimeout(start);
      if (timer) window.clearInterval(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [check, enabled]);

  const openDialog = useCallback(() => {
    setOpen(true);
    markSeen(state.latestSha);
    if (runningRef.current || state.phase === 'running' || state.reload === 'waiting') return;
    if (state.phase === 'ready' && Date.now() - lastCheckAtRef.current < 60_000) return;
    setState((s) => ({ ...s, phase: 'idle', msg: '' }));
    void check({ force: true });
  }, [check, markSeen, state.latestSha, state.phase, state.reload]);

  const pct = state.phase === 'running' && state.status ? Math.round((state.status.pct || 0) * 100) : null;
  const busy = state.phase === 'running';
  const available = !busy && state.updateAvailable;
  const fresh = available && !!state.latestSha && state.latestSha !== seen;

  const Button = useMemo(() => (
    <button
      className={'tb-btn cu upd-btn' + (busy ? ' upd-busy' : '') + (available ? ' upd-avail' : '') + (fresh ? ' upd-fresh' : '')}
      title={busy
        ? `Идёт обновление: ${pct ?? 0}% — нажмите, чтобы развернуть`
        : available
          ? `Доступна новая версия ${state.to}${state.behind > 1 ? ` — новых коммитов: ${state.behind}` : ''}. Нажмите, чтобы обновить${state.latestMsg ? `\n${state.latestMsg}` : ''}`
          : 'Проверить обновления программы в GitHub'}
      onClick={openDialog}
      type="button"
    >
      <IconRefresh /> {busy ? `${pct ?? 0}%` : 'Обновить'}
      {available && <span className={'upd-dot' + (fresh ? ' is-new' : '')} />}
      {available && state.behind > 1 && <span className="upd-n">+{state.behind}</span>}
      {busy && <span className="upd-btn-bar" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />}
    </button>
  ), [busy, pct, available, fresh, state.to, state.behind, state.latestMsg, openDialog]);

  const Dialog = (
    <>
      {open && (
        <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="modal update-modal" role="dialog" aria-modal="true" aria-label="Обновление BeesCAD">
            <h2>{busy ? 'Обновление BeesCAD' : 'Обновить с GitHub'}</h2>
            <div className="upd-vers">
              <div><span className="upd-lab">Установлено</span><b className="upd-mono">{state.from || '—'}</b></div>
              <span className="upd-arrow">→</span>
              <div><span className="upd-lab">В ветке {state.branch || 'main'}</span><b className="upd-mono">{state.to || '…'}</b></div>
              <div className="upd-repo"><span className="upd-lab">Репозиторий</span><b className="upd-mono">{state.repo || 'danilka-revin/BeesCAD'}</b></div>
            </div>
            {state.phase === 'checking' && <div className="upd-msg">Проверяем обновления на GitHub…</div>}
            {state.phase === 'ready' && (state.updateAvailable
              ? <div className="upd-msg ok">Доступна новая версия <b>{state.to}</b>{state.behind > 1 ? ` — новых коммитов: ${state.behind}` : ''}{state.latestMsg && <div className="upd-commit">«{state.latestMsg}»</div>}</div>
              : <div className="upd-msg">Установлена актуальная версия — обновлений нет.</div>)}
            {busy && (
              <div className="updp">
                <div className="updp-head"><span className="updp-title">{state.status?.phase || state.msg || 'Обновление…'}</span><span className="updp-pct">{pct ?? 0}%</span></div>
                <div className="updp-track live" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                  <div className="updp-fill" style={{ width: `${pct ?? 0}%` }} />
                </div>
                <div className="updp-meta">
                  <span>{state.status?.stage === 'download' && state.status.bytes ? `${fmtBytes(state.status.bytes)}${state.status.total ? ` из ${state.status.exact ? '' : '~'}${fmtBytes(state.status.total)}` : ''}${state.status.speed ? ` · ${fmtBytes(state.status.speed)}/с` : ''}` : (state.status?.phase || '')}</span>
                  <span>прошло {fmtDuration(state.status?.elapsed)}{state.status?.eta != null ? ` · осталось ≈ ${fmtDuration(state.status.eta)}` : ''}</span>
                </div>
                {!!state.status?.stages?.length && <ol className="updp-steps">
                  {state.status.stages.map((s) => <li className={'updp-step s-' + s.state} key={s.id}>
                    <span className="updp-ico">{s.state === 'done' ? '✓' : s.state === 'skip' ? '↷' : s.state === 'error' ? '✕' : s.state === 'run' ? '◌' : '○'}</span>
                    <span className="updp-lab">{s.label}</span>
                    <span className="updp-mini">{s.state === 'run' && <span className="updp-mini-fill" style={{ width: `${Math.round(s.frac * 100)}%` }} />}</span>
                    <span className="updp-st">{s.state === 'run' ? `${Math.round(s.frac * 100)}%` : s.state === 'skip' ? 'кэш' : s.state === 'done' ? 'готово' : ''}</span>
                  </li>)}
                </ol>}
              </div>
            )}
            {state.phase === 'done' && <div className="upd-msg ok">{state.msg}{state.reload === 'waiting' && <><br />Ждём перезапуска сервера — страница обновится автоматически…</>}{state.reload === 'manual' && <><br />Нажмите «Перезагрузить сейчас», чтобы открыть новую версию.</>}</div>}
            {state.phase === 'cancelled' && <div className="upd-msg">{state.msg || 'Обновление отменено.'}</div>}
            {state.phase === 'error' && <div className="upd-msg bad">{state.msg}</div>}
            {state.detail.length > 0 && <details className="upd-details"><summary>Подробности ({state.detail.length})</summary><pre>{state.detail.join('\n')}</pre></details>}
            {!busy && state.phase !== 'done' && <p className="upd-note">Исходники будут скачаны из ветки <b>{state.branch || 'main'}</b>, затем приложение пересоберётся. Если зависимости не менялись, они берутся из кэша. Файлы проекта при обновлении не затрагиваются.</p>}
            <div className="foot">
              {busy ? <>
                <button className="btn" type="button" onClick={() => setOpen(false)} title="Обновление продолжится в фоне">Свернуть</button>
                <button className="btn danger" type="button" disabled={!state.status?.cancelable} onClick={() => void cancel()}>Отменить</button>
              </> : <>
                <button className="btn" type="button" onClick={() => setOpen(false)}>Закрыть</button>
                {state.phase === 'ready' && state.updateAvailable && <button className="btn primary" type="button" disabled={!state.tooling.npm || !state.tooling.git} onClick={() => void run()}>Обновить сейчас</button>}
                {state.phase === 'done' && state.reload !== 'none' && <button className="btn primary" type="button" onClick={() => window.location.reload()}>Перезагрузить сейчас</button>}
                {(state.phase === 'error' || state.phase === 'cancelled') && <button className="btn primary" type="button" onClick={() => void check({ force: true })}>Проверить ещё раз</button>}
              </>}
            </div>
          </div>
        </div>
      )}
      {fresh && !open && (
        <div className="upd-toast" role="status" aria-live="polite">
          <span className="upd-toast-ico"><IconRefresh /></span>
          <div className="upd-toast-body"><b>Вышла новая версия {state.to}</b><span>{state.behind > 1 ? `Новых коммитов: ${state.behind}. ` : ''}{state.latestMsg ? `«${state.latestMsg}»` : `Обновление из ветки ${state.branch || 'main'}.`}</span></div>
          <button className="btn tiny primary" type="button" onClick={openDialog}>Обновить</button>
          <button className="btn tiny" type="button" onClick={() => markSeen(state.latestSha)}>Позже</button>
        </div>
      )}
    </>
  );
  return { Button, Dialog, state, open: openDialog };
}
