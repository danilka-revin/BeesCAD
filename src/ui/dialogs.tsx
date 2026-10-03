import { useEffect, useState } from 'react';
import type { CadDocument, UserParam } from '../cad/types';
import {
  COLOR_PRESETS,
  COLOR_SLOTS,
  type ColorSlot,
  type CustomColors,
} from './palette';

export type PanelId = 'browser' | 'catalog' | 'inspector' | 'physics' | 'dfm';

export interface PanelPlacement {
  id: PanelId;
  side: 'left' | 'right';
  visible: boolean;
}

export interface UiLayout {
  panels: PanelPlacement[];
  leftWidth: number;
  rightWidth: number;
}

export const PANEL_TITLES: Record<PanelId, string> = {
  browser: 'Дерево модели (Тела и Эскизы)',
  catalog: 'Библиотека деталей (ISO / ГОСТ)',
  inspector: 'Инспектор операции',
  physics: 'Материал и масс-инерционный расчёт',
  dfm: 'Технологический контроль (DFM)',
};

export const DEFAULT_UI_LAYOUT: UiLayout = {
  panels: [
    { id: 'browser', side: 'left', visible: true },
    { id: 'catalog', side: 'left', visible: true },
    { id: 'inspector', side: 'right', visible: true },
    { id: 'physics', side: 'right', visible: true },
    { id: 'dfm', side: 'right', visible: true },
  ],
  leftWidth: 256,
  rightWidth: 288,
};

export function normalizeUiLayout(raw: unknown): UiLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_UI_LAYOUT;
  const r = raw as Partial<UiLayout>;
  const seen = new Set<PanelId>();
  const panels: PanelPlacement[] = [];
  if (Array.isArray(r.panels)) {
    for (const p of r.panels) {
      if (
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        p.id in PANEL_TITLES &&
        !seen.has(p.id as PanelId)
      ) {
        seen.add(p.id as PanelId);
        panels.push({
          id: p.id as PanelId,
          side: p.side === 'right' ? 'right' : 'left',
          visible: Boolean(p.visible),
        });
      }
    }
  }
  for (const def of DEFAULT_UI_LAYOUT.panels) {
    if (!seen.has(def.id)) panels.push({ ...def });
  }
  const clamp = (n: unknown, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(200, Math.min(440, Math.round(n))) : d;
  return {
    panels,
    leftWidth: clamp(r.leftWidth, DEFAULT_UI_LAYOUT.leftWidth),
    rightWidth: clamp(r.rightWidth, DEFAULT_UI_LAYOUT.rightWidth),
  };
}

/** Модальное окно таблицы параметрических уравнений (Аналог Change Parameters fx в Fusion 360). */
export function ParametersDialog({
  doc,
  onChange,
  onClose,
}: {
  doc: CadDocument;
  onChange: (nextParams: UserParam[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [val, setVal] = useState(20);
  const [unit, setUnit] = useState<'mm' | 'deg' | 'count'>('mm');
  const [comment, setComment] = useState('');

  const addParam = () => {
    const clean = name.trim().replace(/\s+/g, '_') || `Param_${doc.parameters.length + 1}`;
    onChange([
      ...doc.parameters,
      {
        id: `p-${Date.now().toString(36)}`,
        name: clean,
        value: Number(val) || 0,
        unit,
        comment: comment.trim() || 'Пользовательский параметр',
      },
    ]);
    setName('');
    setComment('');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Таблица параметров модели (fx)</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Глобальные конструктивные переменные проекта (по аналогии с <b>Modify → Change Parameters</b> в Fusion 360).
        </p>

        <table className="kbd-table">
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11.5 }}>
              <th style={{ padding: '4px' }}>Имя</th>
              <th style={{ padding: '4px' }}>Значение</th>
              <th style={{ padding: '4px' }}>Ед.</th>
              <th style={{ padding: '4px' }}>Комментарий</th>
              <th style={{ padding: '4px' }} />
            </tr>
          </thead>
          <tbody>
            {doc.parameters.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td style={{ width: 110 }}>
                  <input
                    className="input mono"
                    type="number"
                    step="0.5"
                    value={p.value}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onChange(
                        doc.parameters.map((item) =>
                          item.id === p.id ? { ...item, value: v } : item,
                        ),
                      );
                    }}
                  />
                </td>
                <td className="mono muted">{p.unit}</td>
                <td>
                  <input
                    className="input"
                    value={p.comment}
                    onChange={(e) =>
                      onChange(
                        doc.parameters.map((item) =>
                          item.id === p.id ? { ...item, comment: e.target.value } : item,
                        ),
                      )
                    }
                  />
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="uib-btn"
                    title="Удалить параметр"
                    onClick={() => onChange(doc.parameters.filter((item) => item.id !== p.id))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 90px 80px 1.4fr auto',
            gap: 6,
            marginTop: 12,
          }}
        >
          <input
            className="input mono"
            placeholder="Имя (напр. Wall_T)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input mono"
            type="number"
            value={val}
            onChange={(e) => setVal(Number(e.target.value))}
          />
          <select
            className="select"
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'mm' | 'deg' | 'count')}
          >
            <option value="mm">mm</option>
            <option value="deg">deg</option>
            <option value="count">шт</option>
          </select>
          <input
            className="input"
            placeholder="Комментарий"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="button" className="btn primary" onClick={addParam}>
            + Добавить
          </button>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/** Конструктор раскладки интерфейса: какие панели показывать, в какой колонке и в каком порядке. */
export function UiBuilderDialog({
  layout,
  onChange,
  onReset,
  onClose,
}: {
  layout: UiLayout;
  onChange: (next: UiLayout) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const moveOrder = (id: PanelId, dir: -1 | 1) => {
    const target = layout.panels.find((p) => p.id === id);
    if (!target) return;
    const sameSide = layout.panels
      .map((p, idx) => ({ p, idx }))
      .filter((x) => x.p.side === target.side);
    const pos = sameSide.findIndex((x) => x.p.id === id);
    const swapWith = sameSide[pos + dir];
    if (!swapWith) return;
    const next = layout.panels.slice();
    const a = sameSide[pos].idx;
    const b = swapWith.idx;
    [next[a], next[b]] = [next[b], next[a]];
    onChange({ ...layout, panels: next });
  };

  const toggleSide = (id: PanelId) => {
    onChange({
      ...layout,
      panels: layout.panels.map((p) =>
        p.id === id ? { ...p, side: p.side === 'left' ? 'right' : 'left' } : p,
      ),
    });
  };

  const toggleVisible = (id: PanelId) => {
    onChange({
      ...layout,
      panels: layout.panels.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)),
    });
  };

  const renderColumn = (side: 'left' | 'right', title: string, widthKey: 'leftWidth' | 'rightWidth') => {
    const items = layout.panels.filter((p) => p.side === side);
    return (
      <div className="uib-col">
        <div className="uib-col-head">
          <span>{title}</span>
          <span className="muted mono">{layout[widthKey]} px</span>
        </div>
        {items.length === 0 && (
          <div className="muted" style={{ padding: '8px 2px' }}>
            Нет панелей — перенесите сюда кнопкой ⇄
          </div>
        )}
        {items.map((p, i) => (
          <div key={p.id} className={'uib-row' + (p.visible ? '' : ' off')}>
            <label className="uib-row-title">
              <input type="checkbox" checked={p.visible} onChange={() => toggleVisible(p.id)} />
              <span>{PANEL_TITLES[p.id]}</span>
            </label>
            <div className="uib-row-actions">
              <button
                type="button"
                className="uib-btn"
                title="Выше"
                disabled={i === 0}
                onClick={() => moveOrder(p.id, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="uib-btn"
                title="Ниже"
                disabled={i === items.length - 1}
                onClick={() => moveOrder(p.id, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="uib-btn"
                title={side === 'left' ? 'Перенести в правую панель' : 'Перенести в левую панель'}
                onClick={() => toggleSide(p.id)}
              >
                {side === 'left' ? '→' : '←'}
              </button>
            </div>
          </div>
        ))}
        <div className="uib-width">
          <span>Ширина:</span>
          <input
            type="range"
            min={200}
            max={420}
            step={4}
            value={layout[widthKey]}
            onChange={(e) => onChange({ ...layout, [widthKey]: Number(e.target.value) })}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Настройка интерфейса</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Отметьте нужные блоки, поменяйте их порядок кнопками ↑↓ или перенесите между левой и
          правой боковыми панелями. Если скрыть все блоки стороны — колонка уберётся, освободив
          место под 3D-сцену.
        </p>
        <div className="uib-cols">
          {renderColumn('left', 'Левая панель', 'leftWidth')}
          {renderColumn('right', 'Правая панель', 'rightWidth')}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onReset}>
            По умолчанию
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

/** Палитра цветов интерфейса: готовые пресеты и ручной выбор ключевых цветов темы. */
export function ColorPaletteDialog({
  theme,
  colors,
  onChangeTheme,
  onChange,
  onReset,
  onClose,
}: {
  theme: 'dark' | 'light';
  colors: CustomColors;
  onChangeTheme: (t: 'dark' | 'light') => void;
  onChange: (next: CustomColors) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const setSlot = (key: ColorSlot, val: string | undefined) => {
    const next: CustomColors = { ...colors };
    if (!val) delete next[key];
    else next[key] = val;
    onChange(next);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Палитра цветов интерфейса</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Выберите готовую цветовую схему или настройте отдельные элементы под себя. Настройки
          сохраняются автоматически.
        </p>

        <div className="pkg-cat">Готовые схемы</div>
        <div className="palette-presets">
          {COLOR_PRESETS.map((p) => {
            const base = p.theme ?? theme;
            const sw = (slot: ColorSlot) =>
              p.colors[slot] ?? COLOR_SLOTS.find((s) => s.key === slot)!.defaults[base];
            return (
              <button
                key={p.id}
                type="button"
                className="preset-chip"
                onClick={() => {
                  if (p.theme && p.theme !== theme) onChangeTheme(p.theme);
                  onChange({ ...p.colors });
                }}
              >
                <span className="preset-swatches">
                  <i style={{ background: sw('page') }} />
                  <i style={{ background: sw('surface') }} />
                  <i style={{ background: sw('accent') }} />
                </span>
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>

        <div className="pkg-cat">Свои цвета</div>
        <div className="palette-list">
          {COLOR_SLOTS.map((s) => {
            const current = colors[s.key] ?? s.defaults[theme];
            const isCustom = Boolean(colors[s.key]);
            return (
              <div key={s.key} className="palette-row">
                <div className="palette-row-info">
                  <div className="palette-row-label">{s.label}</div>
                  <div className="muted">{s.hint}</div>
                </div>
                <div className="palette-row-ctrl">
                  <input
                    type="color"
                    className="color-well"
                    value={current}
                    onChange={(e) => setSlot(s.key, e.target.value)}
                    title="Выбрать цвет"
                  />
                  <input
                    type="text"
                    className="input mono color-hex"
                    value={current}
                    maxLength={7}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (/^#[0-9a-fA-F]{6}$/.test(v)) setSlot(s.key, v);
                    }}
                  />
                  <button
                    type="button"
                    className="uib-btn"
                    disabled={!isCustom}
                    title="Сбросить к цвету темы"
                    onClick={() => setSlot(s.key, undefined)}
                  >
                    ↺
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onReset}>
            Сбросить все цвета
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V / Esc', 'Инструмент «Выбор» и выход из режима'],
    ['S', 'Создать новый 2D-эскиз (Sketch)'],
    ['E', 'Выдавливание (Extrude) активного эскиза'],
    ['R', 'Вращение (Revolve) профиля вокруг оси'],
    ['H', 'Мастер отверстий (Hole Wizard — М2..М20)'],
    ['F', 'Скругление рёбер (Fillet)'],
    ['C', 'Фаска рёбер (Chamfer)'],
    ['L', 'Тонкостенная оболочка (Shell)'],
    ['M', '3D-измерение расстояния между точками'],
    ['X', 'Включить / выключить сечение модели (Section)'],
    ['0 / Home', 'Вписать 3D-модель в окно (Fit View)'],
    ['1 / 2 / 3', 'Вид Спереди / Сверху / Справа'],
    ['Delete / Backspace', 'Удалить выбранную операцию дерева'],
    ['Ctrl + Z / Ctrl + Y', 'Отменить / повторить действие'],
    ['Ctrl + N / Ctrl + O / Ctrl + S', 'Новый / открыть / сохранить проект'],
    ['ЛКМ / ПКМ + перетаскивание', 'Вращение 3D-камеры вокруг детали'],
    ['СКМ или Shift + ЛКМ', 'Панорамирование 3D-сцены'],
    ['Колесо мыши', 'Масштабирование (зум)'],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Горячие клавиши BeesCAD</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <table className="kbd-table">
          <tbody>
            {rows.map(([k, d]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

interface VersionMeta {
  short?: string;
  sha?: string;
  committedAt?: string;
  builtAt?: string;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [ver, setVer] = useState<VersionMeta | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/version', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (alive && v && typeof v === 'object') setVer(v as VersionMeta);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const fmtDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/beescad.svg" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
            BeesCAD — инженерное 3D-моделирование
          </h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <p style={{ marginTop: 0 }}>
          Инженерная параметрическая 3D САПР для <b>Ubuntu Linux</b> (в духе Autodesk Fusion 360),
          построенная в едином дизайн-коде с <b>PsBees (linux_pcb_app)</b> и оптимизированная для
          максимальной скорости работы даже на слабом железе.
        </p>
        <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Параметрическое дерево построения (Timeline) с откатом, подавлением и редактированием</li>
          <li>2D-эскизы на плоскостях XY/XZ/YZ со смещением, размерами и зависимостями</li>
          <li>Твердотельные операции: Выдавливание, Вращение, Отверстия (М2–М20), Скругление, Фаска, Оболочка, Массивы и Зеркало</li>
          <li>Библиотека стандартных деталей ISO / ГОСТ (шестерни по модулю, подшипники, фланцы, крепёж, корпуса РЭА)</li>
          <li>Экспорт в STL (ASCII и бинарный), STEP (ISO-10303-21 AP214), OBJ, чертежи SVG (ГОСТ) / DXF и BOM CSV</li>
        </ul>
        <div className="muted mono" style={{ paddingTop: 6, borderTop: '1px solid var(--line)' }}>
          Версия сборки: <b>{ver?.short || 'dev'}</b>
          {ver?.committedAt ? ` · коммит от ${fmtDate(ver.committedAt)}` : ''}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
