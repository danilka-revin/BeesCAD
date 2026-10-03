// Базовые типы параметрического 3D-ядра BeesCAD (в духе Autodesk Fusion 360).

export type PlaneId = 'XY' | 'XZ' | 'YZ';
export type AxisId = 'X' | 'Y' | 'Z';
export type BooleanOp = 'new' | 'join' | 'cut' | 'intersect';

export type ToolId =
  | 'select'
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'hole'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'pattern'
  | 'mirror'
  | 'measure'
  | 'section';

export interface MaterialSpec {
  id: string;
  name: string;
  category: 'Металлы' | 'Пластики (3D-печать / ЧПУ)' | 'Композиты';
  /** Плотность в г/см³ */
  densityGcm3: number;
  /** Предел текучести, МПа */
  yieldStrengthMPa: number;
  color: string;
  metalness: number;
  roughness: number;
}

export const MATERIALS: MaterialSpec[] = [
  {
    id: 'al-6061',
    name: 'Алюминий Д16Т / 6061-T6',
    category: 'Металлы',
    densityGcm3: 2.7,
    yieldStrengthMPa: 276,
    color: '#94a3b8',
    metalness: 0.65,
    roughness: 0.28,
  },
  {
    id: 'steel-304',
    name: 'Сталь нерж. AISI 304 (12Х18Н10Т)',
    category: 'Металлы',
    densityGcm3: 7.93,
    yieldStrengthMPa: 215,
    color: '#cbd5e1',
    metalness: 0.76,
    roughness: 0.24,
  },
  {
    id: 'steel-45',
    name: 'Сталь 45 конструкционная',
    category: 'Металлы',
    densityGcm3: 7.85,
    yieldStrengthMPa: 355,
    color: '#64748b',
    metalness: 0.7,
    roughness: 0.36,
  },
  {
    id: 'titanium-gr5',
    name: 'Титан ВТ6 (Ti-6Al-4V)',
    category: 'Металлы',
    densityGcm3: 4.43,
    yieldStrengthMPa: 880,
    color: '#9ca3af',
    metalness: 0.62,
    roughness: 0.32,
  },
  {
    id: 'brass-ls59',
    name: 'Латунь ЛС59-1 (C36000)',
    category: 'Металлы',
    densityGcm3: 8.47,
    yieldStrengthMPa: 310,
    color: '#eab308',
    metalness: 0.75,
    roughness: 0.26,
  },
  {
    id: 'copper-m1',
    name: 'Медь М1 электротехническая',
    category: 'Металлы',
    densityGcm3: 8.94,
    yieldStrengthMPa: 200,
    color: '#ea580c',
    metalness: 0.76,
    roughness: 0.25,
  },
  {
    id: 'pla',
    name: 'Пластик PLA (3D-печать)',
    category: 'Пластики (3D-печать / ЧПУ)',
    densityGcm3: 1.24,
    yieldStrengthMPa: 55,
    color: '#ffc233',
    metalness: 0.06,
    roughness: 0.45,
  },
  {
    id: 'petg',
    name: 'Пластик PETG',
    category: 'Пластики (3D-печать / ЧПУ)',
    densityGcm3: 1.27,
    yieldStrengthMPa: 50,
    color: '#34d399',
    metalness: 0.1,
    roughness: 0.36,
  },
  {
    id: 'abs',
    name: 'Пластик ABS ударопрочный',
    category: 'Пластики (3D-печать / ЧПУ)',
    densityGcm3: 1.04,
    yieldStrengthMPa: 42,
    color: '#38bdf8',
    metalness: 0.08,
    roughness: 0.44,
  },
  {
    id: 'nylon-pa6',
    name: 'Полиамид PA6 (Капролон)',
    category: 'Пластики (3D-печать / ЧПУ)',
    densityGcm3: 1.14,
    yieldStrengthMPa: 75,
    color: '#e2e8f0',
    metalness: 0.05,
    roughness: 0.52,
  },
  {
    id: 'fr4',
    name: 'Стеклотекстолит FR-4',
    category: 'Композиты',
    densityGcm3: 1.85,
    yieldStrengthMPa: 310,
    color: '#15803d',
    metalness: 0.12,
    roughness: 0.48,
  },
  {
    id: 'carbon-cf',
    name: 'Углепластик CFRP',
    category: 'Композиты',
    densityGcm3: 1.55,
    yieldStrengthMPa: 600,
    color: '#334155',
    metalness: 0.24,
    roughness: 0.3,
  },
];

export function getMaterial(id?: string): MaterialSpec {
  return MATERIALS.find((m) => m.id === id) || MATERIALS[0];
}

// ---------------- 2D-эскиз и зависимости ----------------

export type SketchShapeKind =
  | 'rect'
  | 'circle'
  | 'slot'
  | 'polygon'
  | 'ring'
  | 'l_profile'
  | 't_profile';

export interface SketchShape {
  id: string;
  kind: SketchShapeKind;
  /** Центр в плоскости эскиза (U, V) в мм */
  cx: number;
  cy: number;
  /** Ширина (для rect, slot, l_profile, t_profile) */
  width: number;
  /** Высота (для rect, slot, l_profile, t_profile) */
  height: number;
  /** Радиус внешний (для circle, polygon, ring) или скругление углов */
  radius: number;
  /** Внутренний радиус (для ring) или толщина полки (для l_profile, t_profile) */
  innerRadius: number;
  /** Число сторон многоугольника (3..24) */
  sides: number;
  /** Поворот контура в плоскости эскиза, градусы */
  rotationDeg: number;
  /** Вспомогательная (осевая/конструкционная) геометрия или вырез внутри профиля */
  isHole?: boolean;
}

export type ConstraintKind =
  | 'horizontal'
  | 'vertical'
  | 'concentric'
  | 'equal'
  | 'symmetric'
  | 'fixed'
  | 'tangent';

export interface SketchConstraint {
  id: string;
  kind: ConstraintKind;
  shapeIds: string[];
  label: string;
}

// ---------------- Операции дерева построения (Feature Timeline) ----------------

export type PrimitiveKind =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'cone'
  | 'torus'
  | 'pipe'
  | 'wedge';

export type StandardPartKind =
  | 'hex_bolt'
  | 'socket_bolt'
  | 'hex_nut'
  | 'washer'
  | 'bearing'
  | 'spur_gear'
  | 'flange'
  | 'angle_bracket'
  | 'pcb_enclosure'
  | 'heatsink';

export type FeatureKind =
  | 'sketch'
  | 'extrude'
  | 'revolve'
  | 'primitive'
  | 'standard_part'
  | 'hole'
  | 'fillet'
  | 'chamfer'
  | 'shell'
  | 'pattern_linear'
  | 'pattern_circular'
  | 'mirror'
  | 'transform'
  | 'imported_mesh';

export interface BaseFeature {
  id: string;
  kind: FeatureKind;
  name: string;
  suppressed?: boolean;
  visible?: boolean;
  materialId?: string;
  color?: string;
  /** Позиция/смещение операции в мировых координатах (мм) */
  tx?: number;
  ty?: number;
  tz?: number;
  /** Поворот тела/операции (градусы) */
  rx?: number;
  ry?: number;
  rz?: number;
}

export interface SketchFeature extends BaseFeature {
  kind: 'sketch';
  plane: PlaneId;
  planeOffset: number;
  shapes: SketchShape[];
  constraints: SketchConstraint[];
}

export interface ExtrudeFeature extends BaseFeature {
  kind: 'extrude';
  sketchId: string;
  distance: number;
  symmetric: boolean;
  draftDeg: number;
  operation: BooleanOp;
  targetBodyId?: string;
}

export interface RevolveFeature extends BaseFeature {
  kind: 'revolve';
  sketchId: string;
  axis: AxisId;
  angleDeg: number;
  operation: BooleanOp;
  targetBodyId?: string;
}

export interface PrimitiveFeature extends BaseFeature {
  kind: 'primitive';
  shape: PrimitiveKind;
  width: number;
  depth: number;
  height: number;
  radius: number;
  radius2: number;
  wall: number;
  operation: BooleanOp;
  targetBodyId?: string;
}

export interface StandardPartFeature extends BaseFeature {
  kind: 'standard_part';
  partType: StandardPartKind;
  /** Номинальный диаметр резьбы/вала M (мм) или основной размер */
  nominalDiameter: number;
  /** Длина стержня/детали (мм) */
  length: number;
  /** Шаг резьбы или модуль шестерни m (мм) */
  moduleOrPitch: number;
  /** Число зубьев шестерни / отверстий фланца / рёбер радиатора */
  teethOrCount: number;
  /** Внешний диаметр / ширина корпуса */
  outerWidth: number;
  /** Глубина корпуса */
  outerDepth: number;
  /** Толщина стенки / полки */
  wallThickness: number;
}

export interface HoleFeature extends BaseFeature {
  kind: 'hole';
  holeType: 'simple' | 'counterbore' | 'countersink';
  diameter: number;
  depth: number;
  cbDiameter: number;
  cbDepth: number;
  csAngleDeg: number;
  axis: AxisId;
  targetBodyId?: string;
}

export interface FilletFeature extends BaseFeature {
  kind: 'fillet';
  radius: number;
  edgeGroup: 'top' | 'bottom' | 'vertical' | 'all';
  targetBodyId?: string;
}

export interface ChamferFeature extends BaseFeature {
  kind: 'chamfer';
  distance: number;
  angleDeg: number;
  edgeGroup: 'top' | 'bottom' | 'vertical' | 'all';
  targetBodyId?: string;
}

export interface ShellFeature extends BaseFeature {
  kind: 'shell';
  thickness: number;
  openFace: 'top' | 'bottom' | 'front';
  targetBodyId?: string;
}

export interface LinearPatternFeature extends BaseFeature {
  kind: 'pattern_linear';
  sourceBodyId?: string;
  countX: number;
  countY: number;
  countZ: number;
  spacingX: number;
  spacingY: number;
  spacingZ: number;
}

export interface CircularPatternFeature extends BaseFeature {
  kind: 'pattern_circular';
  sourceBodyId?: string;
  axis: AxisId;
  count: number;
  totalAngleDeg: number;
  radiusOffset: number;
}

export interface MirrorFeature extends BaseFeature {
  kind: 'mirror';
  sourceBodyId?: string;
  mirrorPlane: PlaneId;
  offset: number;
}

export interface TransformFeature extends BaseFeature {
  kind: 'transform';
  targetBodyId?: string;
  scaleFactor: number;
}

export interface ImportedMeshFeature extends BaseFeature {
  kind: 'imported_mesh';
  sourceFormat: 'STL' | 'OBJ';
  positions: number[];
  normals: number[];
  scaleFactor: number;
}

export type CadFeature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | PrimitiveFeature
  | StandardPartFeature
  | HoleFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | MirrorFeature
  | TransformFeature
  | ImportedMeshFeature;

// ---------------- Параметры проекта (Таблица уравнений fx) ----------------

export interface UserParam {
  id: string;
  name: string;
  value: number;
  unit: 'mm' | 'deg' | 'count';
  comment: string;
}

// ---------------- Настройки сечения (Section Analysis) ----------------

export interface SectionPlaneConfig {
  enabled: boolean;
  axis: AxisId;
  offset: number;
  flip: boolean;
}

// ---------------- Полный документ проекта BeesCAD ----------------

export interface CadDocument {
  version: number;
  name: string;
  unit: 'mm' | 'cm' | 'inch';
  defaultMaterialId: string;
  gridSizeMm: number;
  snapMm: number;
  parameters: UserParam[];
  features: CadFeature[];
  /** Индекс отката дерева построения (Timeline Rollback): -1 = все операции активны */
  rollbackIndex: number;
  section: SectionPlaneConfig;
}

// ---------------- Вычисленная 3D-геометрия и метрики ----------------

export interface TriangleMesh {
  /** Триплеты координат вершин треугольников (x, y, z) — каждые 9 чисел = 1 треугольник */
  positions: Float32Array;
  /** Нормали вершин той же длины */
  normals: Float32Array;
  /** Острые/характерные рёбра для инженерной отрисовки каркаса (пары точек x1,y1,z1, x2,y2,z2) */
  edges: Float32Array;
}

export interface BoundingBox3D {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

export interface EvaluatedBody {
  id: string;
  name: string;
  featureId: string;
  featureKind: FeatureKind;
  materialId: string;
  color: string;
  visible: boolean;
  opacity: number;
  mesh: TriangleMesh;
  bbox: BoundingBox3D;
  volumeMm3: number;
  areaMm2: number;
  massGrams: number;
  centerOfMass: [number, number, number];
  triangleCount: number;
}

export interface EvaluatedSketch {
  id: string;
  name: string;
  plane: PlaneId;
  planeOffset: number;
  visible: boolean;
  shapes: SketchShape[];
  constraints: SketchConstraint[];
  /** Отрезки в 3D-пространстве (x1,y1,z1, x2,y2,z2) для рендера контура эскиза */
  segments3D: Float32Array;
}

export interface CadIssue {
  id: string;
  severity: 'error' | 'warning';
  featureId?: string;
  bodyId?: string;
  message: string;
}

export interface EvaluatedScene {
  bodies: EvaluatedBody[];
  sketches: EvaluatedSketch[];
  issues: CadIssue[];
  totalVolumeMm3: number;
  totalAreaMm2: number;
  totalMassGrams: number;
  totalTriangles: number;
  overallBbox: BoundingBox3D;
}
