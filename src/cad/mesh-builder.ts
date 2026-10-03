// Высокопроизводительный генератор 3D-сеток и инженерных тел (TriangleMesh).
// Работает напрямую с плоскими массивами (Float32Array) без аллокации тысяч мелких
// объектов на каждый кадр — критично для слабых ПК и мгновенного пересчёта дерева.

import { scaleSegments } from '../perf';
import type {
  AxisId,
  BoundingBox3D,
  PlaneId,
  SketchShape,
  TriangleMesh,
} from './types';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export class MeshCollector {
  private pos: number[] = [];
  private norm: number[] = [];
  private edg: number[] = [];

  addTri(a: Vec3, b: Vec3, c: Vec3, customNormal?: Vec3): void {
    let nx: number, ny: number, nz: number;
    if (customNormal) {
      [nx, ny, nz] = customNormal;
    } else {
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }

  addQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal?: Vec3): void {
    this.addTri(a, b, c, normal);
    this.addTri(a, c, d, normal);
  }

  addEdge(a: Vec3, b: Vec3): void {
    this.edg.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }

  addLoopEdges(pts: Vec3[], closed = true): void {
    if (pts.length < 2) return;
    const n = pts.length;
    const limit = closed ? n : n - 1;
    for (let i = 0; i < limit; i++) {
      this.addEdge(pts[i], pts[(i + 1) % n]);
    }
  }

  appendMesh(other: TriangleMesh, offset: Vec3 = [0, 0, 0]): void {
    const [ox, oy, oz] = offset;
    const p = other.positions;
    const n = other.normals;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i] + ox, p[i + 1] + oy, p[i + 2] + oz);
      this.norm.push(n[i], n[i + 1], n[i + 2]);
    }
    const e = other.edges;
    for (let i = 0; i < e.length; i += 3) {
      this.edg.push(e[i] + ox, e[i + 1] + oy, e[i + 2] + oz);
    }
  }

  build(): TriangleMesh {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.norm),
      edges: new Float32Array(this.edg),
    };
  }
}

// ---------------- Математические и координатные утилиты ----------------

export function planePointTo3D(plane: PlaneId, offset: number, u: number, v: number, w = 0): Vec3 {
  // Стандартная CAD-система (Y — вверх в 3D-вьюпорте, либо плоскость XY горизонтальная:
  // в нашем вьюпорте плоскость XY — горизонтальный стол Z-вверх? В Three.js удобна система:
  // XY — горизонтальный рабочий стол (X вправо, Y вперёд/вглубь, Z вверх) ИЛИ Y вверх.
  // Используем инженерный стандарт Z-up в параметрах, отображаемый в Three.js с Z->Y или напрямую.
  // Чтобы координаты X, Y, Z полностью совпадали с подписями осей в 3D-сцене:
  // Плоскость XY: u -> X, v -> Z (горизонтальный стол при Y-вверх) или оставим честные X, Y, Z:
  // XY: (u, v, offset + w)
  // XZ: (u, offset + w, v)
  // YZ: (offset + w, u, v)
  switch (plane) {
    case 'XY':
      return [u, w + offset, v];
    case 'XZ':
      return [u, v, w + offset];
    case 'YZ':
      return [w + offset, u, v];
  }
}

export function transformMesh(
  mesh: TriangleMesh,
  opts: {
    tx?: number;
    ty?: number;
    tz?: number;
    rx?: number;
    ry?: number;
    rz?: number;
    scale?: [number, number, number];
  },
): TriangleMesh {
  const tx = opts.tx || 0;
  const ty = opts.ty || 0;
  const tz = opts.tz || 0;
  const rx = ((opts.rx || 0) * Math.PI) / 180;
  const ry = ((opts.ry || 0) * Math.PI) / 180;
  const rz = ((opts.rz || 0) * Math.PI) / 180;
  const [sx, sy, sz] = opts.scale || [1, 1, 1];

  const isIdentityRot = rx === 0 && ry === 0 && rz === 0;
  const isIdentityScale = sx === 1 && sy === 1 && sz === 1;
  if (isIdentityRot && isIdentityScale && tx === 0 && ty === 0 && tz === 0) {
    return mesh;
  }

  const cx = Math.cos(rx),
    srx = Math.sin(rx);
  const cy = Math.cos(ry),
    sry = Math.sin(ry);
  const cz = Math.cos(rz),
    srz = Math.sin(rz);

  // Матрица поворота R = Rz * Ry * Rx
  const r00 = cz * cy;
  const r01 = cz * sry * srx - srz * cx;
  const r02 = cz * sry * cx + srz * srx;
  const r10 = srz * cy;
  const r11 = srz * sry * srx + cz * cx;
  const r12 = srz * sry * cx - cz * srx;
  const r20 = -sry;
  const r21 = cy * srx;
  const r22 = cy * cx;

  const flipWinding = sx * sy * sz < 0;

  const pIn = mesh.positions;
  const nIn = mesh.normals;
  const eIn = mesh.edges;

  const pOut = new Float32Array(pIn.length);
  const nOut = new Float32Array(nIn.length);
  const eOut = new Float32Array(eIn.length);

  for (let i = 0; i < pIn.length; i += 3) {
    const x = pIn[i] * sx;
    const y = pIn[i + 1] * sy;
    const z = pIn[i + 2] * sz;
    pOut[i] = r00 * x + r01 * y + r02 * z + tx;
    pOut[i + 1] = r10 * x + r11 * y + r12 * z + ty;
    pOut[i + 2] = r20 * x + r21 * y + r22 * z + tz;

    const nx = nIn[i] * (sx < 0 ? -1 : 1);
    const ny = nIn[i + 1] * (sy < 0 ? -1 : 1);
    const nz = nIn[i + 2] * (sz < 0 ? -1 : 1);
    const rnx = r00 * nx + r01 * ny + r02 * nz;
    const rny = r10 * nx + r11 * ny + r12 * nz;
    const rnz = r20 * nx + r21 * ny + r22 * nz;
    const len = Math.hypot(rnx, rny, rnz) || 1;
    nOut[i] = rnx / len;
    nOut[i + 1] = rny / len;
    nOut[i + 2] = rnz / len;
  }

  if (flipWinding) {
    // Меняем порядок вершин B и C в каждом треугольнике при зеркальном отражении
    for (let i = 0; i < pOut.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const tmpP = pOut[i + 3 + k];
        pOut[i + 3 + k] = pOut[i + 6 + k];
        pOut[i + 6 + k] = tmpP;
        const tmpN = nOut[i + 3 + k];
        nOut[i + 3 + k] = nOut[i + 6 + k];
        nOut[i + 6 + k] = tmpN;
      }
    }
  }

  for (let i = 0; i < eIn.length; i += 3) {
    const x = eIn[i] * sx;
    const y = eIn[i + 1] * sy;
    const z = eIn[i + 2] * sz;
    eOut[i] = r00 * x + r01 * y + r02 * z + tx;
    eOut[i + 1] = r10 * x + r11 * y + r12 * z + ty;
    eOut[i + 2] = r20 * x + r21 * y + r22 * z + tz;
  }

  return { positions: pOut, normals: nOut, edges: eOut };
}

// ---------------- Расчёт объёма, площади, габаритов и центра масс ----------------

export function computeMeshMetrics(mesh: TriangleMesh): {
  bbox: BoundingBox3D;
  volumeMm3: number;
  areaMm2: number;
  centerOfMass: Vec3;
} {
  const p = mesh.positions;
  if (p.length < 9) {
    return {
      bbox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] },
      volumeMm3: 0,
      areaMm2: 0,
      centerOfMass: [0, 0, 0],
    };
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let signedVol6 = 0;
  let totalArea = 0;
  let cxSum = 0,
    cySum = 0,
    czSum = 0;

  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i],
      ay = p[i + 1],
      az = p[i + 2];
    const bx = p[i + 3],
      by = p[i + 4],
      bz = p[i + 5];
    const cx = p[i + 6],
      cy = p[i + 7],
      cz = p[i + 8];

    if (ax < minX) minX = ax;
    if (bx < minX) minX = bx;
    if (cx < minX) minX = cx;
    if (ay < minY) minY = ay;
    if (by < minY) minY = by;
    if (cy < minY) minY = cy;
    if (az < minZ) minZ = az;
    if (bz < minZ) minZ = bz;
    if (cz < minZ) minZ = cz;

    if (ax > maxX) maxX = ax;
    if (bx > maxX) maxX = bx;
    if (cx > maxX) maxX = cx;
    if (ay > maxY) maxY = ay;
    if (by > maxY) maxY = by;
    if (cy > maxY) maxY = cy;
    if (az > maxZ) maxZ = az;
    if (bz > maxZ) maxZ = bz;
    if (cz > maxZ) maxZ = cz;

    // Площадь треугольника = 0.5 * |(B - A) x (C - A)|
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    const crx = uy * vz - uz * vy;
    const cry = uz * vx - ux * vz;
    const crz = ux * vy - uy * vx;
    totalArea += 0.5 * Math.hypot(crx, cry, crz);

    // Знаковый объём тетраэдра OA-OB-OC * 6
    const v6 = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    signedVol6 += v6;
    cxSum += v6 * (ax + bx + cx);
    cySum += v6 * (ay + by + cy);
    czSum += v6 * (az + bz + cz);
  }

  const volumeMm3 = Math.abs(signedVol6) / 6;
  const center: Vec3 = [
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  ];
  const centerOfMass: Vec3 =
    Math.abs(signedVol6) > 1e-5
      ? [cxSum / (4 * signedVol6), cySum / (4 * signedVol6), czSum / (4 * signedVol6)]
      : center;

  return {
    bbox: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX, maxY - minY, maxZ - minZ],
      center,
    },
    volumeMm3,
    areaMm2: totalArea,
    centerOfMass,
  };
}

// ---------------- 2D-контуры эскиза -> Полигоны (против часовой стрелки) ----------------

export function sampleSketchShape2D(shape: SketchShape): { outer: Vec2[]; inner?: Vec2[] } {
  const { cx, cy, width, height, radius, innerRadius, sides, rotationDeg, kind } = shape;
  const rot = ((rotationDeg || 0) * Math.PI) / 180;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  const tr = (u: number, v: number): Vec2 => [
    cx + u * cosR - v * sinR,
    cy + u * sinR + v * cosR,
  ];

  if (kind === 'circle') {
    const r = Math.max(0.5, radius || width * 0.5 || 10);
    const segs = scaleSegments(32, 12);
    const pts: Vec2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(tr(Math.cos(a) * r, Math.sin(a) * r));
    }
    return { outer: pts };
  }

  if (kind === 'ring') {
    const rOut = Math.max(1, radius || width * 0.5 || 15);
    const rIn = Math.max(0.4, Math.min(rOut - 0.5, innerRadius || rOut * 0.55));
    const segs = scaleSegments(32, 12);
    const outer: Vec2[] = [];
    const inner: Vec2[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      outer.push(tr(Math.cos(a) * rOut, Math.sin(a) * rOut));
      inner.push(tr(Math.cos(a) * rIn, Math.sin(a) * rIn));
    }
    return { outer, inner };
  }

  if (kind === 'polygon') {
    const n = Math.max(3, Math.min(24, Math.round(sides || 6)));
    const r = Math.max(0.5, radius || width * 0.5 || 12);
    const pts: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(tr(Math.cos(a) * r, Math.sin(a) * r));
    }
    return { outer: pts };
  }

  if (kind === 'slot') {
    const w = Math.max(2, width || 30);
    const h = Math.max(1, Math.min(w, height || 10));
    const r = h * 0.5;
    const halfStraight = Math.max(0, (w - h) * 0.5);
    const halfSegs = scaleSegments(14, 6);
    const pts: Vec2[] = [];
    for (let i = 0; i <= halfSegs; i++) {
      const a = -Math.PI * 0.5 + (i / halfSegs) * Math.PI;
      pts.push(tr(halfStraight + Math.cos(a) * r, Math.sin(a) * r));
    }
    for (let i = 0; i <= halfSegs; i++) {
      const a = Math.PI * 0.5 + (i / halfSegs) * Math.PI;
      pts.push(tr(-halfStraight + Math.cos(a) * r, Math.sin(a) * r));
    }
    return { outer: pts };
  }

  if (kind === 'l_profile') {
    const w = Math.max(4, width || 30);
    const h = Math.max(4, height || 30);
    const t = Math.max(1, Math.min(Math.min(w, h) * 0.6, innerRadius || 6));
    const hw = w * 0.5;
    const hh = h * 0.5;
    return {
      outer: [
        tr(-hw, -hh),
        tr(hw, -hh),
        tr(hw, -hh + t),
        tr(-hw + t, -hh + t),
        tr(-hw + t, hh),
        tr(-hw, hh),
      ],
    };
  }

  if (kind === 't_profile') {
    const w = Math.max(6, width || 36);
    const h = Math.max(6, height || 30);
    const t = Math.max(1.5, Math.min(Math.min(w, h) * 0.45, innerRadius || 6));
    const hw = w * 0.5;
    const hh = h * 0.5;
    const ht = t * 0.5;
    return {
      outer: [
        tr(-ht, -hh),
        tr(ht, -hh),
        tr(ht, hh - t),
        tr(hw, hh - t),
        tr(hw, hh),
        tr(-hw, hh),
        tr(-hw, hh - t),
        tr(-ht, hh - t),
      ],
    };
  }

  // Прямоугольник (с опциональным скруглением углов radius)
  const w = Math.max(1, width || 20);
  const h = Math.max(1, height || 20);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const cr = Math.max(0, Math.min(radius || 0, Math.min(hw, hh) - 0.1));
  if (cr <= 0.05) {
    return {
      outer: [tr(-hw, -hh), tr(hw, -hh), tr(hw, hh), tr(-hw, hh)],
    };
  }
  const cSegs = scaleSegments(6, 3);
  const corners: [number, number, number][] = [
    [hw - cr, -hh + cr, -Math.PI * 0.5],
    [hw - cr, hh - cr, 0],
    [-hw + cr, hh - cr, Math.PI * 0.5],
    [-hw + cr, -hh + cr, Math.PI],
  ];
  const pts: Vec2[] = [];
  for (const [ox, oy, a0] of corners) {
    for (let i = 0; i <= cSegs; i++) {
      const a = a0 + (i / cSegs) * (Math.PI * 0.5);
      pts.push(tr(ox + Math.cos(a) * cr, oy + Math.sin(a) * cr));
    }
  }
  return { outer: pts };
}

// ---------------- Триангуляция 2D-контуров (Уши + Кольцевые перемычки) ----------------

function signedArea2D(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s * 0.5;
}

function pointInTri2D(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const c1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const c2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
  const c3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
  return c1 >= -1e-6 && c2 >= -1e-6 && c3 >= -1e-6;
}

export function earClipPolygon2D(rawPts: Vec2[]): [number, number, number][] {
  const n = rawPts.length;
  if (n < 3) return [];
  const pts = signedArea2D(rawPts) >= 0 ? rawPts.slice() : rawPts.slice().reverse();
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];

  let guard = n * 3;
  while (idx.length > 3 && guard-- > 0) {
    let earFound = false;
    const m = idx.length;
    for (let i = 0; i < m; i++) {
      const iPrev = idx[(i + m - 1) % m];
      const iCurr = idx[i];
      const iNext = idx[(i + 1) % m];
      const a = pts[iPrev];
      const b = pts[iCurr];
      const c = pts[iNext];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 1e-6) continue;
      let hasInside = false;
      for (let j = 0; j < m; j++) {
        const ij = idx[j];
        if (ij === iPrev || ij === iCurr || ij === iNext) continue;
        if (pointInTri2D(pts[ij], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        tris.push([iPrev, iCurr, iNext]);
        idx.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      tris.push([idx[0], idx[1], idx[2]]);
      idx.splice(1, 1);
    }
  }
  if (idx.length === 3) {
    tris.push([idx[0], idx[1], idx[2]]);
  }
  return tris;
}

// ---------------- Выдавливание (Extrude) 2D-профиля в 3D-тело ----------------

export function buildExtrudedProfileMesh(opts: {
  plane: PlaneId;
  planeOffset: number;
  shapes: SketchShape[];
  distance: number;
  symmetric: boolean;
  draftDeg: number;
}): TriangleMesh {
  const { plane, planeOffset, shapes, distance, symmetric, draftDeg } = opts;
  const mc = new MeshCollector();
  const h = Math.max(0.2, Math.abs(distance));
  const w0 = symmetric ? -h * 0.5 : distance >= 0 ? 0 : -h;
  const w1 = symmetric ? h * 0.5 : distance >= 0 ? h : 0;

  // Уклон (draft angle) масштабирует верхний контур
  const draftScale = Math.max(0.2, 1 + (Math.tan((draftDeg * Math.PI) / 180) * h) / 25);

  const solidShapes = shapes.filter((s) => !s.isHole);
  if (solidShapes.length === 0 && shapes.length > 0) {
    solidShapes.push(shapes[0]);
  }

  for (const shape of solidShapes) {
    const sampled = sampleSketchShape2D(shape);
    const outer =
      signedArea2D(sampled.outer) >= 0 ? sampled.outer : sampled.outer.slice().reverse();
    const n = outer.length;
    if (n < 3) continue;

    const scalePt = (p: Vec2, s: number): Vec2 => [
      shape.cx + (p[0] - shape.cx) * s,
      shape.cy + (p[1] - shape.cy) * s,
    ];

    const bot3D = outer.map((p) => planePointTo3D(plane, planeOffset, p[0], p[1], w0));
    const top3D = outer.map((p) => {
      const sp = scalePt(p, draftScale);
      return planePointTo3D(plane, planeOffset, sp[0], sp[1], w1);
    });

    // Боковые стенки внешнего контура
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Bottom-to-top first, then along the CCW profile edge: outward-facing normal.
      mc.addQuad(bot3D[i], top3D[i], top3D[j], bot3D[j]);
    }
    mc.addLoopEdges(bot3D, true);
    mc.addLoopEdges(top3D, true);

    if (sampled.inner && sampled.inner.length === n) {
      // Кольцевой профиль (труба/шайба/втулка)
      const inner =
        signedArea2D(sampled.inner) >= 0 ? sampled.inner : sampled.inner.slice().reverse();
      const botIn3D = inner.map((p) => planePointTo3D(plane, planeOffset, p[0], p[1], w0));
      const topIn3D = inner.map((p) => {
        const sp = scalePt(p, draftScale);
        return planePointTo3D(plane, planeOffset, sp[0], sp[1], w1);
      });
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // Внутренняя стенка и верх/низ кольца
        // The hole wall faces toward the profile centre (opposite the outer wall).
        mc.addQuad(botIn3D[i], botIn3D[j], topIn3D[j], topIn3D[i]);
        mc.addQuad(topIn3D[i], topIn3D[j], top3D[j], top3D[i]);
        mc.addQuad(bot3D[i], bot3D[j], botIn3D[j], botIn3D[i]);
      }
      mc.addLoopEdges(botIn3D, true);
      mc.addLoopEdges(topIn3D, true);
    } else {
      // Сплошные крышки (верхняя и нижняя) через ear-clipping
      const tris = earClipPolygon2D(outer);
      for (const [i0, i1, i2] of tris) {
        // In the Y-up viewport the sketch's X/Z winding is mirrored: flip
        // the top cap and keep the bottom cap's reverse normal.
        mc.addTri(top3D[i0], top3D[i2], top3D[i1]);
        mc.addTri(bot3D[i0], bot3D[i1], bot3D[i2]);
      }
    }
  }

  return mc.build();
}

// ---------------- Тело вращения (Revolve) 2D-профиля вокруг оси ----------------

export function buildRevolveMesh(opts: {
  shapes: SketchShape[];
  axis: AxisId;
  angleDeg: number;
}): TriangleMesh {
  const { shapes, axis, angleDeg } = opts;
  const mc = new MeshCollector();
  const totalRad = (Math.max(15, Math.min(360, angleDeg || 360)) * Math.PI) / 180;
  const steps = scaleSegments(Math.max(12, Math.round((Math.abs(angleDeg) / 360) * 32)), 10);
  const fullCircle = Math.abs(angleDeg) >= 359.5;

  const targetShapes = shapes.filter((s) => !s.isHole);
  if (targetShapes.length === 0 && shapes.length > 0) targetShapes.push(shapes[0]);

  for (const shape of targetShapes) {
    const { outer } = sampleSketchShape2D(shape);
    const m = outer.length;
    if (m < 3) continue;

    // Обеспечиваем положительный радиус вращения R > 0.5 мм
    const profile2D: Vec2[] = outer.map(([u, v]) => {
      const r = Math.max(1.2, Math.abs(u) < 1.2 ? Math.abs(u) + 8 : Math.abs(u));
      return [r, v];
    });

    const ringPoint = (r: number, h: number, theta: number): Vec3 => {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      if (axis === 'X') return [h, r * c, r * s];
      if (axis === 'Z') return [r * c, r * s, h];
      return [r * c, h, r * s]; // Y по умолчанию
    };

    const rings: Vec3[][] = [];
    const ringCount = fullCircle ? steps : steps + 1;
    for (let s = 0; s < ringCount; s++) {
      const theta = (s / steps) * totalRad;
      rings.push(profile2D.map(([r, h]) => ringPoint(r, h, theta)));
    }

    for (let s = 0; s < steps; s++) {
      const rA = rings[s];
      const rB = rings[(s + 1) % ringCount];
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        mc.addQuad(rA[i], rB[i], rB[j], rA[j]);
      }
    }

    mc.addLoopEdges(rings[0], true);
    if (!fullCircle) {
      const last = rings[rings.length - 1];
      mc.addLoopEdges(last, true);
      const tris = earClipPolygon2D(profile2D);
      for (const [i0, i1, i2] of tris) {
        mc.addTri(rings[0][i0], rings[0][i2], rings[0][i1]);
        mc.addTri(last[i0], last[i1], last[i2]);
      }
    }
  }

  return mc.build();
}

// ---------------- Твердотельные 3D-примитивы ----------------

export function buildBoxMesh(w: number, h: number, d: number, chamfer = 0): TriangleMesh {
  const mc = new MeshCollector();
  const hw = Math.max(0.5, w * 0.5);
  const hh = Math.max(0.5, h * 0.5);
  const hd = Math.max(0.5, d * 0.5);
  const c = Math.max(0, Math.min(chamfer, Math.min(hw, hh, hd) * 0.45));

  if (c <= 0.01) {
    // 8 вершин куба, основание на Y = 0..h (или центрировано по X,Z, Y от 0 до h)
    const v000: Vec3 = [-hw, 0, -hd];
    const v100: Vec3 = [hw, 0, -hd];
    const v101: Vec3 = [hw, 0, hd];
    const v001: Vec3 = [-hw, 0, hd];
    const v010: Vec3 = [-hw, h, -hd];
    const v110: Vec3 = [hw, h, -hd];
    const v111: Vec3 = [hw, h, hd];
    const v011: Vec3 = [-hw, h, hd];

    mc.addQuad(v010, v011, v111, v110, [0, 1, 0]); // Верх
    mc.addQuad(v000, v100, v101, v001, [0, -1, 0]); // Низ
    mc.addQuad(v001, v101, v111, v011, [0, 0, 1]); // Перед
    mc.addQuad(v100, v000, v010, v110, [0, 0, -1]); // Зад
    mc.addQuad(v101, v100, v110, v111, [1, 0, 0]); // Право
    mc.addQuad(v000, v001, v011, v010, [-1, 0, 0]); // Лево

    mc.addLoopEdges([v000, v100, v101, v001], true);
    mc.addLoopEdges([v010, v110, v111, v011], true);
    mc.addEdge(v000, v010);
    mc.addEdge(v100, v110);
    mc.addEdge(v101, v111);
    mc.addEdge(v001, v011);
    return mc.build();
  }

  // Прямоугольный блок со скруглённым/скошенным профилем
  return buildExtrudedProfileMesh({
    plane: 'XY',
    planeOffset: 0,
    shapes: [
      {
        id: 'box-chamfer',
        kind: 'rect',
        cx: 0,
        cy: 0,
        width: w,
        height: d,
        radius: c,
        innerRadius: 0,
        sides: 4,
        rotationDeg: 0,
      },
    ],
    distance: h,
    symmetric: false,
    draftDeg: 0,
  });
}

export function buildCylinderMesh(
  radiusBottom: number,
  radiusTop: number,
  height: number,
  radialSegments = 32,
): TriangleMesh {
  const mc = new MeshCollector();
  const r0 = Math.max(0.1, radiusBottom);
  const r1 = Math.max(0.0, radiusTop);
  const h = Math.max(0.2, height);
  const segs = scaleSegments(radialSegments, 12);

  const bot: Vec3[] = [];
  const top: Vec3[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bot.push([ca * r0, 0, sa * r0]);
    top.push([ca * r1, h, sa * r1]);
  }

  const cBot: Vec3 = [0, 0, 0];
  const cTop: Vec3 = [0, h, 0];

  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    mc.addTri(cBot, bot[i], bot[j], [0, -1, 0]);
    if (r1 > 0.05) {
      mc.addTri(cTop, top[j], top[i], [0, 1, 0]);
      mc.addQuad(bot[i], top[i], top[j], bot[j]);
    } else {
      mc.addTri(bot[i], cTop, bot[j]);
    }
  }

  mc.addLoopEdges(bot, true);
  if (r1 > 0.05) mc.addLoopEdges(top, true);
  return mc.build();
}

export function buildPipeMesh(
  outerRadius: number,
  innerRadius: number,
  height: number,
  radialSegments = 32,
): TriangleMesh {
  const mc = new MeshCollector();
  const rOut = Math.max(1, outerRadius);
  const rIn = Math.max(0.2, Math.min(rOut - 0.3, innerRadius));
  const h = Math.max(0.2, height);
  const segs = scaleSegments(radialSegments, 12);

  const bOut: Vec3[] = [];
  const tOut: Vec3[] = [];
  const bIn: Vec3[] = [];
  const tIn: Vec3[] = [];

  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bOut.push([ca * rOut, 0, sa * rOut]);
    tOut.push([ca * rOut, h, sa * rOut]);
    bIn.push([ca * rIn, 0, sa * rIn]);
    tIn.push([ca * rIn, h, sa * rIn]);
  }

  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    mc.addQuad(bOut[i], tOut[i], tOut[j], bOut[j]);
    mc.addQuad(bIn[j], tIn[j], tIn[i], bIn[i]);
    mc.addQuad(tOut[i], tIn[i], tIn[j], tOut[j], [0, 1, 0]);
    mc.addQuad(bIn[i], bOut[i], bOut[j], bIn[j], [0, -1, 0]);
  }

  mc.addLoopEdges(bOut, true);
  mc.addLoopEdges(tOut, true);
  mc.addLoopEdges(bIn, true);
  mc.addLoopEdges(tIn, true);
  return mc.build();
}

export function buildSphereMesh(radius: number): TriangleMesh {
  const mc = new MeshCollector();
  const r = Math.max(0.5, radius);
  const latSegs = scaleSegments(18, 8);
  const lonSegs = scaleSegments(28, 12);
  const cy = r;

  const pt = (lat: number, lon: number): Vec3 => {
    const phi = (lat / latSegs) * Math.PI;
    const theta = (lon / lonSegs) * Math.PI * 2;
    return [
      r * Math.sin(phi) * Math.cos(theta),
      cy + r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta),
    ];
  };

  for (let i = 0; i < latSegs; i++) {
    for (let j = 0; j < lonSegs; j++) {
      const p00 = pt(i, j);
      const p10 = pt(i + 1, j);
      const p11 = pt(i + 1, j + 1);
      const p01 = pt(i, j + 1);
      if (i === 0) {
        mc.addTri(p00, p11, p10);
      } else if (i === latSegs - 1) {
        mc.addTri(p00, p01, p10);
      } else {
        mc.addQuad(p00, p01, p11, p10);
      }
    }
  }

  // Экваториальное ребро для читаемости в CAD
  const eq: Vec3[] = [];
  for (let j = 0; j < lonSegs; j++) {
    const theta = (j / lonSegs) * Math.PI * 2;
    eq.push([r * Math.cos(theta), cy, r * Math.sin(theta)]);
  }
  mc.addLoopEdges(eq, true);
  return mc.build();
}

export function buildTorusMesh(majorRadius: number, tubeRadius: number): TriangleMesh {
  const mc = new MeshCollector();
  const R = Math.max(2, majorRadius);
  const r = Math.max(0.4, Math.min(R - 0.2, tubeRadius));
  const uSegs = scaleSegments(28, 12);
  const vSegs = scaleSegments(16, 8);
  const cy = r;

  const pt = (u: number, v: number): Vec3 => {
    const a = (u / uSegs) * Math.PI * 2;
    const b = (v / vSegs) * Math.PI * 2;
    const rr = R + r * Math.cos(b);
    return [rr * Math.cos(a), cy + r * Math.sin(b), rr * Math.sin(a)];
  };

  for (let i = 0; i < uSegs; i++) {
    for (let j = 0; j < vSegs; j++) {
      mc.addQuad(pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1));
    }
  }
  const outerRing: Vec3[] = [];
  for (let i = 0; i < uSegs; i++) outerRing.push(pt(i, 0));
  mc.addLoopEdges(outerRing, true);
  return mc.build();
}

export function buildWedgeMesh(w: number, h: number, d: number): TriangleMesh {
  const mc = new MeshCollector();
  const hw = Math.max(0.5, w * 0.5);
  const hh = Math.max(0.5, h);
  const hd = Math.max(0.5, d * 0.5);

  const a0: Vec3 = [-hw, 0, -hd];
  const b0: Vec3 = [hw, 0, -hd];
  const c0: Vec3 = [hw, 0, hd];
  const d0: Vec3 = [-hw, 0, hd];
  const a1: Vec3 = [-hw, hh, -hd];
  const b1: Vec3 = [hw, hh, -hd];

  mc.addQuad(a0, b0, c0, d0, [0, -1, 0]); // Низ
  mc.addQuad(b0, a0, a1, b1, [0, 0, -1]); // Задняя вертикальная стенка
  mc.addQuad(d0, c0, b1, a1); // Наклонная грань
  mc.addTri(a0, d0, a1, [-1, 0, 0]); // Левый треугольник
  mc.addTri(b0, b1, c0, [1, 0, 0]); // Правый треугольник

  mc.addLoopEdges([a0, b0, c0, d0], true);
  mc.addEdge(a0, a1);
  mc.addEdge(b0, b1);
  mc.addEdge(a1, b1);
  mc.addEdge(d0, a1);
  mc.addEdge(c0, b1);
  return mc.build();
}
