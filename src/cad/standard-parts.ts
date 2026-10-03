// Генератор стандартных инженерных деталей (ISO / DIN / ГОСТ):
// крепёж, подшипники качения, прямозубые шестерни (по модулю m и числу зубьев z),
// фланцы, монтажные кронштейны, радиаторы и приборные корпуса под печатные платы.

import { scaleSegments } from '../perf';
import {
  buildBoxMesh,
  buildCylinderMesh,
  buildExtrudedProfileMesh,
  buildPipeMesh,
  buildSphereMesh,
  MeshCollector,
  transformMesh,
  type Vec2,
  type Vec3,
} from './mesh-builder';
import type { StandardPartFeature, StandardPartKind, TriangleMesh } from './types';

export interface StandardPartCatalogItem {
  kind: StandardPartKind;
  name: string;
  standard: string;
  category: 'Крепёж (ISO / ГОСТ)' | 'Передачи и вращение' | 'Корпуса и конструктив';
  badge: string;
  defaults: Omit<StandardPartFeature, 'id' | 'kind' | 'name'>;
}

export const STANDARD_PARTS_CATALOG: StandardPartCatalogItem[] = [
  {
    kind: 'spur_gear',
    name: 'Шестерня прямозубая',
    standard: 'ГОСТ 13755 (m=2, z=20)',
    category: 'Передачи и вращение',
    badge: 'm2 z20',
    defaults: {
      partType: 'spur_gear',
      nominalDiameter: 10, // диаметр вала
      length: 12, // ширина венца
      moduleOrPitch: 2, // модуль m
      teethOrCount: 20, // число зубьев z
      outerWidth: 44,
      outerDepth: 44,
      wallThickness: 4,
      materialId: 'steel-45',
    },
  },
  {
    kind: 'bearing',
    name: 'Подшипник шариковый 608',
    standard: 'ГОСТ 8338 / ISO 15',
    category: 'Передачи и вращение',
    badge: '8×22×7',
    defaults: {
      partType: 'bearing',
      nominalDiameter: 8, // внутренний d
      length: 7, // ширина B
      moduleOrPitch: 3.5,
      teethOrCount: 7, // число шариков
      outerWidth: 22, // наружный D
      outerDepth: 22,
      wallThickness: 2.2,
      materialId: 'steel-304',
    },
  },
  {
    kind: 'flange',
    name: 'Фланец соединительный',
    standard: 'ГОСТ 33259 / ISO 7005',
    category: 'Передачи и вращение',
    badge: 'DN25',
    defaults: {
      partType: 'flange',
      nominalDiameter: 25, // внутренний проход
      length: 18, // полная высота с воротником
      moduleOrPitch: 8, // диаметр крепёжных отверстий
      teethOrCount: 6, // число отверстий
      outerWidth: 70, // наружный диаметр диска
      outerDepth: 70,
      wallThickness: 7, // толщина диска
      materialId: 'steel-304',
    },
  },
  {
    kind: 'hex_bolt',
    name: 'Болт шестигранный М8×30',
    standard: 'ГОСТ 7798 / ISO 4017',
    category: 'Крепёж (ISO / ГОСТ)',
    badge: 'M8×30',
    defaults: {
      partType: 'hex_bolt',
      nominalDiameter: 8,
      length: 30,
      moduleOrPitch: 1.25,
      teethOrCount: 6,
      outerWidth: 13,
      outerDepth: 13,
      wallThickness: 5.3,
      materialId: 'steel-304',
    },
  },
  {
    kind: 'socket_bolt',
    name: 'Винт DIN 912 (имбусовый)',
    standard: 'ГОСТ 11738 / DIN 912',
    category: 'Крепёж (ISO / ГОСТ)',
    badge: 'M6×25',
    defaults: {
      partType: 'socket_bolt',
      nominalDiameter: 6,
      length: 25,
      moduleOrPitch: 1.0,
      teethOrCount: 6,
      outerWidth: 10,
      outerDepth: 10,
      wallThickness: 6,
      materialId: 'steel-45',
    },
  },
  {
    kind: 'hex_nut',
    name: 'Гайка шестигранная М8',
    standard: 'ГОСТ 5915 / ISO 4032',
    category: 'Крепёж (ISO / ГОСТ)',
    badge: 'M8',
    defaults: {
      partType: 'hex_nut',
      nominalDiameter: 8,
      length: 6.5,
      moduleOrPitch: 1.25,
      teethOrCount: 6,
      outerWidth: 13,
      outerDepth: 13,
      wallThickness: 6.5,
      materialId: 'steel-304',
    },
  },
  {
    kind: 'washer',
    name: 'Шайба плоская М8',
    standard: 'ГОСТ 11371 / ISO 7089',
    category: 'Крепёж (ISO / ГОСТ)',
    badge: '8.4×16',
    defaults: {
      partType: 'washer',
      nominalDiameter: 8.4,
      length: 1.6,
      moduleOrPitch: 1,
      teethOrCount: 1,
      outerWidth: 16,
      outerDepth: 16,
      wallThickness: 1.6,
      materialId: 'steel-304',
    },
  },
  {
    kind: 'angle_bracket',
    name: 'Кронштейн угловой усиленный',
    standard: 'ОСТ / Конструкционный',
    category: 'Корпуса и конструктив',
    badge: '45×45×35',
    defaults: {
      partType: 'angle_bracket',
      nominalDiameter: 6,
      length: 45,
      moduleOrPitch: 1,
      teethOrCount: 2,
      outerWidth: 35,
      outerDepth: 45,
      wallThickness: 5,
      materialId: 'al-6061',
    },
  },
  {
    kind: 'pcb_enclosure',
    name: 'Корпус РЭА под плату',
    standard: 'Инженерный со стойками М3',
    category: 'Корпуса и конструктив',
    badge: '80×55×24',
    defaults: {
      partType: 'pcb_enclosure',
      nominalDiameter: 3, // отверстия в стойках М3
      length: 24, // высота корпуса
      moduleOrPitch: 6, // высота стоек под плату
      teethOrCount: 4, // 4 угловые стойки
      outerWidth: 80, // длина X
      outerDepth: 55, // ширина Z
      wallThickness: 2.4,
      materialId: 'abs',
    },
  },
  {
    kind: 'heatsink',
    name: 'Радиатор охлаждения',
    standard: 'Профиль игольчато-ребристый',
    category: 'Корпуса и конструктив',
    badge: '60×50×22',
    defaults: {
      partType: 'heatsink',
      nominalDiameter: 4,
      length: 22, // полная высота рёбер
      moduleOrPitch: 2.2, // толщина ребра
      teethOrCount: 9, // число рёбер
      outerWidth: 60,
      outerDepth: 50,
      wallThickness: 4, // толщина подошвы
      materialId: 'al-6061',
    },
  },
];

function buildHexPrismWithHole(
  acrossFlats: number,
  height: number,
  innerRadius = 0,
): TriangleMesh {
  const rCircum = Math.max(1, acrossFlats / Math.sqrt(3));
  const mc = new MeshCollector();
  const outer: Vec2[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    outer.push([Math.cos(a) * rCircum, Math.sin(a) * rCircum]);
  }

  if (innerRadius <= 0.1) {
    return buildExtrudedProfileMesh({
      plane: 'XY',
      planeOffset: 0,
      shapes: [
        {
          id: 'hex',
          kind: 'polygon',
          cx: 0,
          cy: 0,
          width: rCircum * 2,
          height: rCircum * 2,
          radius: rCircum,
          innerRadius: 0,
          sides: 6,
          rotationDeg: 0,
        },
      ],
      distance: height,
      symmetric: false,
      draftDeg: 0,
    });
  }

  // Шестигранная гайка с круглым резьбовым отверстием: 24 сегмента снаружи и внутри
  const segs = 24;
  const rIn = Math.min(rCircum * 0.78, Math.max(0.5, innerRadius));
  const bOut: Vec3[] = [];
  const tOut: Vec3[] = [];
  const bIn: Vec3[] = [];
  const tIn: Vec3[] = [];

  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    // Расстояние до грани шестигранника под углом a
    const sector = ((a % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
    const rHex = (acrossFlats * 0.5) / Math.cos(sector - Math.PI / 6);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    bOut.push([ca * rHex, 0, sa * rHex]);
    tOut.push([ca * rHex, height, sa * rHex]);
    bIn.push([ca * rIn, 0, sa * rIn]);
    tIn.push([ca * rIn, height, sa * rIn]);
  }

  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    mc.addQuad(bOut[i], tOut[i], tOut[j], bOut[j]);
    mc.addQuad(bIn[j], tIn[j], tIn[i], bIn[i]);
    mc.addQuad(tOut[i], tIn[i], tIn[j], tOut[j], [0, 1, 0]);
    mc.addQuad(bIn[i], bOut[i], bOut[j], bIn[j], [0, -1, 0]);
  }

  const hexBot: Vec3[] = outer.map(([x, z]) => [x, 0, z]);
  const hexTop: Vec3[] = outer.map(([x, z]) => [x, height, z]);
  mc.addLoopEdges(hexBot, true);
  mc.addLoopEdges(hexTop, true);
  for (let i = 0; i < 6; i++) mc.addEdge(hexBot[i], hexTop[i]);
  mc.addLoopEdges(bIn, true);
  mc.addLoopEdges(tIn, true);
  return mc.build();
}

function buildSpurGearMesh(feat: StandardPartFeature): TriangleMesh {
  const m = Math.max(0.5, feat.moduleOrPitch || 2);
  const z = Math.max(6, Math.min(80, Math.round(feat.teethOrCount || 20)));
  const faceWidth = Math.max(2, feat.length || 12);
  const boreDiameter = Math.max(2, feat.nominalDiameter || 10);

  const pitchRadius = (m * z) * 0.5;
  const addendum = m;
  const dedendum = 1.25 * m;
  const rOuter = pitchRadius + addendum;
  const rRoot = Math.max(boreDiameter * 0.65 + 1.5, pitchRadius - dedendum);
  const rBore = Math.min(rRoot - 1.2, boreDiameter * 0.5);

  // Формируем замкнутый контур зубчатого венца (4 точки на зуб: впадина, бок, вершина, бок)
  const ptsPerTooth = 4;
  const totalPts = z * ptsPerTooth;
  const bOut: Vec3[] = [];
  const tOut: Vec3[] = [];
  const bIn: Vec3[] = [];
  const tIn: Vec3[] = [];

  for (let t = 0; t < z; t++) {
    const baseAngle = (t / z) * Math.PI * 2;
    const step = (Math.PI * 2) / z;
    // Доли шага зуба: впадина -> эвольвента подъёма -> площадка вершины -> эвольвента спуска
    const profile: [number, number][] = [
      [baseAngle + step * 0.0, rRoot],
      [baseAngle + step * 0.22, rRoot],
      [baseAngle + step * 0.36, rOuter],
      [baseAngle + step * 0.64, rOuter],
    ];
    for (let k = 0; k < ptsPerTooth; k++) {
      const [ang, r] = profile[k];
      bOut.push([Math.cos(ang) * r, 0, Math.sin(ang) * r]);
      tOut.push([Math.cos(ang) * r, faceWidth, Math.sin(ang) * r]);

      const inAng = baseAngle + (k / ptsPerTooth) * step;
      bIn.push([Math.cos(inAng) * rBore, 0, Math.sin(inAng) * rBore]);
      tIn.push([Math.cos(inAng) * rBore, faceWidth, Math.sin(inAng) * rBore]);
    }
  }

  const mc = new MeshCollector();
  for (let i = 0; i < totalPts; i++) {
    const j = (i + 1) % totalPts;
    mc.addQuad(bOut[i], tOut[i], tOut[j], bOut[j]);
    mc.addQuad(bIn[j], tIn[j], tIn[i], bIn[i]);
    mc.addQuad(tOut[i], tIn[i], tIn[j], tOut[j], [0, 1, 0]);
    mc.addQuad(bIn[i], bOut[i], bOut[j], bIn[j], [0, -1, 0]);
  }
  mc.addLoopEdges(bOut, true);
  mc.addLoopEdges(tOut, true);
  mc.addLoopEdges(bIn, true);
  mc.addLoopEdges(tIn, true);

  // Ступица (Hub) сверху зубчатого колеса
  const hubOuterR = Math.min(rRoot * 0.72, rBore + Math.max(3, m * 2.2));
  if (hubOuterR > rBore + 1.2) {
    const hub = buildPipeMesh(hubOuterR, rBore, faceWidth * 0.45, 24);
    mc.appendMesh(hub, [0, faceWidth, 0]);
  }

  return mc.build();
}

export function buildStandardPartMesh(feat: StandardPartFeature): TriangleMesh {
  const mc = new MeshCollector();
  const d = Math.max(1.5, feat.nominalDiameter || 8);
  const len = Math.max(2, feat.length || 25);

  switch (feat.partType) {
    case 'spur_gear':
      return buildSpurGearMesh(feat);

    case 'hex_bolt': {
      const headAF = Math.max(d * 1.5, feat.outerWidth || d * 1.625);
      const headH = Math.max(d * 0.6, feat.wallThickness || d * 0.65);
      const shaft = buildCylinderMesh(d * 0.5, d * 0.5, len, 24);
      const head = buildHexPrismWithHole(headAF, headH, 0);
      const chamferTip = buildCylinderMesh(d * 0.42, d * 0.5, Math.min(1.5, len * 0.1), 20);
      mc.appendMesh(chamferTip, [0, 0, 0]);
      mc.appendMesh(shaft, [0, 0, 0]);
      mc.appendMesh(head, [0, len, 0]);
      return mc.build();
    }

    case 'socket_bolt': {
      const headD = Math.max(d * 1.45, feat.outerWidth || d * 1.65);
      const headH = Math.max(d * 0.85, feat.wallThickness || d);
      const shaft = buildCylinderMesh(d * 0.5, d * 0.5, len, 24);
      const head = buildPipeMesh(headD * 0.5, d * 0.42, headH, 24);
      const headBase = buildCylinderMesh(headD * 0.5, headD * 0.5, headH * 0.35, 24);
      mc.appendMesh(shaft, [0, 0, 0]);
      mc.appendMesh(headBase, [0, len, 0]);
      mc.appendMesh(head, [0, len + headH * 0.35, 0]);
      return mc.build();
    }

    case 'hex_nut': {
      const af = Math.max(d * 1.5, feat.outerWidth || d * 1.625);
      const h = Math.max(d * 0.65, feat.length || d * 0.8);
      return buildHexPrismWithHole(af, h, d * 0.5);
    }

    case 'washer': {
      const rIn = d * 0.5;
      const rOut = Math.max(rIn + 1.5, (feat.outerWidth || d * 2) * 0.5);
      const h = Math.max(0.5, feat.length || 1.6);
      return buildPipeMesh(rOut, rIn, h, 28);
    }

    case 'bearing': {
      const rIn = d * 0.5;
      const rOut = Math.max(rIn + 4, (feat.outerWidth || d * 2.75) * 0.5);
      const width = Math.max(3, feat.length || 7);
      const ringWall = Math.max(1.2, (rOut - rIn) * 0.26);
      const outerRing = buildPipeMesh(rOut, rOut - ringWall, width, 28);
      const innerRing = buildPipeMesh(rIn + ringWall, rIn, width, 28);
      mc.appendMesh(outerRing, [0, 0, 0]);
      mc.appendMesh(innerRing, [0, 0, 0]);

      const midR = (rIn + rOut) * 0.5;
      const ballR = Math.max(0.8, (rOut - rIn - ringWall * 1.8) * 0.5);
      const ballCount = Math.max(5, Math.min(16, Math.round(feat.teethOrCount || 7)));
      const ballMesh = buildSphereMesh(ballR);
      for (let i = 0; i < ballCount; i++) {
        const a = (i / ballCount) * Math.PI * 2;
        mc.appendMesh(ballMesh, [
          Math.cos(a) * midR,
          width * 0.5 - ballR,
          Math.sin(a) * midR,
        ]);
      }
      return mc.build();
    }

    case 'flange': {
      const rIn = d * 0.5;
      const rDisk = Math.max(rIn + 10, (feat.outerWidth || d * 2.8) * 0.5);
      const totalH = Math.max(6, len);
      const diskH = Math.max(3, Math.min(totalH * 0.55, feat.wallThickness || 7));
      const neckR = rIn + (rDisk - rIn) * 0.42;

      const disk = buildPipeMesh(rDisk, rIn, diskH, 32);
      const neck = buildPipeMesh(neckR, rIn, totalH - diskH, 28);
      mc.appendMesh(disk, [0, 0, 0]);
      mc.appendMesh(neck, [0, diskH, 0]);

      // Болтовые втулки/индикаторы отверстий по делительной окружности
      const holeCount = Math.max(3, Math.min(16, Math.round(feat.teethOrCount || 6)));
      const boltCircleR = (neckR + rDisk) * 0.5;
      const holeR = Math.max(1.5, (feat.moduleOrPitch || 6) * 0.5);
      const boss = buildPipeMesh(holeR + 1.1, holeR, diskH + 0.4, scaleSegments(14, 8));
      for (let i = 0; i < holeCount; i++) {
        const a = (i / holeCount) * Math.PI * 2;
        mc.appendMesh(boss, [Math.cos(a) * boltCircleR, 0, Math.sin(a) * boltCircleR]);
      }
      return mc.build();
    }

    case 'angle_bracket': {
      const legA = Math.max(15, feat.length || 45);
      const legB = Math.max(15, feat.outerDepth || 45);
      const width = Math.max(10, feat.outerWidth || 35);
      const t = Math.max(2, Math.min(Math.min(legA, legB) * 0.35, feat.wallThickness || 5));

      const basePlate = buildBoxMesh(legA, t, width);
      mc.appendMesh(basePlate, [0, 0, 0]);

      const vertPlate = buildBoxMesh(t, legB - t, width);
      mc.appendMesh(vertPlate, [-legA * 0.5 + t * 0.5, t, 0]);

      // Центральное треугольное ребро жёсткости (косынка)
      const ribThick = Math.max(2, t * 0.85);
      const rib = buildExtrudedProfileMesh({
        plane: 'XZ',
        planeOffset: 0,
        shapes: [
          {
            id: 'rib',
            kind: 'polygon',
            cx: -legA * 0.15,
            cy: legB * 0.35,
            width: legA * 0.5,
            height: legB * 0.5,
            radius: Math.min(legA, legB) * 0.28,
            innerRadius: 0,
            sides: 3,
            rotationDeg: 15,
          },
        ],
        distance: ribThick,
        symmetric: true,
        draftDeg: 0,
      });
      mc.appendMesh(rib, [0, 0, 0]);
      return mc.build();
    }

    case 'pcb_enclosure': {
      const w = Math.max(25, feat.outerWidth || 80);
      const depth = Math.max(25, feat.outerDepth || 55);
      const h = Math.max(8, feat.length || 24);
      const wall = Math.max(1.2, Math.min(Math.min(w, depth) * 0.2, feat.wallThickness || 2.4));

      // Дно корпуса
      const floor = buildBoxMesh(w, wall, depth);
      mc.appendMesh(floor, [0, 0, 0]);

      // 4 стенки
      const wallH = Math.max(2, h - wall);
      const frontBack = buildBoxMesh(w, wallH, wall);
      const leftRight = buildBoxMesh(wall, wallH, Math.max(1, depth - wall * 2));
      mc.appendMesh(frontBack, [0, wall, depth * 0.5 - wall * 0.5]);
      mc.appendMesh(frontBack, [0, wall, -depth * 0.5 + wall * 0.5]);
      mc.appendMesh(leftRight, [-w * 0.5 + wall * 0.5, wall, 0]);
      mc.appendMesh(leftRight, [w * 0.5 - wall * 0.5, wall, 0]);

      // 4 угловые стойки (Standoffs) под плату
      const standoffH = Math.max(2, Math.min(wallH - 1, feat.moduleOrPitch || 6));
      const holeR = Math.max(1, (feat.nominalDiameter || 3) * 0.5);
      const bossR = holeR + 2.0;
      const standoff = buildPipeMesh(bossR, holeR, standoffH, 16);
      const dx = w * 0.5 - wall - bossR - 1.5;
      const dz = depth * 0.5 - wall - bossR - 1.5;
      if (dx > 2 && dz > 2) {
        mc.appendMesh(standoff, [-dx, wall, -dz]);
        mc.appendMesh(standoff, [dx, wall, -dz]);
        mc.appendMesh(standoff, [dx, wall, dz]);
        mc.appendMesh(standoff, [-dx, wall, dz]);
      }
      return mc.build();
    }

    case 'heatsink': {
      const w = Math.max(15, feat.outerWidth || 60);
      const depth = Math.max(15, feat.outerDepth || 50);
      const totalH = Math.max(6, feat.length || 22);
      const baseH = Math.max(2, Math.min(totalH * 0.5, feat.wallThickness || 4));
      const finCount = Math.max(2, Math.min(28, Math.round(feat.teethOrCount || 9)));
      const finThick = Math.max(1, Math.min((w / finCount) * 0.7, feat.moduleOrPitch || 2.2));
      const finH = Math.max(2, totalH - baseH);

      const base = buildBoxMesh(w, baseH, depth);
      mc.appendMesh(base, [0, 0, 0]);

      const fin = buildBoxMesh(finThick, finH, depth);
      const span = w - finThick;
      for (let i = 0; i < finCount; i++) {
        const x = finCount === 1 ? 0 : -span * 0.5 + (i / (finCount - 1)) * span;
        mc.appendMesh(fin, [x, baseH, 0]);
      }
      return mc.build();
    }
  }
}

// Справочник метрических резьб ISO (М2 .. М20) для Мастера отверстий и крепежа
export interface MetricThreadSpec {
  label: string;
  nominalMm: number;
  pitchMm: number;
  clearanceDrillMm: number;
  tapDrillMm: number;
  counterboreDiaMm: number;
  counterboreDepthMm: number;
  countersinkDiaMm: number;
}

export const METRIC_THREADS: MetricThreadSpec[] = [
  { label: 'M2', nominalMm: 2, pitchMm: 0.4, clearanceDrillMm: 2.4, tapDrillMm: 1.6, counterboreDiaMm: 4.4, counterboreDepthMm: 2.2, countersinkDiaMm: 4.4 },
  { label: 'M2.5', nominalMm: 2.5, pitchMm: 0.45, clearanceDrillMm: 2.9, tapDrillMm: 2.05, counterboreDiaMm: 5.4, counterboreDepthMm: 2.7, countersinkDiaMm: 5.5 },
  { label: 'M3', nominalMm: 3, pitchMm: 0.5, clearanceDrillMm: 3.4, tapDrillMm: 2.5, counterboreDiaMm: 6.5, counterboreDepthMm: 3.3, countersinkDiaMm: 6.6 },
  { label: 'M4', nominalMm: 4, pitchMm: 0.7, clearanceDrillMm: 4.5, tapDrillMm: 3.3, counterboreDiaMm: 8.0, counterboreDepthMm: 4.4, countersinkDiaMm: 9.0 },
  { label: 'M5', nominalMm: 5, pitchMm: 0.8, clearanceDrillMm: 5.5, tapDrillMm: 4.2, counterboreDiaMm: 9.5, counterboreDepthMm: 5.4, countersinkDiaMm: 11.0 },
  { label: 'M6', nominalMm: 6, pitchMm: 1.0, clearanceDrillMm: 6.6, tapDrillMm: 5.0, counterboreDiaMm: 11.0, counterboreDepthMm: 6.5, countersinkDiaMm: 13.4 },
  { label: 'M8', nominalMm: 8, pitchMm: 1.25, clearanceDrillMm: 9.0, tapDrillMm: 6.8, counterboreDiaMm: 14.5, counterboreDepthMm: 8.6, countersinkDiaMm: 17.8 },
  { label: 'M10', nominalMm: 10, pitchMm: 1.5, clearanceDrillMm: 11.0, tapDrillMm: 8.5, counterboreDiaMm: 17.5, counterboreDepthMm: 10.8, countersinkDiaMm: 22.0 },
  { label: 'M12', nominalMm: 12, pitchMm: 1.75, clearanceDrillMm: 13.5, tapDrillMm: 10.2, counterboreDiaMm: 20.0, counterboreDepthMm: 13.0, countersinkDiaMm: 26.0 },
  { label: 'M16', nominalMm: 16, pitchMm: 2.0, clearanceDrillMm: 17.5, tapDrillMm: 14.0, counterboreDiaMm: 26.0, counterboreDepthMm: 17.5, countersinkDiaMm: 34.0 },
  { label: 'M20', nominalMm: 20, pitchMm: 2.5, clearanceDrillMm: 22.0, tapDrillMm: 17.5, counterboreDiaMm: 33.0, counterboreDepthMm: 21.5, countersinkDiaMm: 42.0 },
];

export function orientAlongAxis(mesh: TriangleMesh, axis: 'X' | 'Y' | 'Z'): TriangleMesh {
  if (axis === 'X') return transformMesh(mesh, { rz: -90 });
  if (axis === 'Z') return transformMesh(mesh, { rx: 90 });
  return mesh;
}
