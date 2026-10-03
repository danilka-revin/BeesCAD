import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CAD_TEMPLATES,
  createEmptyDoc,
  createDemoGearboxDoc,
} from './cad/templates';
import { useEvaluatedScene } from './cad/use-evaluated';
import {
  exportBomCsv,
  exportObj,
  exportProjectionDxf,
  exportProjectionSvg,
  exportStlAscii,
  exportStlBinary,
  exportStepAp214,
  parseObjFile,
  parseStlFile,
} from './cad/io';
import type {
  CadDocument,
  CadFeature,
  EvaluatedBody,
  PrimitiveKind,
  SketchConstraint,
  SketchFeature,
  SketchShape,
  StandardPartFeature,
  StandardPartKind,
  ToolId,
  UserParam,
} from './cad/types';
import { MATERIALS } from './cad/types';
import { STANDARD_PARTS_CATALOG } from './cad/standard-parts';
import { BrowserPanel, CatalogPanel, InspectorPanel } from './ui/panels';
import {
  AboutDialog,
  ColorPaletteDialog,
  DEFAULT_UI_LAYOUT,
  normalizeUiLayout,
  PANEL_TITLES,
  ParametersDialog,
  ShortcutsDialog,
  UiBuilderDialog,
  type PanelId,
  type UiLayout,
} from './ui/dialogs';
import {
  IconBox,
  IconCheck,
  IconChevron,
  IconCube3D,
  IconDownload,
  IconEye,
  IconFit,
  IconFolder,
  IconHole,
  IconMirror,
  IconMoon,
  IconPalette,
  IconPattern,
  IconPlus,
  IconRedo,
  IconRevolve,
  IconRuler,
  IconSection,
  IconShell,
  IconSketch,
  IconSliders,
  IconSun,
  IconUndo,
} from './ui/icons';
import { MenuBtn, SplitBtn } from './ui/widgets';
import type { CameraPreset, MeasurePoint, ViewStyle } from './ui/viewport-3d';
const Viewport3D = lazy(() => import('./ui/viewport-3d').then((m) => ({ default: m.Viewport3D })));
import { usePerf } from './ui/perf';
import { getPerfConfig, PERF_MODE_LABELS, setPerfMode, type PerfMode } from './perf';
import { applyCustomColors, loadCustomColors, saveCustomColors, type CustomColors } from './ui/palette';
import { useUpdater } from './ui/updater';
import './styles.css';

const AUTOSAVE_KEY = 'beescad.autosave.v1';
const THEME_KEY = 'beescad.theme';
const LAYOUT_KEY = 'beescad.ui.layout';

type Theme = 'dark' | 'light';

function makeId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
}

function loadDocument(): CadDocument {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CadDocument;
      if (parsed && Array.isArray(parsed.features) && parsed.version === 1) return parsed;
    }
  } catch {
    /* старый черновик может быть повреждён — открываем демо-проект */
  }
  return createDemoGearboxDoc();
}

function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY) || localStorage.getItem('psbees.theme');
    if (raw === 'light' || raw === 'dark') return raw;
  } catch { /* ignore */ }
  return 'dark';
}

function loadLayout(): UiLayout {
  try {
    return normalizeUiLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null'));
  } catch {
    return DEFAULT_UI_LAYOUT;
  }
}

function prettyNumber(value: number, digits = 2): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function safeSlug(name: string): string {
  return (name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'beescad_project');
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function findLatestSketch(doc: CadDocument, selectedFeatureId: string | null): SketchFeature | null {
  if (selectedFeatureId) {
    const selected = doc.features.find((f) => f.id === selectedFeatureId);
    if (selected?.kind === 'sketch') return selected;
  }
  for (let i = doc.features.length - 1; i >= 0; i--) {
    const feature = doc.features[i];
    if (feature.kind === 'sketch' && !feature.suppressed) return feature;
  }
  return null;
}

function DefaultMaterialPanel({
  doc,
  scene,
  onMaterial,
}: {
  doc: CadDocument;
  scene: ReturnType<typeof useEvaluatedScene>['scene'];
  onMaterial: (id: string) => void;
}) {
  return (
    <div className="physics-panel">
      <div className="panel-heading"><span>Материал проекта</span><span className="panel-count">РАСЧЁТ</span></div>
      <label className="prop-row default-material-row"><span>По умолчанию</span><select className="select" value={doc.defaultMaterialId} onChange={(e) => onMaterial(e.target.value)}>{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <div className="material-note">Новые тела будут использовать этот материал. Масса оценивается по плотности и объёму сетки.</div>
      <div className="inspector-section-title">Сборка · все видимые тела</div>
      <div className="stat-cards">
        <div className="stat-card"><span>Общий объём</span><b>{prettyNumber((scene?.totalVolumeMm3 || 0) / 1000)} см³</b></div>
        <div className="stat-card"><span>Расчётная масса</span><b>{prettyNumber(scene?.totalMassGrams || 0)} г</b></div>
        <div className="stat-card"><span>Площадь поверхности</span><b>{prettyNumber((scene?.totalAreaMm2 || 0) / 100)} см²</b></div>
        <div className="stat-card"><span>Треугольников</span><b>{(scene?.totalTriangles || 0).toLocaleString('ru-RU')}</b></div>
      </div>
    </div>
  );
}

function DfmPanel({ scene }: { scene: ReturnType<typeof useEvaluatedScene>['scene'] }) {
  const issues = scene?.issues || [];
  return (
    <div className="dfm-panel">
      <div className="panel-heading"><span>Проверка геометрии</span><span className={'dfm-count' + (issues.some((i) => i.severity === 'error') ? ' error' : '')}>{issues.length ? issues.length : 'OK'}</span></div>
      {issues.length ? issues.map((issue) => <div className={'dfm-item ' + issue.severity} key={issue.id}><b>{issue.severity === 'error' ? 'Ошибка' : 'Совет'}</b><span>{issue.message}</span></div>) : <div className="dfm-clear"><span>✓</span><div><b>Критичных проблем не найдено</b><small>Базовые проверки габаритов и толщины стенок</small></div></div>}
      <p className="field-help">DFM-анализ прототипный: перед производством перепроверьте допуски, стенки и крепёж.</p>
    </div>
  );
}

function Timeline({
  doc,
  selectedId,
  onSelect,
  onRollback,
}: {
  doc: CadDocument;
  selectedId: string | null;
  onSelect: (feature: CadFeature) => void;
  onRollback: (index: number) => void;
}) {
  const effective = doc.rollbackIndex < 0 ? doc.features.length - 1 : doc.rollbackIndex;
  return (
    <div className="timeline-bar">
      <div className="timeline-label"><span className="timeline-icon">◷</span><span>ИСТОРИЯ ПОСТРОЕНИЯ</span></div>
      <div className="timeline-track">
        {doc.features.map((feature, index) => (
          <button
            type="button"
            key={feature.id}
            className={'tl-node' + (selectedId === feature.id ? ' selected' : '') + (feature.suppressed ? ' suppressed' : '') + (index > effective ? ' rolled-out' : '')}
            title={`${index + 1}. ${feature.name} · нажмите, чтобы выбрать; правый клик — откат`}
            onClick={() => onSelect(feature)}
            onContextMenu={(e) => { e.preventDefault(); onRollback(index); }}
          >
            <span className="tl-index">{String(index + 1).padStart(2, '0')}</span>
            <span>{feature.name}</span>
          </button>
        ))}
      </div>
      <div className="rollback-control">
        <label title="Переместить маркер истории построения"><span>Откат</span><input aria-label="Маркер отката истории" type="range" min={-1} max={Math.max(-1, doc.features.length - 1)} value={doc.rollbackIndex} onChange={(e) => onRollback(Number(e.target.value))} /><b>{doc.rollbackIndex < 0 ? 'Все' : `${doc.rollbackIndex + 1}/${doc.features.length}`}</b></label>
      </div>
    </div>
  );
}

function SketchDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (args: { plane: 'XY' | 'XZ' | 'YZ'; offset: number; kind: SketchShape['kind']; width: number; height: number; radius: number }) => void;
}) {
  const [plane, setPlane] = useState<'XY' | 'XZ' | 'YZ'>('XY');
  const [kind, setKind] = useState<SketchShape['kind']>('rect');
  const [offset, setOffset] = useState(0);
  const [width, setWidth] = useState(40);
  const [height, setHeight] = useState(32);
  const [radius, setRadius] = useState(0);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="modal create-modal" role="dialog" aria-modal="true" aria-label="Создать эскиз">
        <div className="modal-head"><h3><IconSketch /> Новый 2D-эскиз</h3><button className="icon-close" type="button" onClick={onClose} aria-label="Закрыть">×</button></div>
        <p className="muted" style={{ marginTop: 0 }}>Выберите плоскость и замкнутый профиль. Размеры можно скорректировать в инспекторе после создания.</p>
        <div className="form-grid">
          <label className="form-label">Рабочая плоскость<select className="select" value={plane} onChange={(e) => setPlane(e.target.value as typeof plane)}><option value="XY">XY · основание</option><option value="XZ">XZ · фронтальная</option><option value="YZ">YZ · боковая</option></select></label>
          <label className="form-label">Профиль<select className="select" value={kind} onChange={(e) => setKind(e.target.value as SketchShape['kind'])}><option value="rect">Прямоугольник</option><option value="circle">Круг</option><option value="ring">Кольцо / втулка</option><option value="polygon">Многоугольник</option><option value="slot">Продолговатое отверстие</option></select></label>
          <label className="form-label">Ширина (мм)<input className="input mono" type="number" min="1" value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label>
          {kind !== 'circle' && <label className="form-label">Высота (мм)<input className="input mono" type="number" min="1" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>}
          {kind === 'circle' && <label className="form-label">Диаметр (мм)<input className="input mono" type="number" min="1" value={width} onChange={(e) => { const v = Number(e.target.value); setWidth(v); setRadius(v / 2); }} /></label>}
          <label className="form-label">Смещение от начала (мм)<input className="input mono" type="number" value={offset} onChange={(e) => setOffset(Number(e.target.value))} /></label>
          {kind === 'rect' && <label className="form-label">Скругление углов (мм)<input className="input mono" type="number" min="0" value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></label>}
        </div>
        <div className="modal-actions"><button className="btn" type="button" onClick={onClose}>Отмена</button><button className="btn primary" type="button" onClick={() => onCreate({ plane, offset, kind, width: Math.max(1, width), height: Math.max(1, height), radius: Math.max(0, radius) })}>Создать эскиз</button></div>
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);
  return <div className="app-toast" role="status"><span>{message}</span><button type="button" onClick={onClose} aria-label="Закрыть">×</button></div>;
}

function App() {
  const [doc, setDoc] = useState<CadDocument>(loadDocument);
  const docRef = useRef(doc);
  docRef.current = doc;
  const undoRef = useRef<CadDocument[]>([]);
  const redoRef = useRef<CadDocument[]>([]);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [colors, setColors] = useState<CustomColors>(loadCustomColors);
  const [layout, setLayout] = useState<UiLayout>(loadLayout);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(() => doc.features.at(-1)?.id || null);
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [viewStyle, setViewStyle] = useState<ViewStyle>('shaded_edges');
  const [showGrid, setShowGrid] = useState(true);
  const [showPlanes, setShowPlanes] = useState(true);
  const [fitReq, setFitReq] = useState(0);
  const [cameraPresetReq, setCameraPresetReq] = useState<{ preset: CameraPreset; seq: number }>({ preset: 'iso', seq: 0 });
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [cursor3D, setCursor3D] = useState<[number, number, number]>([0, 0, 0]);
  const [sketchDialog, setSketchDialog] = useState(false);
  const [paramsDialog, setParamsDialog] = useState(false);
  const [uiBuilderOpen, setUiBuilderOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const openFileRef = useRef<HTMLInputElement>(null);
  const [isDirty, setIsDirty] = useState(false);
  const perf = usePerf();
  const evaluation = useEvaluatedScene(doc, perf.profile);
  const scene = evaluation.scene;
  const updater = useUpdater(true);

  const selectedFeature = useMemo(
    () => doc.features.find((f) => f.id === selectedFeatureId) || null,
    [doc.features, selectedFeatureId],
  );
  const selectedBody = useMemo(() => {
    if (!scene) return null;
    const feature = doc.features.find((f) => f.id === selectedFeatureId);
    const targetId = feature && ('targetBodyId' in feature ? feature.targetBodyId : ('sourceBodyId' in feature ? feature.sourceBodyId : undefined));
    return scene.bodies.find((b) => b.id === selectedBodyId || b.featureId === selectedFeatureId || b.id === targetId || b.featureId === targetId) || null;
  }, [doc.features, scene, selectedBodyId, selectedFeatureId]);

  const commitDoc = useCallback((next: CadDocument, undoable = true) => {
    const current = docRef.current;
    if (next === current) return;
    if (undoable) {
      undoRef.current = [...undoRef.current.slice(-49), current];
      redoRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setIsDirty(true);
  }, []);

  const updateDocument = useCallback((fn: (current: CadDocument) => CadDocument) => {
    commitDoc(fn(docRef.current));
  }, [commitDoc]);

  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
    applyCustomColors(colors);
    saveCustomColors(colors);
  }, [theme, colors]);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }, [layout]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const text = JSON.stringify(doc);
        // Don't exceed browser localStorage quotas for giant imported meshes.
        if (text.length < 4_000_000) {
          localStorage.setItem(AUTOSAVE_KEY, text);
          setSavedAt(Date.now());
          setIsDirty(false);
        }
      } catch {
        showToast('Автосохранение недоступно: экспортируйте проект в файл.');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [doc, showToast]);

  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return showToast('Нечего отменять.');
    redoRef.current = [...redoRef.current.slice(-49), docRef.current];
    docRef.current = prev;
    setDoc(prev);
    setIsDirty(true);
    showToast('Действие отменено.');
  }, [showToast]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return showToast('Нечего повторять.');
    undoRef.current = [...undoRef.current.slice(-49), docRef.current];
    docRef.current = next;
    setDoc(next);
    setIsDirty(true);
    showToast('Действие повторено.');
  }, [showToast]);

  const addFeature = useCallback((feature: CadFeature) => {
    updateDocument((current) => ({ ...current, features: [...current.features, feature], rollbackIndex: -1 }));
    setSelectedFeatureId(feature.id);
    setSelectedBodyId(null);
    showToast(`Добавлена операция «${feature.name}».`);
  }, [showToast, updateDocument]);

  const addSketch = useCallback((args: { plane: 'XY' | 'XZ' | 'YZ'; offset: number; kind: SketchShape['kind']; width: number; height: number; radius: number }) => {
    const id = makeId('sketch');
    const shape: SketchShape = {
      id: makeId('profile'),
      kind: args.kind,
      cx: 0,
      cy: 0,
      width: args.width,
      height: args.height,
      radius: args.kind === 'circle' ? args.width * 0.5 : args.radius,
      innerRadius: args.kind === 'ring' ? Math.max(0.5, args.width * 0.22) : 0,
      sides: args.kind === 'polygon' ? 6 : 4,
      rotationDeg: 0,
    };
    const feature: SketchFeature = {
      id,
      kind: 'sketch',
      name: `Эскиз ${docRef.current.features.filter((f) => f.kind === 'sketch').length + 1} · ${args.plane}`,
      plane: args.plane,
      planeOffset: args.offset,
      shapes: [shape],
      constraints: [] as SketchConstraint[],
      visible: true,
    };
    addFeature(feature);
    setSketchDialog(false);
    setTool('sketch');
  }, [addFeature]);

  const addSketchShape = useCallback((id: string, kind: 'rect' | 'circle') => {
    updateDocument((current) => ({
      ...current,
      features: current.features.map((f) => {
        if (f.id !== id || f.kind !== 'sketch') return f;
        const last = f.shapes.at(-1);
        const shape: SketchShape = {
          id: makeId('profile'), kind,
          cx: last ? last.cx + (last.width || 30) * 0.65 : 0, cy: 0,
          width: kind === 'circle' ? 14 : 28,
          height: kind === 'circle' ? 14 : 20,
          radius: kind === 'circle' ? 7 : 0,
          innerRadius: 0, sides: 4, rotationDeg: 0,
        };
        return { ...f, shapes: [...f.shapes, shape] };
      }),
    }));
    showToast(kind === 'circle' ? 'Добавлен круг в эскиз.' : 'Добавлен прямоугольник в эскиз.');
  }, [showToast, updateDocument]);

  const patchSketchShape = useCallback((featureId: string, shapeId: string, patch: Partial<SketchShape>) => {
    updateDocument((current) => ({
      ...current,
      features: current.features.map((feature) => feature.id === featureId && feature.kind === 'sketch'
        ? { ...feature, shapes: feature.shapes.map((shape) => shape.id === shapeId ? { ...shape, ...patch } : shape) }
        : feature),
    }));
  }, [updateDocument]);

  const addExtrude = useCallback(() => {
    const sketch = findLatestSketch(docRef.current, selectedFeatureId);
    if (!sketch) {
      setSketchDialog(true);
      showToast('Сначала создайте эскиз профиля.');
      return;
    }
    addFeature({
      id: makeId('extrude'),
      kind: 'extrude',
      name: `Выдавливание ${docRef.current.features.filter((f) => f.kind === 'extrude').length + 1}`,
      sketchId: sketch.id,
      distance: 20,
      symmetric: false,
      draftDeg: 0,
      operation: 'new',
      materialId: docRef.current.defaultMaterialId,
    });
    setTool('extrude');
  }, [addFeature, selectedFeatureId, showToast]);

  const addRevolve = useCallback(() => {
    const sketch = findLatestSketch(docRef.current, selectedFeatureId);
    if (!sketch) {
      setSketchDialog(true);
      showToast('Создайте эскиз для операции Вращение.');
      return;
    }
    addFeature({
      id: makeId('revolve'),
      kind: 'revolve',
      name: `Вращение ${docRef.current.features.filter((f) => f.kind === 'revolve').length + 1}`,
      sketchId: sketch.id,
      axis: 'Y',
      angleDeg: 360,
      operation: 'new',
      materialId: docRef.current.defaultMaterialId,
    });
    setTool('revolve');
  }, [addFeature, selectedFeatureId, showToast]);

  const addPrimitive = useCallback((shape: PrimitiveKind, name: string, values: { width: number; height: number; depth: number; radius: number; radius2: number }) => {
    addFeature({
      id: makeId('primitive'),
      kind: 'primitive',
      name,
      shape,
      width: values.width,
      height: values.height,
      depth: values.depth,
      radius: values.radius,
      radius2: values.radius2,
      wall: shape === 'pipe' ? Math.max(1, values.radius2) : 0,
      operation: 'new',
      materialId: docRef.current.defaultMaterialId,
    });
  }, [addFeature]);

  const addStandardPart = useCallback((kind: StandardPartKind, defaults: Omit<StandardPartFeature, 'id' | 'kind' | 'name'>, name: string) => {
    addFeature({ id: makeId('standard'), kind: 'standard_part', name, ...defaults } as StandardPartFeature);
  }, [addFeature]);

  const currentTargetBody = useCallback((): EvaluatedBody | null => {
    const bodies = evaluation.scene?.bodies || [];
    return bodies.find((b) => b.id === selectedBodyId || b.featureId === selectedFeatureId) || bodies.filter((b) => b.visible).at(-1) || null;
  }, [evaluation.scene, selectedBodyId, selectedFeatureId]);

  const addHole = useCallback(() => {
    const target = currentTargetBody();
    if (!target) return showToast('Сначала создайте твердотельное тело для отверстия.');
    addFeature({
      id: makeId('hole'),
      kind: 'hole',
      name: `Отверстие ${docRef.current.features.filter((f) => f.kind === 'hole').length + 1} · М3`,
      holeType: 'simple',
      diameter: 3.4,
      depth: Math.max(3, target.bbox.size[1]),
      cbDiameter: 6.5,
      cbDepth: 3.3,
      csAngleDeg: 90,
      axis: 'Y',
      tx: target.bbox.center[0],
      ty: target.bbox.max[1],
      tz: target.bbox.center[2],
      targetBodyId: target.id,
    });
    setTool('hole');
  }, [addFeature, currentTargetBody, showToast]);

  const addModifier = useCallback((kind: 'fillet' | 'chamfer' | 'shell' | 'pattern_linear' | 'pattern_circular' | 'mirror') => {
    const target = currentTargetBody();
    if (!target) return showToast('Сначала выберите или создайте 3D-тело.');
    const index = docRef.current.features.filter((f) => f.kind === kind).length + 1;
    if (kind === 'fillet') addFeature({ id: makeId('fillet'), kind, name: `Скругление ${index}`, radius: 1.5, edgeGroup: 'top', targetBodyId: target.id });
    if (kind === 'chamfer') addFeature({ id: makeId('chamfer'), kind, name: `Фаска ${index}`, distance: 1, angleDeg: 45, edgeGroup: 'top', targetBodyId: target.id });
    if (kind === 'shell') addFeature({ id: makeId('shell'), kind, name: `Оболочка ${index}`, thickness: 2, openFace: 'top', targetBodyId: target.id });
    if (kind === 'pattern_linear') addFeature({ id: makeId('pattern'), kind, name: `Линейный массив ${index}`, sourceBodyId: target.id, countX: 2, countY: 1, countZ: 1, spacingX: Math.max(30, target.bbox.size[0] + 5), spacingY: 0, spacingZ: 0 });
    if (kind === 'pattern_circular') addFeature({ id: makeId('pattern'), kind, name: `Круговой массив ${index}`, sourceBodyId: target.id, axis: 'Y', count: 6, totalAngleDeg: 360, radiusOffset: 0 });
    if (kind === 'mirror') addFeature({ id: makeId('mirror'), kind, name: `Зеркальное отражение ${index}`, sourceBodyId: target.id, mirrorPlane: 'YZ', offset: 0 });
  }, [addFeature, currentTargetBody, showToast]);

  const patchFeature = useCallback((id: string, patch: Record<string, unknown>) => {
    updateDocument((current) => ({
      ...current,
      features: current.features.map((feature) => feature.id === id ? { ...feature, ...patch } as CadFeature : feature),
    }));
  }, [updateDocument]);

  const renameFeature = useCallback((id: string, name: string) => patchFeature(id, { name }), [patchFeature]);
  const setFeatureMaterial = useCallback((id: string, materialId: string) => patchFeature(id, { materialId }), [patchFeature]);

  const deleteFeature = useCallback((id: string) => {
    const target = docRef.current.features.find((f) => f.id === id);
    if (!target) return;
    updateDocument((current) => ({
      ...current,
      features: current.features.filter((f) => {
        if (f.id === id) return false;
        if (target.kind === 'sketch' && (f.kind === 'extrude' || f.kind === 'revolve') && f.sketchId === id) return false;
        return true;
      }),
      rollbackIndex: -1,
    }));
    setSelectedFeatureId(null);
    setSelectedBodyId(null);
    showToast(`Операция «${target.name}» удалена.`);
  }, [showToast, updateDocument]);

  const toggleVisible = useCallback((id: string) => {
    const feature = docRef.current.features.find((f) => f.id === id);
    if (feature) patchFeature(id, { visible: feature.visible === false });
  }, [patchFeature]);

  const toggleSuppressed = useCallback((id: string) => {
    const feature = docRef.current.features.find((f) => f.id === id);
    if (feature) patchFeature(id, { suppressed: !feature.suppressed });
  }, [patchFeature]);

  const selectFeature = useCallback((feature: CadFeature) => {
    setSelectedFeatureId(feature.id);
    const targetId = 'targetBodyId' in feature ? feature.targetBodyId : ('sourceBodyId' in feature ? feature.sourceBodyId : undefined);
    const body = evaluation.scene?.bodies.find((b) => b.featureId === feature.id || b.id === targetId || b.featureId === targetId);
    setSelectedBodyId(body?.id || null);
  }, [evaluation.scene]);

  const handleSelectBody = useCallback((bodyId: string | null, featureId: string | null) => {
    setSelectedBodyId(bodyId);
    setSelectedFeatureId(featureId);
    setTool('select');
  }, []);

  const rollback = useCallback((index: number) => {
    updateDocument((current) => ({ ...current, rollbackIndex: index }));
  }, [updateDocument]);

  const setDefaultMaterial = useCallback((materialId: string) => {
    updateDocument((current) => ({ ...current, defaultMaterialId: materialId }));
  }, [updateDocument]);

  const loadTemplate = useCallback((id: string) => {
    const template = CAD_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    const next = template.build();
    commitDoc(next);
    setSelectedFeatureId(next.features.at(-1)?.id || null);
    setSelectedBodyId(null);
    showToast(`Открыт шаблон «${template.name}».`);
  }, [commitDoc, showToast]);

  const newProject = useCallback(() => {
    if (isDirty && !window.confirm('Есть несохранённые изменения. Создать новый проект?')) return;
    const next = createEmptyDoc();
    commitDoc(next);
    setSelectedFeatureId(next.features.at(-1)?.id || null);
    setSelectedBodyId(null);
    showToast('Создан новый проект.');
  }, [commitDoc, isDirty, showToast]);

  const saveProject = useCallback(() => {
    const text = JSON.stringify(docRef.current, null, 2);
    saveBlob(new Blob([text], { type: 'application/json' }), `${safeSlug(docRef.current.name)}.beescad.json`);
    setIsDirty(false);
    showToast('Проект сохранён в файл .beescad.json.');
  }, [showToast]);

  const openProjectFile = useCallback(async (file: File) => {
    try {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'json') {
        const parsed = JSON.parse(await file.text()) as CadDocument;
        if (!parsed || !Array.isArray(parsed.features)) throw new Error('Файл не похож на проект BeesCAD.');
        commitDoc({ ...parsed, version: 1 });
        setSelectedFeatureId(parsed.features.at(-1)?.id || null);
        setSelectedBodyId(null);
        showToast(`Открыт проект «${parsed.name || file.name}».`);
      } else if (ext === 'stl') {
        const mesh = parseStlFile(await file.arrayBuffer(), file.name);
        addFeature({ ...mesh, materialId: docRef.current.defaultMaterialId });
      } else if (ext === 'obj') {
        const mesh = parseObjFile(await file.text(), file.name);
        addFeature({ ...mesh, materialId: docRef.current.defaultMaterialId });
      } else {
        throw new Error('Поддерживаются проекты .beescad.json, STL и OBJ.');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось открыть файл.');
    }
  }, [addFeature, commitDoc, showToast]);

  const exportFile = useCallback((format: 'stl-bin' | 'stl-ascii' | 'step' | 'obj' | 'svg' | 'dxf' | 'csv') => {
    if (!scene) return showToast('Модель ещё пересчитывается.');
    const base = safeSlug(docRef.current.name);
    if (format === 'stl-bin') {
      const bytes = exportStlBinary(scene);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      saveBlob(new Blob([buffer], { type: 'model/stl' }), `${base}.stl`);
    }
    if (format === 'stl-ascii') saveBlob(new Blob([exportStlAscii(scene, base)], { type: 'model/stl' }), `${base}-ascii.stl`);
    if (format === 'step') saveBlob(new Blob([exportStepAp214(scene, docRef.current)], { type: 'application/step' }), `${base}.step`);
    if (format === 'obj') saveBlob(new Blob([exportObj(scene, docRef.current)], { type: 'text/plain' }), `${base}.obj`);
    if (format === 'svg') saveBlob(new Blob([exportProjectionSvg(scene, docRef.current)], { type: 'image/svg+xml' }), `${base}-drawing.svg`);
    if (format === 'dxf') saveBlob(new Blob([exportProjectionDxf(scene)], { type: 'application/dxf' }), `${base}-edges.dxf`);
    if (format === 'csv') saveBlob(new Blob([exportBomCsv(scene)], { type: 'text/csv;charset=utf-8' }), `${base}-bom.csv`);
    showToast(`Экспорт ${format.toUpperCase()} подготовлен.`);
  }, [scene, showToast]);

  const setCamera = useCallback((preset: CameraPreset) => setCameraPresetReq((s) => ({ preset, seq: s.seq + 1 })), []);
  const cursorThrottleRef = useRef(0);
  const handleCursor3D = useCallback((pos: [number, number, number]) => {
    const now = performance.now();
    const minInterval = getPerfConfig().profile === 'low' ? 90 : getPerfConfig().profile === 'balanced' ? 45 : 20;
    if (now - cursorThrottleRef.current < minInterval) return;
    cursorThrottleRef.current = now;
    setCursor3D((prev) => prev[0] === pos[0] && prev[1] === pos[1] && prev[2] === pos[2] ? prev : pos);
  }, []);
  const toggleSection = useCallback(() => updateDocument((current) => ({ ...current, section: { ...current.section, enabled: !current.section.enabled } })), [updateDocument]);
  const updateSection = useCallback((key: string, value: unknown) => updateDocument((current) => ({ ...current, section: { ...current.section, [key]: value } })), [updateDocument]);

  const moveSelected = useCallback(() => {
    if (!selectedFeature || !scene?.bodies.some((b) => b.featureId === selectedFeature.id)) {
      showToast('Выберите базовое 3D-тело или импортированную сетку для перемещения.');
      return;
    }
    const dx = Number(window.prompt('Смещение по X, мм', String(selectedFeature.tx || 0)));
    if (!Number.isFinite(dx)) return;
    const dy = Number(window.prompt('Смещение по Y, мм', String(selectedFeature.ty || 0)));
    if (!Number.isFinite(dy)) return;
    const dz = Number(window.prompt('Смещение по Z, мм', String(selectedFeature.tz || 0)));
    if (!Number.isFinite(dz)) return;
    patchFeature(selectedFeature.id, { tx: dx, ty: dy, tz: dz });
  }, [patchFeature, scene, selectedFeature, showToast]);

  const changeTheme = useCallback(() => setTheme((t) => t === 'dark' ? 'light' : 'dark'), []);
  const togglePanel = useCallback((id: PanelId) => {
    setLayout((current) => ({ ...current, panels: current.panels.map((p) => p.id === id ? { ...p, visible: !p.visible } : p) }));
  }, []);

  // Горячие клавиши для частых CAD-команд (игнорируем поля ввода и диалоги).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
        else if (e.key.toLowerCase() === 'o') { e.preventDefault(); openFileRef.current?.click(); }
        else if (e.key.toLowerCase() === 'n') { e.preventDefault(); newProject(); }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'v') { setTool('select'); setMeasurePoints([]); }
      else if (k === 's') setSketchDialog(true);
      else if (k === 'e') addExtrude();
      else if (k === 'r') addRevolve();
      else if (k === 'h') addHole();
      else if (k === 'f') addModifier('fillet');
      else if (k === 'c') addModifier('chamfer');
      else if (k === 'm') { setTool('measure'); setMeasurePoints([]); }
      else if (k === 'x') toggleSection();
      else if (k === '0' || k === 'home') setFitReq((n) => n + 1);
      else if (k === '1') setCamera('front');
      else if (k === '2') setCamera('top');
      else if (k === '3') setCamera('right');
      else if (k === 'delete' || k === 'backspace') { if (selectedFeature) deleteFeature(selectedFeature.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addExtrude, addHole, addModifier, addRevolve, deleteFeature, newProject, redo, saveProject, selectedFeature, setCamera, toggleSection, undo]);

  const leftPanels = layout.panels.filter((p) => p.side === 'left' && p.visible);
  const rightPanels = layout.panels.filter((p) => p.side === 'right' && p.visible);
  const bodyCount = scene?.bodies.filter((b) => b.visible).length || 0;
  const volume = scene?.totalVolumeMm3 || 0;
  const mass = scene?.totalMassGrams || 0;

  return (
    <div className="app">
      <input
        ref={openFileRef}
        type="file"
        className="visually-hidden"
        accept=".beescad.json,.json,.stl,.obj"
        onChange={(e) => { const file = e.target.files?.[0]; if (file) void openProjectFile(file); e.currentTarget.value = ''; }}
      />

      <header className="toolbar">
        <div className="brand" title="BeesCAD — параметрическое инженерное 3D-моделирование">
          <img className="brand-logo" src="/beescad.svg" alt="" />
          <span>Bees<em>CAD</em></span>
          <span className="brand-badge">BETA</span>
        </div>
        <span className="tb-sep" />
        <MenuBtn label="Файл" icon={<IconFolder />} title="Операции с проектом">
          {(close) => <>
            <button className="menu-item" type="button" onClick={() => { close(); newProject(); }}><span className="menu-item-left"><IconPlus />Новый проект</span><kbd>Ctrl+N</kbd></button>
            <button className="menu-item" type="button" onClick={() => { close(); openFileRef.current?.click(); }}><span className="menu-item-left"><IconFolder />Открыть проект / импорт…</span><kbd>Ctrl+O</kbd></button>
            <button className="menu-item" type="button" onClick={() => { close(); saveProject(); }}><span className="menu-item-left"><IconDownload />Сохранить проект как…</span><kbd>Ctrl+S</kbd></button>
            <div className="menu-sep" /><div className="menu-sec-label">Шаблоны</div>
            {CAD_TEMPLATES.map((t) => <button className="menu-item" type="button" key={t.id} onClick={() => { close(); loadTemplate(t.id); }}><span className="menu-item-left"><IconCube3D />{t.name}</span></button>)}
          </>}
        </MenuBtn>
        <div className="tb-group undo-group">
          <button className="tb-btn icon-only" type="button" title="Отменить · Ctrl+Z" onClick={undo} disabled={!undoRef.current.length}><IconUndo /></button>
          <button className="tb-btn icon-only" type="button" title="Повторить · Ctrl+Y" onClick={redo} disabled={!redoRef.current.length}><IconRedo /></button>
        </div>
        <span className="tb-sep" />
        <div className="tb-group core-tools">
          <button className={'tb-btn wide' + (tool === 'select' ? ' active' : '')} type="button" onClick={() => setTool('select')} title="Выбор · V"><span className="tool-cursor">↖</span>Выбор</button>
          <SplitBtn label="Эскиз" icon={<IconSketch />} title="Создать новый эскиз" onClick={() => setSketchDialog(true)}>
            {(close) => <>
              <button className="menu-item" type="button" onClick={() => { close(); setSketchDialog(true); }}>Новый эскиз на плоскости…</button>
              {doc.features.filter((f) => f.kind === 'sketch').map((f) => <button className="menu-item" key={f.id} type="button" onClick={() => { close(); selectFeature(f); setTool('sketch'); }}>{f.name}</button>)}
            </>}
          </SplitBtn>
          <button className="tb-btn wide" type="button" onClick={addExtrude} title="Выдавливание · E"><span className="extrude-glyph">↥</span>Выдавить</button>
          <button className="tb-btn wide" type="button" onClick={addRevolve} title="Вращение · R"><IconRevolve />Вращение</button>
          <MenuBtn label="Создать" icon={<IconPlus />} title="Твердотельная операция">
            {(close) => <>
              <div className="menu-sec-label">Тела</div>
              <button className="menu-item" type="button" onClick={() => { close(); setSketchDialog(true); }}><span className="menu-item-left"><IconSketch />Новый эскиз…</span><kbd>S</kbd></button>
              <button className="menu-item" type="button" onClick={() => { close(); addExtrude(); }}><span className="menu-item-left">↥ Выдавливание</span><kbd>E</kbd></button>
              <button className="menu-item" type="button" onClick={() => { close(); addRevolve(); }}><span className="menu-item-left"><IconRevolve />Вращение</span><kbd>R</kbd></button>
              <div className="menu-sep" /><div className="menu-sec-label">Примитивы</div>
              {(['box','cylinder','sphere','cone','torus','pipe','wedge'] as PrimitiveKind[]).map((kind) => {
                const names: Record<PrimitiveKind,string> = {box:'Параллелепипед',cylinder:'Цилиндр',sphere:'Сфера',cone:'Конус',torus:'Тор',pipe:'Труба / втулка',wedge:'Клин'};
                const defaults = STANDARD_PARTS_CATALOG[0].defaults;
                const values = kind === 'box' ? {width:30,height:20,depth:24,radius:10,radius2:4} : kind === 'sphere' ? {width:20,height:20,depth:20,radius:10,radius2:0} : kind === 'cylinder' ? {width:20,height:24,depth:20,radius:10,radius2:0} : {width:24,height:24,depth:24,radius:12,radius2:4};
                return <button className="menu-item" type="button" key={kind} onClick={() => { close(); addPrimitive(kind, names[kind], values); }}>{names[kind]}</button>;
              })}
              <div className="menu-sep" /><div className="menu-sec-label">Обработка</div>
              <button className="menu-item" type="button" onClick={() => { close(); addHole(); }}><span className="menu-item-left"><IconHole />Отверстие / Мастер отверстий</span><kbd>H</kbd></button>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('fillet'); }}>Скругление рёбер</button>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('chamfer'); }}>Фаска</button>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('shell'); }}><span className="menu-item-left"><IconShell />Оболочка</span></button>
              <button className="menu-item" type="button" onClick={() => { close(); moveSelected(); }}>Переместить выбранное тело…</button>
            </>}
          </MenuBtn>
          <MenuBtn label="Массив" icon={<IconPattern />} title="Массив и симметрия">
            {(close) => <>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('pattern_linear'); }}>Линейный массив</button>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('pattern_circular'); }}>Круговой массив</button>
              <button className="menu-item" type="button" onClick={() => { close(); addModifier('mirror'); }}><span className="menu-item-left"><IconMirror />Зеркальное отражение</span></button>
            </>}
          </MenuBtn>
        </div>
        <span className="tb-sep" />
        <MenuBtn label="Вид" icon={<IconCube3D />} title="Управление отображением">
          {(close) => <>
            <div className="menu-sec-label">Стиль визуализации</div>
            {([['shaded_edges','Затенение + рёбра'],['shaded','Затенение'],['wireframe','Каркас'],['xray','Рентген']] as [ViewStyle,string][]).map(([id,label]) => <button key={id} className="menu-item" type="button" onClick={() => { close(); setViewStyle(id); }}><span className="menu-item-left">{viewStyle === id ? <IconCheck /> : <span className="menu-spacer" />}{label}</span></button>)}
            <div className="menu-sep" />
            <button className="menu-item" type="button" onClick={() => { close(); setShowGrid((v) => !v); }}><span className="menu-item-left">{showGrid ? <IconCheck /> : <span className="menu-spacer" />}Координатная сетка</span></button>
            <button className="menu-item" type="button" onClick={() => { close(); setShowPlanes((v) => !v); }}><span className="menu-item-left">{showPlanes ? <IconCheck /> : <span className="menu-spacer" />}Рабочие плоскости</span></button>
            <button className="menu-item" type="button" onClick={() => { close(); toggleSection(); }}><span className="menu-item-left"><IconSection />{doc.section.enabled ? 'Выключить сечение' : 'Анализ сечения'}</span><kbd>X</kbd></button>
            <div className="menu-sep" /><div className="menu-sec-label">Камера</div>
            {([['iso','Изометрия'],['top','Сверху'],['front','Спереди'],['right','Справа'],['left','Слева'],['back','Сзади']] as [CameraPreset,string][]).map(([id,label]) => <button className="menu-item" type="button" key={id} onClick={() => { close(); setCamera(id); }}>{label}</button>)}
            <button className="menu-item" type="button" onClick={() => { close(); setFitReq((n) => n + 1); }}><span className="menu-item-left"><IconFit />Вписать всё</span><kbd>0</kbd></button>
            <div className="menu-sep" /><div className="menu-sec-label">Панели</div>
            {(Object.keys(PANEL_TITLES) as PanelId[]).map((id) => <button className="menu-item" type="button" key={id} onClick={() => { close(); togglePanel(id); }}>{PANEL_TITLES[id]}</button>)}
          </>}
        </MenuBtn>
        <button className={'tb-btn wide' + (tool === 'measure' ? ' active' : '')} type="button" onClick={() => { setTool('measure'); setMeasurePoints([]); }} title="Измерение · M"><IconRuler />Измерить</button>
        <button className={'tb-btn wide' + (doc.section.enabled ? ' active' : '')} type="button" onClick={toggleSection} title="Анализ сечения · X"><IconSection />Сечение</button>
        <span className="tb-spacer" />
        <div className="doc-titlebar"><input aria-label="Название проекта" value={doc.name} onChange={(e) => updateDocument((current) => ({ ...current, name: e.target.value }))} /><span className={'save-state' + (isDirty ? ' dirty' : '')} title={savedAt ? `Автосохранено ${new Date(savedAt).toLocaleTimeString('ru-RU')}` : 'Автосохранение'}>{isDirty ? '●' : '✓'} {isDirty ? 'Изменён' : 'Сохранён'}</span></div>
        <span className="tb-sep" />
        <MenuBtn label="Экспорт" icon={<IconDownload />} title="Экспорт CAD и чертежей" align="right">
          {(close) => <>
            <div className="menu-sec-label">3D-печать и обмен CAD</div>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('stl-bin'); }}>STL · бинарный</button>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('stl-ascii'); }}>STL · ASCII</button>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('step'); }}>STEP · faceted AP214 (экспериментально)</button>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('obj'); }}>Wavefront OBJ</button>
            <div className="menu-sep" /><div className="menu-sec-label">Чертежи и документация</div>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('svg'); }}>Проекции SVG · основная надпись</button>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('dxf'); }}>Контур DXF</button>
            <button className="menu-item" type="button" onClick={() => { close(); exportFile('csv'); }}>Спецификация BOM CSV</button>
            <div className="menu-sep" /><button className="menu-item" type="button" onClick={() => { close(); saveProject(); }}>Проект .beescad.json</button>
          </>}
        </MenuBtn>
        <MenuBtn label="Настройки" icon={<IconSliders />} title="Настройки интерфейса и проекта" align="right">
          {(close) => <>
            <button className="menu-item" type="button" onClick={() => { close(); setParamsDialog(true); }}>Параметры модели (fx)</button>
            <button className="menu-item" type="button" onClick={() => { close(); setUiBuilderOpen(true); }}>Настроить панели</button>
            <button className="menu-item" type="button" onClick={() => { close(); setPaletteOpen(true); }}><span className="menu-item-left"><IconPalette />Палитра цветов</span></button>
            <button className="menu-item" type="button" onClick={() => { close(); changeTheme(); }}><span className="menu-item-left">{theme === 'dark' ? <IconSun /> : <IconMoon />}{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span></button>
            <div className="menu-sep"/><div className="menu-sec-label">Производительность</div>
            {(['auto','high','balanced','low'] as PerfMode[]).map((mode) => <button key={mode} className="menu-item" type="button" onClick={() => { close(); setPerfMode(mode); }}><span className="menu-item-left">{perf.mode === mode ? <IconCheck /> : <span className="menu-spacer" />}{PERF_MODE_LABELS[mode]}</span></button>)}
            <div className="menu-sep"/><button className="menu-item" type="button" onClick={() => { close(); setAboutOpen(true); }}>О BeesCAD…</button>
            <button className="menu-item" type="button" onClick={() => { close(); setShortcutsOpen(true); }}>Горячие клавиши</button>
          </>}
        </MenuBtn>
        {updater.Button}
      </header>

      <main
        className="workspace"
        style={{ gridTemplateColumns: `${leftPanels.length ? `${layout.leftWidth}px` : '0px'} minmax(0, 1fr) ${rightPanels.length ? `${layout.rightWidth}px` : '0px'}` }}
      >
        {leftPanels.length > 0 && <aside className="side side-left">
          {leftPanels.map((p) => <div className="panel-slot" key={p.id}>
            {p.id === 'browser' && <BrowserPanel doc={doc} scene={scene} selectedFeatureId={selectedFeatureId} selectedBodyId={selectedBodyId} onSelectFeature={selectFeature} onToggleVisible={toggleVisible} onToggleSuppressed={toggleSuppressed} onDelete={deleteFeature} />}
            {p.id === 'catalog' && <CatalogPanel onAddPrimitive={addPrimitive} onAddStandard={addStandardPart} />}
            {p.id === 'inspector' && <InspectorPanel doc={doc} scene={scene} feature={selectedFeature} body={selectedBody} busy={evaluation.busy} onPatchFeature={patchFeature} onRenameFeature={renameFeature} onSetFeatureMaterial={setFeatureMaterial} onAddSketchShape={addSketchShape} onPatchSketchShape={patchSketchShape} onSetDefaultMaterial={setDefaultMaterial} onDeleteFeature={deleteFeature} />}
            {p.id === 'physics' && <DefaultMaterialPanel doc={doc} scene={scene} onMaterial={setDefaultMaterial} />}
            {p.id === 'dfm' && <DfmPanel scene={scene} />}
          </div>)}
          {!leftPanels.length && <div className="side-empty">Нет видимых панелей</div>}
        </aside>}

        <section className="main-cad-area">
          <div className="canvas-wrap">
            <div className="viewport-label"><span className="viewport-label-dot" />3D-МОДЕЛЬ <small>· {doc.unit.toUpperCase()} · {viewStyle === 'shaded_edges' ? 'ЗАТЕНЕНИЕ + РЁБРА' : viewStyle.toUpperCase()}</small></div>
            {scene ? <Suspense fallback={<div className="viewport-loading"><span className="loading-cube"><IconCube3D /></span><b>Загрузка 3D-вьюпорта…</b><small>Сцена загружается отдельно от интерфейса</small></div>}><Viewport3D
              doc={doc}
              scene={scene}
              selectedFeatureId={selectedFeatureId}
              selectedBodyId={selectedBodyId}
              activeSketchId={tool === 'sketch' && selectedFeature?.kind === 'sketch' ? selectedFeature.id : null}
              tool={tool}
              viewStyle={viewStyle}
              showGrid={showGrid}
              showPlanes={showPlanes}
              cameraPresetReq={cameraPresetReq}
              fitReq={fitReq}
              theme={theme}
              measurePoints={measurePoints}
              onSelectBody={handleSelectBody}
              onAddMeasurePoint={(p) => setMeasurePoints((prev) => prev.length >= 2 ? [p] : [...prev, p])}
              onCursor3D={handleCursor3D}
            /></Suspense> : <div className="viewport-loading"><span className="loading-cube"><IconCube3D /></span><b>Построение 3D-модели…</b><small>Расчёт геометрии выполняется в фоновом потоке</small></div>}
            <div className="viewport-toolbar-left">
              <div className="viewport-tool-caption">РАБОЧАЯ СИСТЕМА</div>
              <button type="button" className="axis-chip x-axis" onClick={() => setCamera('front')}><i />X</button>
              <button type="button" className="axis-chip y-axis" onClick={() => setCamera('top')}><i />Y</button>
              <button type="button" className="axis-chip z-axis" onClick={() => setCamera('right')}><i />Z</button>
              <div className="tool-dock-sep" />
              <button type="button" className={'dock-btn' + (tool === 'select' ? ' active' : '')} title="Выбор · V" onClick={() => setTool('select')}><span>↖</span></button>
              <button type="button" className={'dock-btn' + (tool === 'measure' ? ' active' : '')} title="Измерить · M" onClick={() => { setTool('measure'); setMeasurePoints([]); }}><IconRuler /></button>
              <button type="button" className={'dock-btn' + (doc.section.enabled ? ' active' : '')} title="Сечение · X" onClick={toggleSection}><IconSection /></button>
            </div>
            <div className="view-hud">
              <div className="viewcube" title="Быстрые виды камеры">
                <button type="button" onClick={() => setCamera('top')}>ВЕРХ</button>
                <div><button type="button" onClick={() => setCamera('left')}>ЛЕВ</button><button className="cube-center" type="button" onClick={() => setCamera('iso')}><IconCube3D /></button><button type="button" onClick={() => setCamera('right')}>ПРАВ</button></div>
                <button type="button" onClick={() => setCamera('front')}>ПЕРЕД</button>
              </div>
              <button type="button" className="view-hud-btn" onClick={() => setFitReq((n) => n + 1)} title="Вписать модель в окно · 0"><IconFit /></button>
            </div>
            <div className="viewport-bottom-controls">
              <button type="button" className="view-pill active" onClick={() => setViewStyle('shaded_edges')}>Затенение + рёбра</button>
              <button type="button" className="view-pill" onClick={() => setViewStyle('wireframe')}>Каркас</button>
              <button type="button" className={'view-pill' + (doc.section.enabled ? ' active' : '')} onClick={toggleSection}><IconSection /> Сечение</button>
            </div>
            {doc.section.enabled && <div className="section-overlay"><IconSection /><span>SECTION ANALYSIS</span><select value={doc.section.axis} onChange={(e) => updateSection('axis', e.target.value)}><option value="X">X</option><option value="Y">Y</option><option value="Z">Z</option></select><input type="range" min={-80} max={80} value={doc.section.offset} onChange={(e) => updateSection('offset', Number(e.target.value))} /><b>{prettyNumber(doc.section.offset)} мм</b><button type="button" onClick={() => updateSection('flip', !doc.section.flip)}>{doc.section.flip ? '→' : '←'}</button></div>}
            {measurePoints.length === 2 && <div className="measure-overlay"><IconRuler /><b>Измерение</b><span>{prettyNumber(Math.hypot(...measurePoints[1].pos.map((v, i) => v - measurePoints[0].pos[i])))} мм</span><button type="button" onClick={() => setMeasurePoints([])}>×</button></div>}
            {tool === 'measure' && measurePoints.length < 2 && <div className="canvas-hint"><b>Измерение:</b> щёлкните по двум точкам модели · {measurePoints.length}/2</div>}
            {tool === 'sketch' && <div className="mode-banner"><span className="mode-banner-badge">2D ЭСКИЗ</span><span>Параметрический профиль · редактируйте размеры в инспекторе</span><button type="button" onClick={() => setTool('select')}>Готово</button></div>}
            {evaluation.error && <div className="scene-error" role="status">Не удалось пересчитать модель: {evaluation.error}</div>}
          </div>
          <Timeline doc={doc} selectedId={selectedFeatureId} onSelect={selectFeature} onRollback={rollback} />
        </section>

        {rightPanels.length > 0 && <aside className="side side-right">
          {rightPanels.map((p) => <div className="panel-slot" key={p.id}>
            {p.id === 'browser' && <BrowserPanel doc={doc} scene={scene} selectedFeatureId={selectedFeatureId} selectedBodyId={selectedBodyId} onSelectFeature={selectFeature} onToggleVisible={toggleVisible} onToggleSuppressed={toggleSuppressed} onDelete={deleteFeature} />}
            {p.id === 'catalog' && <CatalogPanel onAddPrimitive={addPrimitive} onAddStandard={addStandardPart} />}
            {p.id === 'inspector' && <InspectorPanel doc={doc} scene={scene} feature={selectedFeature} body={selectedBody} busy={evaluation.busy} onPatchFeature={patchFeature} onRenameFeature={renameFeature} onSetFeatureMaterial={setFeatureMaterial} onAddSketchShape={addSketchShape} onPatchSketchShape={patchSketchShape} onSetDefaultMaterial={setDefaultMaterial} onDeleteFeature={deleteFeature} />}
            {p.id === 'physics' && <DefaultMaterialPanel doc={doc} scene={scene} onMaterial={setDefaultMaterial} />}
            {p.id === 'dfm' && <DfmPanel scene={scene} />}
          </div>)}
        </aside>}
      </main>

      <footer className="status">
        <span className="status-ready"><i />{evaluation.busy ? 'Пересчёт…' : 'Готово'}</span>
        <span>Элементов <b>{doc.features.length}</b></span>
        <span>Тел <b>{bodyCount}</b></span>
        <span>Объём <b>{prettyNumber(volume / 1000)} см³</b></span>
        <span>Масса <b>{prettyNumber(mass)} г</b></span>
        <span className="status-spacer" />
        <span className="status-coords mono">X {prettyNumber(cursor3D[0], 1)} · Y {prettyNumber(cursor3D[1], 1)} · Z {prettyNumber(cursor3D[2], 1)} мм</span>
        <span className="perf-status" title={perf.reason}>{perf.profile === 'low' ? 'ЭКО' : perf.profile === 'balanced' ? 'СБАЛ.' : 'ВЫС.'} · DPR {perf.dprCap}×</span>
        <span className="status-units">{doc.unit}</span>
      </footer>

      {sketchDialog && <SketchDialog onClose={() => setSketchDialog(false)} onCreate={addSketch} />}
      {paramsDialog && <ParametersDialog doc={doc} onChange={(parameters: UserParam[]) => updateDocument((current) => ({ ...current, parameters }))} onClose={() => setParamsDialog(false)} />}
      {uiBuilderOpen && <UiBuilderDialog layout={layout} onChange={setLayout} onReset={() => setLayout(DEFAULT_UI_LAYOUT)} onClose={() => setUiBuilderOpen(false)} />}
      {paletteOpen && <ColorPaletteDialog theme={theme} colors={colors} onChangeTheme={setTheme} onChange={setColors} onReset={() => setColors({})} onClose={() => setPaletteOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {updater.Dialog}
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
