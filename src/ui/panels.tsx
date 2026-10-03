import { useEffect, useMemo, useState } from 'react';
import type {
  CadDocument,
  CadFeature,
  EvaluatedBody,
  EvaluatedScene,
  FeatureKind,
  PrimitiveKind,
  StandardPartFeature,
  StandardPartKind,
  SketchShape,
} from '../cad/types';
import { getMaterial, MATERIALS } from '../cad/types';
import { STANDARD_PARTS_CATALOG } from '../cad/standard-parts';
import {
  IconBox,
  IconChevron,
  IconCone,
  IconCylinder,
  IconEye,
  IconGear,
  IconHole,
  IconMirror,
  IconPattern,
  IconRevolve,
  IconShell,
  IconSphere,
  IconTrash,
} from './icons';

const FEATURE_NAMES: Record<FeatureKind, string> = {
  sketch: 'Эскиз',
  extrude: 'Выдавливание',
  revolve: 'Вращение',
  primitive: 'Примитив',
  standard_part: 'Стандартная деталь',
  hole: 'Отверстие',
  fillet: 'Скругление',
  chamfer: 'Фаска',
  shell: 'Оболочка',
  pattern_linear: 'Линейный массив',
  pattern_circular: 'Круговой массив',
  mirror: 'Зеркало',
  transform: 'Перемещение',
  imported_mesh: 'Импортированная сетка',
};

function FeatureGlyph({ kind }: { kind: FeatureKind }) {
  const common = { className: 'feature-glyph', 'aria-hidden': true as const };
  switch (kind) {
    case 'sketch': return <span {...common}>▱</span>;
    case 'extrude': return <span {...common}>↥</span>;
    case 'revolve': return <span {...common}>⟳</span>;
    case 'primitive': return <IconBox />;
    case 'standard_part': return <IconGear />;
    case 'hole': return <IconHole />;
    case 'fillet': return <span {...common}>⌒</span>;
    case 'chamfer': return <span {...common}>◺</span>;
    case 'shell': return <IconShell />;
    case 'pattern_linear':
    case 'pattern_circular': return <IconPattern />;
    case 'mirror': return <IconMirror />;
    case 'transform': return <span {...common}>↔</span>;
    case 'imported_mesh': return <IconBox />;
  }
}

export function BrowserPanel({
  doc,
  scene,
  selectedFeatureId,
  selectedBodyId,
  onSelectFeature,
  onToggleVisible,
  onToggleSuppressed,
  onDelete,
}: {
  doc: CadDocument;
  scene: EvaluatedScene | null;
  selectedFeatureId: string | null;
  selectedBodyId: string | null;
  onSelectFeature: (feature: CadFeature) => void;
  onToggleVisible: (id: string) => void;
  onToggleSuppressed: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="browser-panel">
      <div className="panel-heading">
        <span>Дерево построения</span>
        <span className="panel-count mono">{doc.features.length}</span>
      </div>
      <div className="model-root">
        <IconChevron />
        <span className="root-cube"><IconBox /></span>
        <b>{doc.name}</b>
      </div>
      <div className="tree-section-label">ОПЕРАЦИИ · {doc.features.length}</div>
      <div className="feature-tree">
        {doc.features.map((feature, index) => {
          const targetId = 'targetBodyId' in feature ? feature.targetBodyId : ('sourceBodyId' in feature ? feature.sourceBodyId : undefined);
          const body = scene?.bodies.find((b) => b.featureId === feature.id || b.id === targetId || b.featureId === targetId);
          const selected = selectedFeatureId === feature.id || body?.id === selectedBodyId;
          return (
            <div
              key={feature.id}
              className={'tree-row' + (selected ? ' selected' : '') + (feature.suppressed ? ' suppressed' : '')}
              onClick={() => onSelectFeature(feature)}
              title={`${index + 1}. ${feature.name}`}
            >
              <span className="tree-indent" />
              <FeatureGlyph kind={feature.kind} />
              <span className="tree-name">{feature.name}</span>
              {feature.suppressed && <span className="tree-badge">OFF</span>}
              <button
                type="button"
                className="tree-action"
                title={feature.visible === false ? 'Показать' : 'Скрыть'}
                aria-label={feature.visible === false ? 'Показать операцию' : 'Скрыть операцию'}
                onClick={(e) => { e.stopPropagation(); onToggleVisible(feature.id); }}
              >
                <IconEye off={feature.visible === false} />
              </button>
              <button
                type="button"
                className="tree-action tree-more"
                title={feature.suppressed ? 'Включить операцию' : 'Подавить операцию'}
                aria-label={feature.suppressed ? 'Включить операцию' : 'Подавить операцию'}
                onClick={(e) => { e.stopPropagation(); onToggleSuppressed(feature.id); }}
              >
                ◌
              </button>
              <button
                type="button"
                className="tree-action tree-delete"
                title="Удалить операцию"
                aria-label="Удалить операцию"
                onClick={(e) => { e.stopPropagation(); onDelete(feature.id); }}
              >
                <IconTrash />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tree-footer">
        <span className="status-dot" />
        <span>{scene ? `${scene.bodies.filter((b) => b.visible).length} тел` : 'Пересчёт модели…'}</span>
        {scene && <span className="mono">{scene.totalTriangles.toLocaleString('ru-RU')} △</span>}
      </div>
    </div>
  );
}

const PRIMITIVES: { kind: PrimitiveKind; title: string; icon: typeof IconBox; defaults: { width: number; height: number; depth: number; radius: number; radius2: number } }[] = [
  { kind: 'box', title: 'Параллелепипед', icon: IconBox, defaults: { width: 30, height: 20, depth: 24, radius: 10, radius2: 4 } },
  { kind: 'cylinder', title: 'Цилиндр', icon: IconCylinder, defaults: { width: 20, height: 24, depth: 20, radius: 10, radius2: 0, } },
  { kind: 'sphere', title: 'Сфера', icon: IconSphere, defaults: { width: 20, height: 20, depth: 20, radius: 10, radius2: 0 } },
  { kind: 'cone', title: 'Конус', icon: IconCone, defaults: { width: 22, height: 24, depth: 22, radius: 11, radius2: 0 } },
  { kind: 'torus', title: 'Тор', icon: IconGear, defaults: { width: 28, height: 9, depth: 28, radius: 10, radius2: 4 } },
  { kind: 'pipe', title: 'Труба / втулка', icon: IconShell, defaults: { width: 24, height: 24, depth: 24, radius: 12, radius2: 3 } },
  { kind: 'wedge', title: 'Клин', icon: IconBox, defaults: { width: 30, height: 18, depth: 22, radius: 10, radius2: 0 } },
];

export function CatalogPanel({
  onAddPrimitive,
  onAddStandard,
}: {
  onAddPrimitive: (shape: PrimitiveKind, name: string, values: { width: number; height: number; depth: number; radius: number; radius2: number }) => void;
  onAddStandard: (kind: StandardPartKind, defaults: Omit<StandardPartFeature, 'id' | 'kind' | 'name'>, name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'standard' | 'primitive'>('standard');
  const q = query.trim().toLowerCase();
  const standards = useMemo(() => STANDARD_PARTS_CATALOG.filter((p) =>
    !q || `${p.name} ${p.standard} ${p.category} ${p.badge}`.toLowerCase().includes(q),
  ), [q]);
  const primitives = useMemo(() => PRIMITIVES.filter((p) => !q || p.title.toLowerCase().includes(q) || p.kind.includes(q)), [q]);

  return (
    <div className="catalog-panel">
      <div className="panel-heading">
        <span>Библиотека элементов</span>
        <span className="panel-count">ISO · ГОСТ</span>
      </div>
      <div className="catalog-search-wrap">
        <span className="search-symbol">⌕</span>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти деталь…" aria-label="Найти деталь" />
        <kbd>⌘K</kbd>
      </div>
      <div className="catalog-tabs" role="tablist" aria-label="Каталог">
        <button type="button" className={section === 'standard' ? 'on' : ''} onClick={() => setSection('standard')}>Стандартные</button>
        <button type="button" className={section === 'primitive' ? 'on' : ''} onClick={() => setSection('primitive')}>Примитивы</button>
      </div>
      {section === 'standard' ? (
        <div className="catalog-scroll">
          {['Крепёж (ISO / ГОСТ)', 'Передачи и вращение', 'Корпуса и конструктив'].map((category) => {
            const items = standards.filter((p) => p.category === category);
            if (!items.length) return null;
            return (
              <div className="catalog-group" key={category}>
                <div className="pkg-cat">{category}</div>
                {items.map((item) => (
                  <button key={item.kind} className="catalog-item" type="button" onClick={() => onAddStandard(item.kind, item.defaults, item.name)} title={`${item.name} · ${item.standard}`}>
                    <span className="catalog-part-icon"><IconGear /></span>
                    <span className="catalog-part-copy"><b>{item.name}</b><small>{item.standard}</small></span>
                    <span className="catalog-badge">{item.badge}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {!standards.length && <div className="empty-list">По запросу ничего не найдено.</div>}
        </div>
      ) : (
        <div className="catalog-scroll">
          <div className="pkg-cat">Базовые тела</div>
          {primitives.map((p) => {
            const Glyph = p.icon;
            return (
              <button key={p.kind} className="catalog-item" type="button" onClick={() => onAddPrimitive(p.kind, p.title, p.defaults)}>
                <span className="catalog-part-icon"><Glyph /></span><span className="catalog-part-copy"><b>{p.title}</b><small>Создать 3D-тело</small></span><span className="catalog-add">+</span>
              </button>
            );
          })}
          {!primitives.length && <div className="empty-list">По запросу ничего не найдено.</div>}
        </div>
      )}
    </div>
  );
}

function NumberControl({ label, value, onChange, step = 1, min = 0.01, max, suffix = 'мм' }: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [focused, value]);
  const commit = () => {
    const v = Number(draft.replace(',', '.'));
    if (Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min, v)));
    else setDraft(String(value));
    setFocused(false);
  };
  return (
    <label className="prop-row">
      <span>{label}</span>
      <span className="prop-input-wrap"><input className="input mono" type="number" step={step} min={min} value={draft} onFocus={() => setFocused(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} /><small>{suffix}</small></span>
    </label>
  );
}

function SelectControl({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="prop-row"><span>{label}</span><select className="select" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
  );
}

function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="toggle-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i /></label>;
}

const BOOLEAN_OPTIONS: [string, string][] = [['new', 'Новое тело'], ['join', 'Объединить'], ['cut', 'Вычесть'], ['intersect', 'Пересечь']];
const AXIS_OPTIONS: [string, string][] = [['X', 'Ось X'], ['Y', 'Ось Y'], ['Z', 'Ось Z']];

export function InspectorPanel({
  doc,
  scene,
  feature,
  body,
  busy,
  onPatchFeature,
  onRenameFeature,
  onSetFeatureMaterial,
  onAddSketchShape,
  onPatchSketchShape,
  onSetDefaultMaterial,
  onDeleteFeature,
}: {
  doc: CadDocument;
  scene: EvaluatedScene | null;
  feature: CadFeature | null;
  body: EvaluatedBody | null;
  busy: boolean;
  onPatchFeature: (id: string, patch: Record<string, unknown>) => void;
  onRenameFeature: (id: string, name: string) => void;
  onSetFeatureMaterial: (id: string, materialId: string) => void;
  onAddSketchShape: (id: string, shape: 'rect' | 'circle') => void;
  onPatchSketchShape: (featureId: string, shapeId: string, patch: Partial<SketchShape>) => void;
  onSetDefaultMaterial: (materialId: string) => void;
  onDeleteFeature: (id: string) => void;
}) {
  const [nameDraft, setNameDraft] = useState(feature?.name || '');
  useEffect(() => { setNameDraft(feature?.name || ''); }, [feature?.id, feature?.name]);
  const patch = (key: string, value: unknown) => feature && onPatchFeature(feature.id, { [key]: value });
  const materialId = feature?.materialId || body?.materialId || doc.defaultMaterialId;
  const material = getMaterial(materialId);
  const metricBody = body || (feature && scene?.bodies.find((b) => b.featureId === feature.id)) || null;

  return (
    <div className="inspector-panel">
      <div className="panel-heading"><span>Инспектор</span>{busy && <span className="rebuild-indicator"><i /> Пересчёт</span>}</div>
      {!feature && !body ? (
        <div className="inspector-empty"><div className="empty-cube"><IconBox /></div><b>Ничего не выбрано</b><span>Выберите операцию в дереве построения или грань на модели.</span></div>
      ) : (
        <>
          {feature && (
            <>
              <div className="inspect-feature-title"><FeatureGlyph kind={feature.kind} /><input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={() => nameDraft.trim() && onRenameFeature(feature.id, nameDraft.trim())} onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} /></div>
              <div className="inspect-meta"><span>{FEATURE_NAMES[feature.kind]}</span><span className="mono">{feature.id}</span></div>
              <div className="inspector-section-title">Параметры операции</div>
              {feature.kind === 'sketch' && <>
                <SelectControl label="Плоскость" value={feature.plane} options={ [['XY','XY — основание'],['XZ','XZ — фронтальная'],['YZ','YZ — боковая']] } onChange={(v) => patch('plane', v)} />
                <NumberControl label="Смещение плоскости" value={feature.planeOffset} onChange={(v) => patch('planeOffset', v)} />
                <div className="sketch-shapes-head"><span>Контуры ({feature.shapes.length})</span><div><button className="btn tiny" type="button" onClick={() => onAddSketchShape(feature.id, 'rect')}>+ Прямоугольник</button><button className="btn tiny" type="button" onClick={() => onAddSketchShape(feature.id, 'circle')}>+ Круг</button></div></div>
                {feature.shapes.map((shape, index) => (
                  <details className="shape-editor" key={shape.id} open={index === 0}>
                    <summary><span className="shape-dot" />{shape.kind === 'circle' || shape.kind === 'ring' ? `${shape.kind === 'ring' ? 'Кольцо' : 'Круг'} · R${shape.radius.toFixed(1)} мм` : `${shape.kind} · ${shape.width.toFixed(1)} × ${shape.height.toFixed(1)} мм`}<span className="muted">#{index + 1}</span></summary>
                    {shape.kind !== 'circle' && shape.kind !== 'ring' && <NumberControl label="Ширина" value={shape.width} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { width: v })} />}
                    {shape.kind !== 'circle' && <NumberControl label="Высота" value={shape.height} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { height: v })} />}
                    {(shape.kind === 'circle' || shape.kind === 'ring') && <NumberControl label="Радиус" value={shape.radius} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { radius: v })} />}
                    {shape.kind === 'ring' && <NumberControl label="Внутр. радиус" value={shape.innerRadius} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { innerRadius: v })} />}
                    {shape.kind === 'polygon' && <NumberControl label="Стороны" suffix="шт" min={3} max={24} step={1} value={shape.sides} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { sides: Math.round(v) })} />}
                    <NumberControl label="Центр X" value={shape.cx} min={-5000} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { cx: v })} />
                    <NumberControl label="Центр Y" value={shape.cy} min={-5000} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { cy: v })} />
                    <NumberControl label="Поворот" suffix="°" min={-360} max={360} value={shape.rotationDeg} onChange={(v) => onPatchSketchShape(feature.id, shape.id, { rotationDeg: v })} />
                  </details>
                ))}
                <p className="field-help">Контуры можно редактировать параметрами справа. Эскиз служит основой для операций Выдавливание и Вращение.</p>
              </>}
              {feature.kind === 'extrude' && <>
                <NumberControl label="Расстояние" value={feature.distance} onChange={(v) => patch('distance', v)} />
                <ToggleControl label="Симметрично от плоскости" checked={feature.symmetric} onChange={(v) => patch('symmetric', v)} />
                <NumberControl label="Уклон стенки" suffix="°" min={-45} max={45} step={1} value={feature.draftDeg} onChange={(v) => patch('draftDeg', v)} />
                <SelectControl label="Операция" value={feature.operation} options={BOOLEAN_OPTIONS} onChange={(v) => patch('operation', v)} />
                <SelectControl label="Исходный эскиз" value={feature.sketchId} options={doc.features.filter((f) => f.kind === 'sketch').map((f) => [f.id, f.name] as [string,string])} onChange={(v) => patch('sketchId', v)} />
              </>}
              {feature.kind === 'revolve' && <>
                <NumberControl label="Угол вращения" suffix="°" min={1} max={360} value={feature.angleDeg} onChange={(v) => patch('angleDeg', v)} />
                <SelectControl label="Ось вращения" value={feature.axis} options={AXIS_OPTIONS} onChange={(v) => patch('axis', v)} />
                <SelectControl label="Исходный эскиз" value={feature.sketchId} options={doc.features.filter((f) => f.kind === 'sketch').map((f) => [f.id, f.name] as [string,string])} onChange={(v) => patch('sketchId', v)} />
                <SelectControl label="Операция" value={feature.operation} options={BOOLEAN_OPTIONS} onChange={(v) => patch('operation', v)} />
              </>}
              {feature.kind === 'primitive' && <>
                <SelectControl label="Форма" value={feature.shape} options={ [['box','Параллелепипед'],['cylinder','Цилиндр'],['sphere','Сфера'],['cone','Конус'],['torus','Тор'],['pipe','Труба'],['wedge','Клин']] } onChange={(v) => patch('shape', v)} />
                {feature.shape !== 'sphere' && feature.shape !== 'torus' && <NumberControl label="Ширина X" value={feature.width} onChange={(v) => patch('width', v)} />}
                {feature.shape !== 'sphere' && <NumberControl label="Высота Y" value={feature.height} onChange={(v) => patch('height', v)} />}
                {feature.shape !== 'sphere' && feature.shape !== 'torus' && <NumberControl label="Глубина Z" value={feature.depth} onChange={(v) => patch('depth', v)} />}
                {(feature.shape === 'cylinder' || feature.shape === 'cone' || feature.shape === 'sphere' || feature.shape === 'torus' || feature.shape === 'pipe') && <NumberControl label={feature.shape === 'torus' ? 'Радиус кольца' : 'Радиус'} value={feature.radius} onChange={(v) => patch('radius', v)} />}
                {(feature.shape === 'cone' || feature.shape === 'torus') && <NumberControl label={feature.shape === 'cone' ? 'Радиус вершины' : 'Радиус трубки'} value={feature.radius2} onChange={(v) => patch('radius2', v)} />}
                {feature.shape === 'pipe' && <NumberControl label="Толщина стенки" value={feature.wall} onChange={(v) => patch('wall', v)} />}
                <SelectControl label="Операция" value={feature.operation} options={BOOLEAN_OPTIONS} onChange={(v) => patch('operation', v)} />
              </>}
              {feature.kind === 'standard_part' && <>
                <SelectControl label="Деталь" value={feature.partType} options={ [['hex_bolt','Болт шестигранный'],['socket_bolt','Винт DIN 912'],['hex_nut','Гайка'],['washer','Шайба'],['bearing','Подшипник'],['spur_gear','Шестерня'],['flange','Фланец'],['angle_bracket','Кронштейн'],['pcb_enclosure','Корпус РЭА'],['heatsink','Радиатор']] } onChange={(v) => patch('partType', v)} />
                <NumberControl label="Номинальный Ø" value={feature.nominalDiameter} onChange={(v) => patch('nominalDiameter', v)} />
                <NumberControl label="Длина / ширина" value={feature.length} onChange={(v) => patch('length', v)} />
                {(feature.partType === 'spur_gear' || feature.partType === 'hex_bolt' || feature.partType === 'hex_nut') && <NumberControl label={feature.partType === 'spur_gear' ? 'Модуль зуба m' : 'Шаг резьбы'} value={feature.moduleOrPitch} onChange={(v) => patch('moduleOrPitch', v)} />}
                <NumberControl label={feature.partType === 'spur_gear' ? 'Число зубьев z' : 'Количество' } suffix="шт" min={1} step={1} value={feature.teethOrCount} onChange={(v) => patch('teethOrCount', Math.round(v))} />
                <NumberControl label="Внешняя ширина / Ø" value={feature.outerWidth} onChange={(v) => patch('outerWidth', v)} />
                <NumberControl label="Внешняя глубина / Ø" value={feature.outerDepth} onChange={(v) => patch('outerDepth', v)} />
                <NumberControl label="Толщина стенки" value={feature.wallThickness} onChange={(v) => patch('wallThickness', v)} />
              </>}
              {feature.kind === 'hole' && <>
                <SelectControl label="Тип отверстия" value={feature.holeType} options={ [['simple','Простое'],['counterbore','Цековка'],['countersink','Зенковка']] } onChange={(v) => patch('holeType', v)} />
                <NumberControl label="Диаметр" value={feature.diameter} onChange={(v) => patch('diameter', v)} />
                <NumberControl label="Глубина" value={feature.depth} onChange={(v) => patch('depth', v)} />
                {feature.holeType !== 'simple' && <NumberControl label="Ø выборки" value={feature.cbDiameter} onChange={(v) => patch('cbDiameter', v)} />}
                {feature.holeType === 'counterbore' && <NumberControl label="Глубина цековки" value={feature.cbDepth} onChange={(v) => patch('cbDepth', v)} />}
                {feature.holeType === 'countersink' && <NumberControl label="Угол зенковки" suffix="°" value={feature.csAngleDeg} onChange={(v) => patch('csAngleDeg', v)} />}
                <SelectControl label="Ось сверления" value={feature.axis} options={AXIS_OPTIONS} onChange={(v) => patch('axis', v)} />
              </>}
              {feature.kind === 'fillet' && <><NumberControl label="Радиус" value={feature.radius} onChange={(v) => patch('radius', v)} /><SelectControl label="Группа рёбер" value={feature.edgeGroup} options={ [['top','Верхние'],['bottom','Нижние'],['vertical','Вертикальные'],['all','Все']] } onChange={(v) => patch('edgeGroup', v)} /></>}
              {feature.kind === 'chamfer' && <><NumberControl label="Размер фаски" value={feature.distance} onChange={(v) => patch('distance', v)} /><NumberControl label="Угол" suffix="°" value={feature.angleDeg} onChange={(v) => patch('angleDeg', v)} /><SelectControl label="Группа рёбер" value={feature.edgeGroup} options={ [['top','Верхние'],['bottom','Нижние'],['vertical','Вертикальные'],['all','Все']] } onChange={(v) => patch('edgeGroup', v)} /></>}
              {feature.kind === 'shell' && <><NumberControl label="Толщина стенки" value={feature.thickness} onChange={(v) => patch('thickness', v)} /><SelectControl label="Открытая грань" value={feature.openFace} options={ [['top','Верхняя'],['bottom','Нижняя'],['front','Передняя']] } onChange={(v) => patch('openFace', v)} /></>}
              {feature.kind === 'pattern_linear' && <><NumberControl label="Копий по X" suffix="шт" min={1} step={1} value={feature.countX} onChange={(v) => patch('countX', Math.round(v))} /><NumberControl label="Копий по Y" suffix="шт" min={1} step={1} value={feature.countY} onChange={(v) => patch('countY', Math.round(v))} /><NumberControl label="Копий по Z" suffix="шт" min={1} step={1} value={feature.countZ} onChange={(v) => patch('countZ', Math.round(v))} /><NumberControl label="Шаг X" value={feature.spacingX} onChange={(v) => patch('spacingX', v)} /><NumberControl label="Шаг Y" value={feature.spacingY} onChange={(v) => patch('spacingY', v)} /><NumberControl label="Шаг Z" value={feature.spacingZ} onChange={(v) => patch('spacingZ', v)} /></>}
              {feature.kind === 'pattern_circular' && <><NumberControl label="Количество" suffix="шт" min={2} max={36} step={1} value={feature.count} onChange={(v) => patch('count', Math.round(v))} /><NumberControl label="Полный угол" suffix="°" value={feature.totalAngleDeg} onChange={(v) => patch('totalAngleDeg', v)} /><NumberControl label="Смещение по радиусу" value={feature.radiusOffset} onChange={(v) => patch('radiusOffset', v)} /><SelectControl label="Ось" value={feature.axis} options={AXIS_OPTIONS} onChange={(v) => patch('axis', v)} /></>}
              {feature.kind === 'mirror' && <><SelectControl label="Плоскость" value={feature.mirrorPlane} options={ [['XY','XY'],['XZ','XZ'],['YZ','YZ']] } onChange={(v) => patch('mirrorPlane', v)} /><NumberControl label="Смещение" value={feature.offset} onChange={(v) => patch('offset', v)} /></>}
              {(feature.kind === 'transform' || feature.kind === 'imported_mesh') && <><NumberControl label="Перемещение X" value={feature.tx || 0} onChange={(v) => patch('tx', v)} /><NumberControl label="Перемещение Y" value={feature.ty || 0} onChange={(v) => patch('ty', v)} /><NumberControl label="Перемещение Z" value={feature.tz || 0} onChange={(v) => patch('tz', v)} /><NumberControl label="Масштаб" suffix="×" min={0.01} step={0.1} value={'scaleFactor' in feature ? feature.scaleFactor : 1} onChange={(v) => patch('scaleFactor', v)} /></>}
            </>
          )}

          {feature && ('materialId' in feature) && <div className="inspector-section-title">Материал</div>}
          {feature && ('materialId' in feature) && <SelectControl label="Материал" value={materialId} options={MATERIALS.map((m) => [m.id, m.name] as [string, string])} onChange={(v) => onSetFeatureMaterial(feature.id, v)} />}
          {!feature && body && <><div className="inspector-section-title">Материал</div><SelectControl label="Материал тела" value={body.materialId} options={MATERIALS.map((m) => [m.id, m.name] as [string, string])} onChange={onSetDefaultMaterial} /></>}
          <div className="material-card"><span className="material-swatch" style={{ background: feature?.color || body?.color || material.color }} /><div><b>{material.name}</b><small>{material.densityGcm3.toFixed(2)} г/см³ · предел текучести {material.yieldStrengthMPa} МПа</small></div></div>

          <div className="inspector-section-title">Масс-инерционные характеристики</div>
          {metricBody ? <div className="stat-cards">
            <div className="stat-card"><span>Объём</span><b>{(metricBody.volumeMm3 / 1000).toFixed(2)} см³</b></div>
            <div className="stat-card"><span>Масса</span><b>{metricBody.massGrams.toFixed(2)} г</b></div>
            <div className="stat-card"><span>Площадь</span><b>{(metricBody.areaMm2 / 100).toFixed(2)} см²</b></div>
            <div className="stat-card"><span>Треугольников</span><b>{metricBody.triangleCount.toLocaleString('ru-RU')}</b></div>
            <div className="stat-card wide"><span>Габариты X × Y × Z</span><b>{metricBody.bbox.size.map((n) => n.toFixed(1)).join(' × ')} мм</b></div>
          </div> : <div className="empty-list">Нет результирующего 3D-тела для этой операции.</div>}

          {feature && <div className="inspector-actions"><button type="button" className="btn danger" onClick={() => onDeleteFeature(feature.id)}><IconTrash /> Удалить операцию</button></div>}
          <p className="field-help">История построения пересчитывается в отдельном потоке, чтобы 3D-сцена оставалась отзывчивой.</p>
        </>
      )}
    </div>
  );
}
