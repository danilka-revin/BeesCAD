// Управление режимом производительности.
// «Авто» оценивает железо при старте (ядра, память, WebGL-рендерер, prefers-reduced-motion)
// и дополнительно следит за реальным временем кадра в canvas: если перерисовка
// стабильно тяжелее бюджета — плавно ступенькой понижает профиль (high → balanced → low),
// без фонового rAF-цикла, который сам нагружал бы слабый ПК.

export type PerfMode = 'auto' | 'high' | 'balanced' | 'low';
export type PerfProfile = 'high' | 'balanced' | 'low';

export interface PerfConfig {
  mode: PerfMode;
  profile: PerfProfile;
  /** Верхний предел devicePixelRatio для 2D/3D canvas. */
  dprCap: number;
  /** Плавные CSS-переходы, пульсации, тени поверхностей, backdrop-filter. */
  effects: boolean;
  /** Сглаживание WebGL (дороже всего на встроенной графике и высоком DPR). */
  antialias3d: boolean;
  /** Детализация криволинейной геометрии (цилиндры, скругления, шестерни) для слабых ПК. */
  lodScale: number;
  /** Краткая причина выбора профиля (для подсказки в UI). */
  reason: string;
}

const STORAGE_KEY = 'beescad.perf';

const PROFILE_SPEC: Record<
  PerfProfile,
  { dprCap: number; effects: boolean; antialias3d: boolean; lodScale: number }
> = {
  high: { dprCap: 2, effects: true, antialias3d: true, lodScale: 1.0 },
  balanced: { dprCap: 1.5, effects: true, antialias3d: false, lodScale: 0.75 },
  low: { dprCap: 1, effects: false, antialias3d: false, lodScale: 0.5 },
};

const SW_RENDERER_RE = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i;
const WEAK_GPU_RE =
  /intel\(r\) hd graphics ([2-5]\d{2}|6[01]\d)\b|uhd graphics 60[05]|mali-4|mali-t[678]|adreno \(tm\) [234]\d{2}|videocore|powervr|geforce [2-7]\d{2}m?\b|radeon hd [2-7]\d{3}/i;

function readStoredMode(): PerfMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('psbees.perf');
    if (v === 'high' || v === 'balanced' || v === 'low' || v === 'auto') return v;
  } catch {
    /* localStorage недоступен (SSR / приватный режим) */
  }
  return 'auto';
}

function detectHardware(): { profile: PerfProfile; reason: string } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { profile: 'high', reason: 'SSR' };
  }
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return { profile: 'low', reason: 'в системе включено «уменьшение движения»' };
    }
  } catch {
    /* ignore */
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory; // ГБ, есть в Chromium

  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl', { powerPreference: 'low-power' }) ||
      c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return { profile: 'low', reason: 'WebGL недоступен' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(
      (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '',
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore */
  }

  if (SW_RENDERER_RE.test(gpu)) {
    return { profile: 'low', reason: `программный рендерер (${gpu.slice(0, 36)})` };
  }
  if (cores <= 2 || (mem !== undefined && mem <= 2)) {
    return { profile: 'low', reason: `${cores} ядр.${mem ? `, ${mem} ГБ ОЗУ` : ''}` };
  }
  if (WEAK_GPU_RE.test(gpu)) {
    return { profile: 'balanced', reason: gpu.slice(0, 40) };
  }
  if (cores <= 4 || (mem !== undefined && mem <= 4)) {
    return { profile: 'balanced', reason: `${cores} ядр.${mem ? `, ${mem} ГБ ОЗУ` : ''}` };
  }
  return {
    profile: 'high',
    reason: `${cores} ядр.${mem ? `, ${mem} ГБ ОЗУ` : ''}`,
  };
}

let mode: PerfMode = readStoredMode();
const hw = detectHardware();
let autoProfile: PerfProfile = hw.profile;
let autoReason: string = hw.reason;

function buildConfig(): PerfConfig {
  const profile: PerfProfile = mode === 'auto' ? autoProfile : mode;
  const spec = PROFILE_SPEC[profile];
  return {
    mode,
    profile,
    dprCap: spec.dprCap,
    effects: spec.effects,
    antialias3d: spec.antialias3d,
    lodScale: spec.lodScale,
    reason: mode === 'auto' ? `Авто: ${autoReason}` : 'Выбрано вручную',
  };
}

let current: PerfConfig = buildConfig();
const listeners = new Set<(c: PerfConfig) => void>();

function applyDomAttr(c: PerfConfig) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.perf = c.profile;
}

applyDomAttr(current);

function emit() {
  current = buildConfig();
  applyDomAttr(current);
  for (const fn of listeners) fn(current);
}

export function getPerfConfig(): PerfConfig {
  return current;
}

export function setPerfMode(next: PerfMode): void {
  if (next === mode && next !== 'auto') return;
  mode = next;
  if (next === 'auto') {
    autoProfile = hw.profile;
    autoReason = hw.reason;
    slowStreak = 0;
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  emit();
}

export function subscribePerf(fn: (c: PerfConfig) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Эффективный DPR для canvas с учётом текущего потолка производительности. */
export function getCanvasDpr(): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.max(1, Math.min(raw, current.dprCap));
}

/** Коэффициент сегментации 3D-тел с учётом текущего профиля (low = 0.5, balanced = 0.75, high = 1.0). */
export function scaleSegments(baseSegments: number, minSegments = 8): number {
  return Math.max(minSegments, Math.round(baseSegments * current.lodScale));
}

// Обратная связь от реальной отрисовки canvas: вызывается после кадра с его длительностью в мс.
// В режиме «Авто» при серии тяжёлых кадров (>26 мс, т.е. <38 FPS) понижаем профиль на ступень.
let slowStreak = 0;
const SLOW_FRAME_MS = 26;
const FAST_FRAME_MS = 18;
const STREAK_TO_DOWNGRADE = 8;

export function noteFrame(ms: number): void {
  if (mode !== 'auto' || autoProfile === 'low') return;
  if (ms > SLOW_FRAME_MS) {
    slowStreak++;
    if (slowStreak >= STREAK_TO_DOWNGRADE) {
      slowStreak = 0;
      autoProfile = autoProfile === 'high' ? 'balanced' : 'low';
      autoReason = `автопонижение (${Math.round(ms)} мс/кадр)`;
      emit();
    }
  } else if (ms < FAST_FRAME_MS && slowStreak > 0) {
    slowStreak--;
  }
}

export const PERF_MODE_LABELS: Record<PerfMode, string> = {
  auto: 'Авто (под железо)',
  high: 'Высокое качество',
  balanced: 'Сбалансированный',
  low: 'Слабый ПК (макс. скорость)',
};

export const PERF_PROFILE_SHORT: Record<PerfProfile, string> = {
  high: 'Выс.',
  balanced: 'Сред.',
  low: 'Эко',
};
