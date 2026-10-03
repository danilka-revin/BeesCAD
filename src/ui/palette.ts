// Пользовательские цвета оформления интерфейса.
// Хранятся в localStorage под ключом 'beescad.colors' и применяются
// как CSS-переменные на <html>, переопределяя значения темы (dark / light).

export interface CustomColors {
  accent?: string; // основной акцент (--accent) + производные (--accent-hover, --accent-soft, --accent-line)
  page?: string; // фон страницы и холста (--page, --canvas)
  surface?: string; // фон панелей и тулбара (--surface + --surface-2, --hover)
  text?: string; // основной текст (--text)
  line?: string; // границы и разделители (--line)
}

export type ColorSlot = keyof CustomColors;

export const COLOR_SLOTS: {
  key: ColorSlot;
  label: string;
  hint: string;
  defaults: { dark: string; light: string };
}[] = [
  {
    key: 'accent',
    label: 'Акцент (кнопки, выделение)',
    hint: 'Кнопки, активные инструменты, подсветка граней и размеров',
    defaults: { dark: '#ffc233', light: '#c98200' },
  },
  {
    key: 'page',
    label: 'Фон вьюпорта и окна',
    hint: 'Подложка под 3D-сценой и вокруг панелей',
    defaults: { dark: '#0f1115', light: '#f4f6f9' },
  },
  {
    key: 'surface',
    label: 'Панели и тулбар',
    hint: 'Боковые панели, верхняя панель, дерево построения, модальные окна',
    defaults: { dark: '#15181e', light: '#ffffff' },
  },
  {
    key: 'text',
    label: 'Основной текст',
    hint: 'Подписи, значения параметров, заголовки',
    defaults: { dark: '#edf0f4', light: '#14181f' },
  },
  {
    key: 'line',
    label: 'Границы и разделители',
    hint: 'Рамки панелей, полей ввода, кнопок',
    defaults: { dark: '#2a3038', light: '#d5dbe3' },
  },
];

export interface ColorPreset {
  id: string;
  name: string;
  theme?: 'dark' | 'light';
  colors: CustomColors;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { id: 'default', name: 'Пчелиное золото (по умолч.)', colors: {} },
  {
    id: 'fusion',
    name: 'Инженерный графит (Fusion)',
    theme: 'dark',
    colors: { accent: '#38abff', page: '#111418', surface: '#181c22', line: '#29303a' },
  },
  {
    id: 'ocean',
    name: 'Синий чертёж',
    theme: 'dark',
    colors: { accent: '#38bdf8', page: '#0b1220', surface: '#111a2e', line: '#1f2d47' },
  },
  {
    id: 'emerald',
    name: 'Изумрудный CAD',
    theme: 'dark',
    colors: { accent: '#34d399', page: '#0c1412', surface: '#121f1b', line: '#213630' },
  },
  {
    id: 'violet',
    name: 'Неоновый аметист',
    theme: 'dark',
    colors: { accent: '#a78bfa', page: '#12101b', surface: '#191626', line: '#2d2842' },
  },
  {
    id: 'copper',
    name: 'Тёплая медь',
    theme: 'dark',
    colors: { accent: '#fb923c', page: '#14110f', surface: '#1c1714', line: '#332923' },
  },
  {
    id: 'paper',
    name: 'Светлая миллиметровка',
    theme: 'light',
    colors: { accent: '#0284c7', page: '#f1f5f9', surface: '#ffffff', text: '#0f172a', line: '#cbd5e1' },
  },
];

const STORAGE_KEY = 'beescad.colors';

export function loadCustomColors(): CustomColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('psbees.colors');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: CustomColors = {};
    for (const { key } of COLOR_SLOTS) {
      const v = parsed[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[key] = v.toLowerCase();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveCustomColors(c: CustomColors): void {
  try {
    const clean: CustomColors = {};
    for (const { key } of COLOR_SLOTS) {
      const v = c[key];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) clean[key] = v.toLowerCase();
    }
    if (Object.keys(clean).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {
    /* ignore */
  }
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const cl = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${cl(r)}${cl(g)}${cl(b)}`;
}

// Сдвиг яркости: k > 0 осветляет к белому, k < 0 затемняет к чёрному.
function shiftHex(hex: string, k: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = k >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(k));
  return rgbToHex(
    rgb[0] + (target - rgb[0]) * t,
    rgb[1] + (target - rgb[1]) * t,
    rgb[2] + (target - rgb[2]) * t,
  );
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

const MANAGED_VARS = [
  '--accent',
  '--accent-hover',
  '--accent-soft',
  '--accent-line',
  '--page',
  '--canvas',
  '--surface',
  '--surface-2',
  '--hover',
  '--text',
  '--line',
];

export function applyCustomColors(c: CustomColors): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (const v of MANAGED_VARS) style.removeProperty(v);

  if (c.accent) {
    const rgb = hexToRgb(c.accent);
    if (rgb) {
      style.setProperty('--accent', c.accent);
      style.setProperty('--accent-hover', shiftHex(c.accent, luminance(c.accent) > 0.6 ? 0.25 : -0.15));
      style.setProperty('--accent-soft', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.14)`);
      style.setProperty('--accent-line', `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.45)`);
    }
  }
  if (c.page) {
    style.setProperty('--page', c.page);
    style.setProperty('--canvas', shiftHex(c.page, luminance(c.page) > 0.5 ? -0.04 : -0.15));
  }
  if (c.surface) {
    const isLight = luminance(c.surface) > 0.5;
    style.setProperty('--surface', c.surface);
    style.setProperty('--surface-2', shiftHex(c.surface, isLight ? -0.05 : 0.04));
    style.setProperty('--hover', shiftHex(c.surface, isLight ? -0.09 : 0.08));
  }
  if (c.text) {
    style.setProperty('--text', c.text);
  }
  if (c.line) {
    style.setProperty('--line', c.line);
  }
}
