// Вычислитель параметрического дерева построения (Feature Timeline Evaluator).
// Проходит по списку операций до индекса отката (rollbackIndex), строит 2D-эскизы,
// твердотельные 3D-тела, применяет булевы операции, скругления, фаски, оболочки,
// массивы и зеркала, а также выполняет инженерный контроль технологичности (DFM).

import { scaleSegments } from '../perf';
import { booleanMeshes } from './boolean';
import {
  buildBoxMesh,
  buildCylinderMesh,
  buildExtrudedProfileMesh,
  buildPipeMesh,
  buildRevolveMesh,
  buildSphereMesh,
  buildTorusMesh,
  buildWedgeMesh,
  computeMeshMetrics,
  MeshCollector,
  planePointTo3D,
  sampleSketchShape2D,
  transformMesh,
  type Vec3,
} from './mesh-builder';
import { buildStandardPartMesh, orientAlongAxis } from './standard-parts';
import {
  getMaterial,
  type BoundingBox3D,
  type CadDocument,
  type CadFeature,
  type CadIssue,
  type EvaluatedBody,
  type EvaluatedScene,
  type EvaluatedSketch,
  type SketchFeature,
  type TriangleMesh,
} from './types';

function buildSketchSegments3D(sketch: SketchFeature): Float32Array {
  const segs: number[] = [];
  for (const shape of sketch.shapes) {
    const { outer, inner } = sampleSketchShape2D(shape);
    const addLoop = (pts: [number, number][]) => {
      if (pts.length < 2) return;
      for (let i = 0; i < pts.length; i++) {
        const a = planePointTo3D(sketch.plane, sketch.planeOffset, pts[i][0], pts[i][1], 0);
        const b = planePointTo3D(
          sketch.plane,
          sketch.planeOffset,
          pts[(i + 1) % pts.length][0],
          pts[(i + 1) % pts.length][1],
          0,
        );
        segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      }
    };
    addLoop(outer);
    if (inner) addLoop(inner);
  }
  return new Float32Array(segs);
}

/** Применяет фаску или скругление к вершинам существующей сетки вдоль выбранных кромок. */
function applyEdgeModifierToMesh(
  mesh: TriangleMesh,
  amount: number,
  edgeGroup: 'top' | 'bottom' | 'vertical' | 'all',
  smooth: boolean,
): TriangleMesh {
  const { bbox } = computeMeshMetrics(mesh);
  const [minX, minY, minZ] = bbox.min;
  const [maxX, maxY, maxZ] = bbox.max;
  const [sx, sy, sz] = bbox.size;
  const cx = bbox.center[0];
  const cy = bbox.center[1];
  const cz = bbox.center[2];

  const maxAllowed = Math.max(0.2, Math.min(sx, sy, sz) * 0.38);
  const r = Math.max(0.1, Math.min(amount, maxAllowed));

  const pIn = mesh.positions;
  const pOut = new Float32Array(pIn.length);
  const nOut = new Float32Array(mesh.normals.length);
  const eIn = mesh.edges;
  const eOut = new Float32Array(eIn.length);

  const tolY = Math.max(0.5, sy * 0.16);
  const tolXZ = Math.max(0.5, Math.min(sx, sz) * 0.18);

  const deformVertex = (x: number, y: number, z: number): Vec3 => {
    let nx = x,
      ny = y,
      nz = z;
    const nearTop = maxY - y <= tolY;
    const nearBot = y - minY <= tolY;
    const radDist = Math.hypot(x - cx, z - cz);
    const maxRad = Math.hypot(sx * 0.5, sz * 0.5);
    const nearOuter =
      Math.abs(x - minX) <= tolXZ ||
      Math.abs(maxX - x) <= tolXZ ||
      Math.abs(z - minZ) <= tolXZ ||
      Math.abs(maxZ - z) <= tolXZ ||
      maxRad - radDist <= tolXZ;

    const shrinkFactor = smooth ? 0.72 : 0.92;
    if ((edgeGroup === 'top' || edgeGroup === 'all') && nearTop && nearOuter) {
      const t = Math.max(0, 1 - (maxY - y) / tolY);
      const pull = r * shrinkFactor * t;
      const dx = x - cx;
      const dz = z - cz;
      const dLen = Math.hypot(dx, dz) || 1;
      nx -= (dx / dLen) * pull;
      nz -= (dz / dLen) * pull;
      ny -= pull * (smooth ? 0.35 : 0.5);
    }
    if ((edgeGroup === 'bottom' || edgeGroup === 'all') && nearBot && nearOuter) {
      const t = Math.max(0, 1 - (y - minY) / tolY);
      const pull = r * shrinkFactor * t;
      const dx = x - cx;
      const dz = z - cz;
      const dLen = Math.hypot(dx, dz) || 1;
      nx -= (dx / dLen) * pull;
      nz -= (dz / dLen) * pull;
      ny += pull * (smooth ? 0.35 : 0.5);
    }
    if ((edgeGroup === 'vertical' || edgeGroup === 'all') && nearOuter) {
      const cornerX = Math.min(Math.abs(x - minX), Math.abs(maxX - x)) <= tolXZ;
      const cornerZ = Math.min(Math.abs(z - minZ), Math.abs(maxZ - z)) <= tolXZ;
      if (cornerX && cornerZ) {
        const pull = r * shrinkFactor * 0.65;
        nx += x > cx ? -pull : pull;
        nz += z > cz ? -pull : pull;
      }
    }
    return [nx, ny, nz];
  };

  for (let i = 0; i < pIn.length; i += 9) {
    const a = deformVertex(pIn[i], pIn[i + 1], pIn[i + 2]);
    const b = deformVertex(pIn[i + 3], pIn[i + 4], pIn[i + 5]);
    const c = deformVertex(pIn[i + 6], pIn[i + 7], pIn[i + 8]);
    pOut[i] = a[0];
    pOut[i + 1] = a[1];
    pOut[i + 2] = a[2];
    pOut[i + 3] = b[0];
    pOut[i + 4] = b[1];
    pOut[i + 5] = b[2];
    pOut[i + 6] = c[0];
    pOut[i + 7] = c[1];
    pOut[i + 8] = c[2];

    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < 9; k += 3) {
      nOut[i + k] = nx;
      nOut[i + k + 1] = ny;
      nOut[i + k + 2] = nz;
    }
  }

  for (let i = 0; i < eIn.length; i += 3) {
    const v = deformVertex(eIn[i], eIn[i + 1], eIn[i + 2]);
    eOut[i] = v[0];
    eOut[i + 1] = v[1];
    eOut[i + 2] = v[2];
  }

  return { positions: pOut, normals: nOut, edges: eOut };
}

/** Создаёт тонкостенную оболочку (Shell) на основе габаритов и контура тела. */
function applyShellToMesh(
  mesh: TriangleMesh,
  thickness: number,
  openFace: 'top' | 'bottom' | 'front',
): TriangleMesh {
  const { bbox } = computeMeshMetrics(mesh);
  const [sx, sy, sz] = bbox.size;
  const [cx, cy, cz] = bbox.center;
  const t = Math.max(0.4, Math.min(thickness, Math.min(sx, sy, sz) * 0.4));

  const scaleX = Math.max(0.2, (sx - 2 * t) / (sx || 1));
  const scaleY = Math.max(0.2, (sy - t) / (sy || 1));
  const scaleZ = Math.max(0.2, (sz - 2 * t) / (sz || 1));

  const shiftY = openFace === 'top' ? t * 0.5 : openFace === 'bottom' ? -t * 0.5 : 0;
  const shiftZ = openFace === 'front' ? t * 0.5 : 0;

  // Центрируем, масштабируем с инверсией нормалей (внутренняя полость) и добавляем к внешней оболочке
  const centered = transformMesh(mesh, { tx: -cx, ty: -cy, tz: -cz });
  const innerCavity = transformMesh(centered, {
    scale: [-scaleX, scaleY, scaleZ],
    tx: cx,
    ty: cy + shiftY,
    tz: cz + shiftZ,
  });

  const mc = new MeshCollector();
  mc.appendMesh(mesh);
  mc.appendMesh(innerCavity);
  return mc.build();
}

/** Вырезает/формирует инженерное отверстие (простое, с цековкой или зенковкой) в целевом теле. */
function applyHoleToMesh(
  targetMesh: TriangleMesh,
  opts: {
    holeType: 'simple' | 'counterbore' | 'countersink';
    diameter: number;
    depth: number;
    cbDiameter: number;
    cbDepth: number;
    csAngleDeg: number;
    axis: 'X' | 'Y' | 'Z';
    tx: number;
    ty: number;
    tz: number;
  },
): TriangleMesh {
  const r = Math.max(0.5, opts.diameter * 0.5);
  const h = Math.max(1, opts.depth);
  const segs = scaleSegments(28, 12);
  const [sx, sy, sz] = computeMeshMetrics(targetMesh).bbox.size;
  const span = opts.axis === 'X' ? sx : opts.axis === 'Y' ? sy : sz;
  const depth = Math.min(Math.max(h, span + 2), 10_000);
  const top = opts.axis === 'X' ? opts.tx : opts.axis === 'Y' ? opts.ty : opts.tz;

  const makeTool = (r0: number, r1: number, length: number, endOffset = 0): TriangleMesh => {
    const raw = buildCylinderMesh(r0, r1, Math.max(0.3, length), segs);
    const oriented = orientAlongAxis(raw, opts.axis);
    // The local cylinder begins at zero and points in +axis. Put its far end
    // just beyond the entry face, so the Boolean has no coplanar top triangles.
    const start = top - length + endOffset;
    const pos = opts.axis === 'X'
      ? { tx: start, ty: opts.ty, tz: opts.tz }
      : opts.axis === 'Y'
        ? { tx: opts.tx, ty: start, tz: opts.tz }
        : { tx: opts.tx, ty: opts.ty, tz: start };
    return transformMesh(oriented, pos);
  };

  try {
    let result = targetMesh;
    if (opts.holeType === 'counterbore') {
      const cbR = Math.max(r + 0.5, opts.cbDiameter * 0.5);
      const cbH = Math.max(0.5, Math.min(depth * 0.8, opts.cbDepth));
      const shaftH = Math.max(0.5, depth - cbH);
      result = booleanMeshes(result, makeTool(r, r, shaftH + 0.1, -cbH), 'cut');
      result = booleanMeshes(result, makeTool(cbR, cbR, cbH + 0.15), 'cut');
    } else if (opts.holeType === 'countersink') {
      const csR = Math.max(r + 0.5, opts.cbDiameter * 0.5);
      const halfAng = ((opts.csAngleDeg || 90) * 0.5 * Math.PI) / 180;
      const csH = Math.max(0.5, Math.min(depth * 0.65, (csR - r) / Math.max(0.2, Math.tan(halfAng))));
      const shaftH = Math.max(0.5, depth - csH);
      result = booleanMeshes(result, makeTool(r, r, shaftH + 0.1, -csH), 'cut');
      result = booleanMeshes(result, makeTool(r, csR, csH + 0.15), 'cut');
    } else {
      result = booleanMeshes(result, makeTool(r, r, depth + 0.15), 'cut');
    }
    return result;
  } catch (error) {
    throw new Error(`Не удалось построить отверстие: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function evaluateDocument(doc: CadDocument): EvaluatedScene {
  const sketches: EvaluatedSketch[] = [];
  const sketchMap = new Map<string, SketchFeature>();
  const bodies: EvaluatedBody[] = [];
  const issues: CadIssue[] = [];

  const limit =
    doc.rollbackIndex >= 0 && doc.rollbackIndex < doc.features.length
      ? doc.rollbackIndex + 1
      : doc.features.length;

  const findTargetBody = (targetId?: string): EvaluatedBody | undefined => {
    if (targetId) {
      const found = bodies.find((b) => b.id === targetId || b.featureId === targetId);
      if (found) return found;
    }
    return bodies[bodies.length - 1];
  };

  const makeBody = (
    feat: CadFeature,
    rawMesh: TriangleMesh,
    volumeAdjustmentMm3 = 0,
    suffix = '',
  ): EvaluatedBody => {
    const placedMesh = transformMesh(rawMesh, {
      tx: feat.tx || 0,
      ty: feat.ty || 0,
      tz: feat.tz || 0,
      rx: feat.rx || 0,
      ry: feat.ry || 0,
      rz: feat.rz || 0,
    });
    const metrics = computeMeshMetrics(placedMesh);
    const mat = getMaterial(feat.materialId || doc.defaultMaterialId);
    const vol = Math.max(1, metrics.volumeMm3 + volumeAdjustmentMm3);
    const massGrams = (vol / 1000) * mat.densityGcm3;

    return {
      id: suffix ? `body-${feat.id}-${suffix}` : `body-${feat.id}`,
      name: suffix ? `${feat.name} (${suffix})` : feat.name,
      featureId: feat.id,
      featureKind: feat.kind,
      materialId: mat.id,
      color: feat.color || mat.color,
      visible: feat.visible !== false,
      opacity: 1,
      mesh: placedMesh,
      bbox: metrics.bbox,
      volumeMm3: vol,
      areaMm2: metrics.areaMm2,
      massGrams,
      centerOfMass: metrics.centerOfMass,
      triangleCount: Math.floor(placedMesh.positions.length / 9),
    };
  };

  const syncFeatureVisibility = (body: EvaluatedBody, feature: CadFeature): void => {
    body.visible = feature.visible !== false;
  };

  const updateBodyMesh = (
    body: EvaluatedBody,
    newMesh: TriangleMesh,
    volumeDeltaMm3 = 0,
  ): void => {
    const metrics = computeMeshMetrics(newMesh);
    const mat = getMaterial(body.materialId);
    body.mesh = newMesh;
    body.bbox = metrics.bbox;
    // Prefer the volume of the resulting watertight mesh (not an estimate from
    // the tool volume). A conservative delta remains as a fallback for imports.
    body.volumeMm3 = metrics.volumeMm3 > 1e-4
      ? metrics.volumeMm3
      : Math.max(1, body.volumeMm3 + volumeDeltaMm3);
    body.areaMm2 = metrics.areaMm2;
    body.massGrams = (body.volumeMm3 / 1000) * mat.densityGcm3;
    body.centerOfMass = metrics.centerOfMass;
    body.triangleCount = Math.floor(newMesh.positions.length / 9);
  };

  for (let idx = 0; idx < limit; idx++) {
    const feat = doc.features[idx];
    if (feat.suppressed) continue;

    switch (feat.kind) {
      case 'sketch': {
        sketchMap.set(feat.id, feat);
        sketches.push({
          id: feat.id,
          name: feat.name,
          plane: feat.plane,
          planeOffset: feat.planeOffset,
          visible: feat.visible !== false,
          shapes: feat.shapes,
          constraints: feat.constraints,
          segments3D: buildSketchSegments3D(feat),
        });
        if (feat.shapes.length === 0) {
          issues.push({
            id: `issue-empty-sketch-${feat.id}`,
            severity: 'warning',
            featureId: feat.id,
            message: `Эскиз «${feat.name}» не содержит замкнутых контуров`,
          });
        }
        break;
      }

      case 'extrude': {
        const sk =
          sketchMap.get(feat.sketchId) ||
          Array.from(sketchMap.values())[sketchMap.size - 1];
        if (!sk || sk.shapes.length === 0) {
          issues.push({
            id: `issue-extrude-nosketch-${feat.id}`,
            severity: 'error',
            featureId: feat.id,
            message: `Выдавливание «${feat.name}»: не найден базовый 2D-эскиз`,
          });
          break;
        }
        const raw = buildExtrudedProfileMesh({
          plane: sk.plane,
          planeOffset: sk.planeOffset,
          shapes: sk.shapes,
          distance: feat.distance,
          symmetric: feat.symmetric,
          draftDeg: feat.draftDeg,
        });

        if (feat.operation !== 'new') {
          const target = findTargetBody(feat.targetBodyId);
          if (!target) {
            issues.push({ id: `issue-extrude-notarget-${feat.id}`, severity: 'error', featureId: feat.id, message: `Операция «${feat.name}» требует целевое тело.` });
            break;
          }
          const placed = transformMesh(raw, {
            tx: feat.tx || 0, ty: feat.ty || 0, tz: feat.tz || 0,
            rx: feat.rx || 0, ry: feat.ry || 0, rz: feat.rz || 0,
          });
          try {
            updateBodyMesh(target, booleanMeshes(target.mesh, placed, feat.operation));
            syncFeatureVisibility(target, feat);
          } catch (error) {
            issues.push({ id: `issue-extrude-boolean-${feat.id}`, severity: 'error', featureId: feat.id, bodyId: target.id, message: `Булева операция «${feat.name}» не выполнена: ${error instanceof Error ? error.message : String(error)}` });
          }
          break;
        }
        bodies.push(makeBody(feat, raw));
        break;
      }

      case 'revolve': {
        const sk =
          sketchMap.get(feat.sketchId) ||
          Array.from(sketchMap.values())[sketchMap.size - 1];
        if (!sk || sk.shapes.length === 0) {
          issues.push({
            id: `issue-revolve-nosketch-${feat.id}`,
            severity: 'error',
            featureId: feat.id,
            message: `Вращение «${feat.name}»: не найден базовый 2D-эскиз`,
          });
          break;
        }
        const raw = buildRevolveMesh({
          shapes: sk.shapes,
          axis: feat.axis,
          angleDeg: feat.angleDeg,
        });
        if (feat.operation !== 'new') {
          const target = findTargetBody(feat.targetBodyId);
          if (!target) {
            issues.push({ id: `issue-revolve-notarget-${feat.id}`, severity: 'error', featureId: feat.id, message: `Операция «${feat.name}» требует целевое тело.` });
            break;
          }
          const placed = transformMesh(raw, { tx: feat.tx || 0, ty: feat.ty || 0, tz: feat.tz || 0, rx: feat.rx || 0, ry: feat.ry || 0, rz: feat.rz || 0 });
          try {
            updateBodyMesh(target, booleanMeshes(target.mesh, placed, feat.operation));
            syncFeatureVisibility(target, feat);
          } catch (error) {
            issues.push({ id: `issue-revolve-boolean-${feat.id}`, severity: 'error', featureId: feat.id, bodyId: target.id, message: `Булева операция «${feat.name}» не выполнена: ${error instanceof Error ? error.message : String(error)}` });
          }
          break;
        }
        bodies.push(makeBody(feat, raw));
        break;
      }

      case 'primitive': {
        let raw: TriangleMesh;
        switch (feat.shape) {
          case 'box':
            raw = buildBoxMesh(feat.width, feat.height, feat.depth);
            break;
          case 'cylinder':
            raw = buildCylinderMesh(feat.radius, feat.radius, feat.height);
            break;
          case 'cone':
            raw = buildCylinderMesh(feat.radius, Math.max(0, feat.radius2), feat.height);
            break;
          case 'sphere':
            raw = buildSphereMesh(feat.radius);
            break;
          case 'torus':
            raw = buildTorusMesh(feat.radius, Math.max(0.5, feat.radius2 || feat.wall || 4));
            break;
          case 'pipe':
            raw = buildPipeMesh(
              feat.radius,
              Math.max(0.5, feat.radius - Math.max(0.8, feat.wall || 3)),
              feat.height,
            );
            break;
          case 'wedge':
            raw = buildWedgeMesh(feat.width, feat.height, feat.depth);
            break;
        }
        if (feat.operation !== 'new') {
          const target = findTargetBody(feat.targetBodyId);
          if (!target) {
            issues.push({ id: `issue-primitive-notarget-${feat.id}`, severity: 'error', featureId: feat.id, message: `Операция «${feat.name}» требует целевое тело.` });
            break;
          }
          const placed = transformMesh(raw, {
            tx: feat.tx || 0, ty: feat.ty || 0, tz: feat.tz || 0,
            rx: feat.rx || 0, ry: feat.ry || 0, rz: feat.rz || 0,
          });
          try {
            updateBodyMesh(target, booleanMeshes(target.mesh, placed, feat.operation));
            syncFeatureVisibility(target, feat);
          } catch (error) {
            issues.push({ id: `issue-primitive-boolean-${feat.id}`, severity: 'error', featureId: feat.id, bodyId: target.id, message: `Булева операция «${feat.name}» не выполнена: ${error instanceof Error ? error.message : String(error)}` });
          }
          break;
        }
        bodies.push(makeBody(feat, raw));
        break;
      }

      case 'standard_part': {
        const raw = buildStandardPartMesh(feat);
        bodies.push(makeBody(feat, raw));
        break;
      }

      case 'hole': {
        const target = findTargetBody(feat.targetBodyId);
        if (!target) {
          issues.push({
            id: `issue-hole-notarget-${feat.id}`,
            severity: 'warning',
            featureId: feat.id,
            message: `Отверстие «${feat.name}»: нет твердотельного тела для сверления`,
          });
          break;
        }
        const defaultY = target.bbox.max[1];
        try {
          const resultMesh = applyHoleToMesh(target.mesh, {
            holeType: feat.holeType,
            diameter: feat.diameter,
            depth: feat.depth,
            cbDiameter: feat.cbDiameter,
            cbDepth: feat.cbDepth,
            csAngleDeg: feat.csAngleDeg,
            axis: feat.axis,
            tx: feat.tx ?? target.bbox.center[0],
            ty: feat.ty ?? defaultY,
            tz: feat.tz ?? target.bbox.center[2],
          });
          updateBodyMesh(target, resultMesh);
          syncFeatureVisibility(target, feat);
        } catch (error) {
          issues.push({ id: `issue-hole-boolean-${feat.id}`, severity: 'error', featureId: feat.id, bodyId: target.id, message: error instanceof Error ? error.message : String(error) });
          break;
        }

        const minSpan = Math.min(target.bbox.size[0], target.bbox.size[2]);
        if (feat.diameter >= minSpan * 0.92) {
          issues.push({
            id: `issue-hole-large-${feat.id}`,
            severity: 'warning',
            featureId: feat.id,
            bodyId: target.id,
            message: `Диаметр отверстия «${feat.name}» (${feat.diameter} мм) близок к габариту детали (${minSpan.toFixed(1)} мм) — возможен прорыв стенки`,
          });
        }
        break;
      }

      case 'fillet': {
        const target = findTargetBody(feat.targetBodyId);
        if (!target) break;
        const minDim = Math.min(...target.bbox.size);
        if (feat.radius > minDim * 0.45) {
          issues.push({
            id: `issue-fillet-radius-${feat.id}`,
            severity: 'warning',
            featureId: feat.id,
            bodyId: target.id,
            message: `Радиус скругления «${feat.name}» (${feat.radius} мм) превышает 45% минимального габарита детали (${minDim.toFixed(1)} мм)`,
          });
        }
        const nextMesh = applyEdgeModifierToMesh(target.mesh, feat.radius, feat.edgeGroup, true);
        updateBodyMesh(target, nextMesh, -feat.radius * feat.radius * 8);
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'chamfer': {
        const target = findTargetBody(feat.targetBodyId);
        if (!target) break;
        const nextMesh = applyEdgeModifierToMesh(
          target.mesh,
          feat.distance,
          feat.edgeGroup,
          false,
        );
        updateBodyMesh(target, nextMesh, -feat.distance * feat.distance * 10);
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'shell': {
        const target = findTargetBody(feat.targetBodyId);
        if (!target) break;
        if (feat.thickness < 0.8) {
          issues.push({
            id: `issue-shell-thin-${feat.id}`,
            severity: 'warning',
            featureId: feat.id,
            bodyId: target.id,
            message: `Оболочка «${feat.name}»: толщина стенки ${feat.thickness} мм меньше технологического минимума 0.8 мм для 3D-печати / ЧПУ`,
          });
        }
        const oldVol = target.volumeMm3;
        const shelled = applyShellToMesh(target.mesh, feat.thickness, feat.openFace);
        updateBodyMesh(target, shelled, -oldVol * 0.55);
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'pattern_linear': {
        const target = findTargetBody(feat.sourceBodyId);
        if (!target) break;
        const nx = Math.max(1, Math.min(20, Math.round(feat.countX || 1)));
        const ny = Math.max(1, Math.min(20, Math.round(feat.countY || 1)));
        const nz = Math.max(1, Math.min(20, Math.round(feat.countZ || 1)));
        const mc = new MeshCollector();
        let copies = 0;
        for (let ix = 0; ix < nx; ix++) {
          for (let iy = 0; iy < ny; iy++) {
            for (let iz = 0; iz < nz; iz++) {
              mc.appendMesh(target.mesh, [
                ix * feat.spacingX,
                iy * feat.spacingY,
                iz * feat.spacingZ,
              ]);
              copies++;
            }
          }
        }
        const singleVol = target.volumeMm3;
        updateBodyMesh(target, mc.build(), singleVol * Math.max(0, copies - 1));
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'pattern_circular': {
        const target = findTargetBody(feat.sourceBodyId);
        if (!target) break;
        const count = Math.max(2, Math.min(36, Math.round(feat.count || 4)));
        const totalDeg = feat.totalAngleDeg || 360;
        const mc = new MeshCollector();
        const singleVol = target.volumeMm3;
        for (let i = 0; i < count; i++) {
          const deg = (i / count) * totalDeg;
          const rotated = transformMesh(target.mesh, {
            rx: feat.axis === 'X' ? deg : 0,
            ry: feat.axis === 'Y' ? deg : 0,
            rz: feat.axis === 'Z' ? deg : 0,
            tx: feat.radiusOffset ? Math.cos((deg * Math.PI) / 180) * feat.radiusOffset : 0,
            tz: feat.radiusOffset ? Math.sin((deg * Math.PI) / 180) * feat.radiusOffset : 0,
          });
          mc.appendMesh(rotated);
        }
        updateBodyMesh(target, mc.build(), singleVol * (count - 1));
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'mirror': {
        const target = findTargetBody(feat.sourceBodyId);
        if (!target) break;
        const scale: [number, number, number] =
          feat.mirrorPlane === 'YZ'
            ? [-1, 1, 1]
            : feat.mirrorPlane === 'XZ'
              ? [1, -1, 1]
              : [1, 1, -1];
        const shift: Vec3 =
          feat.mirrorPlane === 'YZ'
            ? [feat.offset * 2, 0, 0]
            : feat.mirrorPlane === 'XZ'
              ? [0, feat.offset * 2, 0]
              : [0, 0, feat.offset * 2];
        const mirrored = transformMesh(target.mesh, {
          scale,
          tx: shift[0],
          ty: shift[1],
          tz: shift[2],
        });
        bodies.push({
          ...target,
          id: `body-${feat.id}`,
          name: `${target.name} (Зеркало)`,
          featureId: feat.id,
          featureKind: 'mirror',
          visible: feat.visible !== false,
          mesh: mirrored,
          bbox: computeMeshMetrics(mirrored).bbox,
        });
        break;
      }

      case 'transform': {
        const target = findTargetBody(feat.targetBodyId);
        if (!target) break;
        const s = Math.max(0.05, feat.scaleFactor || 1);
        const transformed = transformMesh(target.mesh, {
          tx: feat.tx || 0,
          ty: feat.ty || 0,
          tz: feat.tz || 0,
          rx: feat.rx || 0,
          ry: feat.ry || 0,
          rz: feat.rz || 0,
          scale: [s, s, s],
        });
        const oldVol = target.volumeMm3;
        updateBodyMesh(target, transformed, oldVol * (s * s * s - 1));
        syncFeatureVisibility(target, feat);
        break;
      }

      case 'imported_mesh': {
        const s = Math.max(0.01, feat.scaleFactor || 1);
        const raw: TriangleMesh = {
          positions: new Float32Array(feat.positions),
          normals: new Float32Array(feat.normals),
          edges: new Float32Array(0),
        };
        const scaled = s !== 1 ? transformMesh(raw, { scale: [s, s, s] }) : raw;
        bodies.push(makeBody(feat, scaled));
        break;
      }
    }
  }

  let totalVolumeMm3 = 0;
  let totalAreaMm2 = 0;
  let totalMassGrams = 0;
  let totalTriangles = 0;

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (const b of bodies) {
    if (!b.visible) continue;
    totalVolumeMm3 += b.volumeMm3;
    totalAreaMm2 += b.areaMm2;
    totalMassGrams += b.massGrams;
    totalTriangles += b.triangleCount;

    if (b.bbox.min[0] < minX) minX = b.bbox.min[0];
    if (b.bbox.min[1] < minY) minY = b.bbox.min[1];
    if (b.bbox.min[2] < minZ) minZ = b.bbox.min[2];
    if (b.bbox.max[0] > maxX) maxX = b.bbox.max[0];
    if (b.bbox.max[1] > maxY) maxY = b.bbox.max[1];
    if (b.bbox.max[2] > maxZ) maxZ = b.bbox.max[2];
  }

  const overallBbox: BoundingBox3D =
    minX <= maxX
      ? {
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
          size: [maxX - minX, maxY - minY, maxZ - minZ],
          center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
        }
      : {
          min: [-50, 0, -50],
          max: [50, 30, 50],
          size: [100, 30, 100],
          center: [0, 15, 0],
        };

  return {
    bodies,
    sketches,
    issues,
    totalVolumeMm3,
    totalAreaMm2,
    totalMassGrams,
    totalTriangles,
    overallBbox,
  };
}
