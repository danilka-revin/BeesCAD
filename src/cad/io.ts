// Импорт и экспорт инженерных форматов:
// • STL (ASCII и бинарный для 3D-печати / слайсеров)
// • STEP ISO-10303-21 (AP214 Faceted B-Rep для обмена с другими САПР)
// • Wavefront OBJ
// • Инженерный чертёж 3 проекций в SVG (с основной надписью по ГОСТ) и DXF
// • Спецификация деталей и масс-инерционных характеристик (BOM CSV)
// • Импорт STL / OBJ в параметрическое дерево

import {
  getMaterial,
  type CadDocument,
  type EvaluatedScene,
  type ImportedMeshFeature,
} from './types';

function sanitizeFileSlug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'beescad_part'
  );
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&apos;');
}

// ---------------- Экспорт STL (ASCII и Binary) ----------------

export function exportStlAscii(scene: EvaluatedScene, name = 'BeesCAD_Part'): string {
  const slug = sanitizeFileSlug(name);
  const lines: string[] = [`solid ${slug}`];
  for (const body of scene.bodies) {
    if (!body.visible) continue;
    const p = body.mesh.positions;
    const n = body.mesh.normals;
    for (let i = 0; i < p.length; i += 9) {
      const nx = n[i].toFixed(5);
      const ny = n[i + 1].toFixed(5);
      const nz = n[i + 2].toFixed(5);
      lines.push(`  facet normal ${nx} ${ny} ${nz}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${p[i].toFixed(4)} ${p[i + 1].toFixed(4)} ${p[i + 2].toFixed(4)}`);
      lines.push(
        `      vertex ${p[i + 3].toFixed(4)} ${p[i + 4].toFixed(4)} ${p[i + 5].toFixed(4)}`,
      );
      lines.push(
        `      vertex ${p[i + 6].toFixed(4)} ${p[i + 7].toFixed(4)} ${p[i + 8].toFixed(4)}`,
      );
      lines.push('    endloop');
      lines.push('  endfacet');
    }
  }
  lines.push(`endsolid ${slug}`);
  return lines.join('\n') + '\n';
}

export function exportStlBinary(scene: EvaluatedScene): Uint8Array {
  let triCount = 0;
  for (const b of scene.bodies) {
    if (b.visible) triCount += Math.floor(b.mesh.positions.length / 9);
  }
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = 'BeesCAD Binary STL Export (Units: mm)';
  for (let i = 0; i < Math.min(80, header.length); i++) {
    view.setUint8(i, header.charCodeAt(i));
  }
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (const body of scene.bodies) {
    if (!body.visible) continue;
    const p = body.mesh.positions;
    const n = body.mesh.normals;
    for (let i = 0; i < p.length; i += 9) {
      view.setFloat32(offset, n[i], true);
      view.setFloat32(offset + 4, n[i + 1], true);
      view.setFloat32(offset + 8, n[i + 2], true);
      for (let k = 0; k < 9; k++) {
        view.setFloat32(offset + 12 + k * 4, p[i + k], true);
      }
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }
  return new Uint8Array(buf);
}

// ---------------- Экспорт Wavefront OBJ ----------------

export function exportObj(scene: EvaluatedScene, doc: CadDocument): string {
  const lines: string[] = [
    `# BeesCAD 3D Export — ${doc.name}`,
    `# Units: ${doc.unit}`,
  ];
  let vOffset = 1;
  for (const body of scene.bodies) {
    if (!body.visible) continue;
    lines.push(`o ${sanitizeFileSlug(body.name)}`);
    const p = body.mesh.positions;
    const n = body.mesh.normals;
    const vCount = Math.floor(p.length / 3);
    for (let i = 0; i < p.length; i += 3) {
      lines.push(`v ${p[i].toFixed(4)} ${p[i + 1].toFixed(4)} ${p[i + 2].toFixed(4)}`);
    }
    for (let i = 0; i < n.length; i += 3) {
      lines.push(`vn ${n[i].toFixed(4)} ${n[i + 1].toFixed(4)} ${n[i + 2].toFixed(4)}`);
    }
    for (let t = 0; t < vCount; t += 3) {
      const a = vOffset + t;
      const b = vOffset + t + 1;
      const c = vOffset + t + 2;
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    vOffset += vCount;
  }
  return lines.join('\n') + '\n';
}

// ---------------- Экспорт STEP (ISO-10303-21 AP214) ----------------

export function exportStepAp214(scene: EvaluatedScene, doc: CadDocument): string {
  // FACETED_BREP is a standards-based mesh exchange representation. STEP solids
  // here are faceted (not analytic NURBS surfaces); downstream CAD may expose them
  // as a mesh / faceted solid, which is suitable for hand-off but not design-history editing.
  const now = new Date().toISOString().slice(0, 19);
  const slug = sanitizeFileSlug(doc.name);
  const stepText = (s: string) => s.replace(/'/g, "''");
  const lines: string[] = [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('BeesCAD faceted solid model','${stepText(doc.name)}'),'2;1');`,
    `FILE_NAME('${slug}.step','${now}',('BeesCAD'),('BeesCAD'),'BeesCAD','BeesCAD','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN_CC2'));",
    'ENDSEC;',
    'DATA;',
  ];
  let nextId = 1;
  const alloc = (expr: string): number => {
    const id = nextId++;
    lines.push(`#${id} = ${expr};`);
    return id;
  };

  const appCtx = alloc("APPLICATION_CONTEXT('automotive design')");
  alloc(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const productCtx = alloc(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const product = alloc(`PRODUCT('${slug}','${stepText(doc.name)}','',(#${productCtx}))`);
  const formation = alloc(`PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('','',#${product},.NOT_KNOWN.)`);
  const definitionCtx = alloc(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const productDef = alloc(`PRODUCT_DEFINITION('design','',#${formation},#${definitionCtx})`);
  const productShape = alloc(`PRODUCT_DEFINITION_SHAPE('','',#${productDef})`);

  const uncertaintyPoint = alloc('UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),#UNIT_MM,\'distance_accuracy_value\',\'\')');
  const unitMm = alloc('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const unitRad = alloc('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const unitSr = alloc('( NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.) )');
  // Replace the forward unit reference in the uncertainty entity with the actual # id.
  const uncertaintyLine = lines.findIndex((line) => line.startsWith(`#${uncertaintyPoint} = `));
  lines[uncertaintyLine] = `#${uncertaintyPoint} = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.01),#${unitMm},'distance_accuracy_value','');`;
  const repContext = alloc(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertaintyPoint})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${unitMm},#${unitRad},#${unitSr})) REPRESENTATION_CONTEXT('Context3D','3D') )`);

  const pointCache = new Map<string, number>();
  const stepPoint = (x: number, y: number, z: number): number => {
    const q = [x, y, z].map((v) => (Math.abs(v) < 0.000005 ? 0 : Number(v.toFixed(5))));
    const key = q.join(',');
    const hit = pointCache.get(key);
    if (hit) return hit;
    const id = alloc(`CARTESIAN_POINT('',(${q.map((v) => v.toFixed(5)).join(',')}))`);
    pointCache.set(key, id);
    return id;
  };
  const direction = (x: number, y: number, z: number) => alloc(`DIRECTION('',(${x.toFixed(8)},${y.toFixed(8)},${z.toFixed(8)}))`);

  const brepIds: number[] = [];
  for (const body of scene.bodies) {
    if (!body.visible) continue;
    const p = body.mesh.positions;
    if (p.length < 9) continue;
    const faceIds: number[] = [];
    for (let i = 0; i + 8 < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length; ny /= length; nz /= length;
      const ref: [number, number, number] = Math.abs(nx) < 0.8 ? [1, 0, 0] : [0, 1, 0];
      let rx = ref[1] * nz - ref[2] * ny;
      let ry = ref[2] * nx - ref[0] * nz;
      let rz = ref[0] * ny - ref[1] * nx;
      const rlen = Math.hypot(rx, ry, rz) || 1;
      rx /= rlen; ry /= rlen; rz /= rlen;

      const a = stepPoint(ax, ay, az);
      const b = stepPoint(bx, by, bz);
      const c = stepPoint(cx, cy, cz);
      const loop = alloc(`POLY_LOOP('',(#${a},#${b},#${c}))`);
      const bound = alloc(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      const origin = stepPoint(ax, ay, az);
      const normalId = direction(nx, ny, nz);
      const refId = direction(rx, ry, rz);
      const placement = alloc(`AXIS2_PLACEMENT_3D('',#${origin},#${normalId},#${refId})`);
      const plane = alloc(`PLANE('',#${placement})`);
      faceIds.push(alloc(`FACE_SURFACE('',(#${bound}),#${plane},.T.)`));
    }
    if (faceIds.length) {
      const shell = alloc(`CLOSED_SHELL('${stepText(body.name)}',(${faceIds.map((id) => `#${id}`).join(',')}))`);
      brepIds.push(alloc(`FACETED_BREP('${stepText(body.name)}',#${shell})`));
    }
  }

  const items = brepIds.length ? brepIds.map((id) => `#${id}`).join(',') : `#${product}`;
  const shapeRep = alloc(`SHAPE_REPRESENTATION('${stepText(doc.name)}',(${items}),#${repContext})`);
  alloc(`SHAPE_DEFINITION_REPRESENTATION(#${productShape},#${shapeRep})`);
  alloc(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n') + '\n';
}

// ---------------- Экспорт инженерного чертежа (SVG 3 проекции по ГОСТ и DXF) ----------------

export function exportProjectionSvg(scene: EvaluatedScene, doc: CadDocument): string {
  const [sx, sy, sz] = scene.overallBbox.size;
  const [cx, cy, cz] = scene.overallBbox.center;
  const maxSpan = Math.max(20, sx, sy, sz);
  const scale = 190 / maxSpan;

  // Собираем характерные рёбра всех видимых тел
  const edgeSegments: [number, number, number, number, number, number][] = [];
  for (const b of scene.bodies) {
    if (!b.visible) continue;
    const e = b.mesh.edges;
    for (let i = 0; i < e.length; i += 6) {
      edgeSegments.push([
        e[i] - cx,
        e[i + 1] - cy,
        e[i + 2] - cz,
        e[i + 3] - cx,
        e[i + 4] - cy,
        e[i + 5] - cz,
      ]);
    }
  }

  const projectLines = (
    projFn: (x: number, y: number, z: number) => [number, number],
    ox: number,
    oy: number,
  ): string => {
    const paths: string[] = [];
    for (const [x1, y1, z1, x2, y2, z2] of edgeSegments) {
      const [u1, v1] = projFn(x1, y1, z1);
      const [u2, v2] = projFn(x2, y2, z2);
      paths.push(
        `M${(ox + u1 * scale).toFixed(1)},${(oy - v1 * scale).toFixed(1)}L${(ox + u2 * scale).toFixed(1)},${(oy - v2 * scale).toFixed(1)}`,
      );
    }
    return `<path d="${paths.join(' ')}" stroke="#0f172a" stroke-width="1.3" fill="none" />`;
  };

  // Вид спереди (X, Y), Вид сверху (X, Z), Вид слева (Z, Y)
  const frontSvg = projectLines((x, y) => [x, y], 240, 220);
  const topSvg = projectLines((x, _y, z) => [x, -z], 240, 480);
  const sideSvg = projectLines((_x, y, z) => [z, y], 580, 220);

  const mat = getMaterial(doc.defaultMaterialId);
  const drawingTitle = escapeXml(doc.name);
  const materialName = escapeXml(mat.name);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 620" width="840" height="620">
  <rect width="840" height="620" fill="#ffffff" />
  <rect x="20" y="20" width="800" height="580" fill="none" stroke="#0f172a" stroke-width="2" />
  <g stroke="#cbd5e1" stroke-width="0.6" stroke-dasharray="4 4">
    <line x1="240" y1="40" x2="240" y2="560" />
    <line x1="60" y1="220" x2="760" y2="220" />
    <line x1="60" y1="480" x2="440" y2="480" />
    <line x1="580" y1="60" x2="580" y2="380" />
  </g>
  <text x="190" y="65" font-family="sans-serif" font-size="12" fill="#475569">Вид спереди (X–Y)</text>
  <text x="195" y="365" font-family="sans-serif" font-size="12" fill="#475569">Вид сверху (X–Z)</text>
  <text x="535" y="65" font-family="sans-serif" font-size="12" fill="#475569">Вид сбоку (Z–Y)</text>
  ${frontSvg}
  ${topSvg}
  ${sideSvg}
  <!-- Основная надпись (штамп чертежа по ГОСТ 2.104) -->
  <g transform="translate(450, 465)" font-family="sans-serif" font-size="11" fill="#0f172a">
    <rect width="370" height="135" fill="#f8fafc" stroke="#0f172a" stroke-width="1.5" />
    <line x1="0" y1="35" x2="370" y2="35" stroke="#0f172a" />
    <line x1="0" y1="75" x2="370" y2="75" stroke="#0f172a" />
    <line x1="0" y1="105" x2="370" y2="105" stroke="#0f172a" />
    <line x1="230" y1="35" x2="230" y2="135" stroke="#0f172a" />
    <text x="12" y="23" font-size="14" font-weight="bold">${drawingTitle}</text>
    <text x="12" y="58">Материал: ${materialName}</text>
    <text x="242" y="58">Масса: ${(scene.totalMassGrams / 1000).toFixed(3)} кг</text>
    <text x="12" y="94">Габариты: ${sx.toFixed(1)} × ${sy.toFixed(1)} × ${sz.toFixed(1)} мм</text>
    <text x="242" y="94">Ед. изм.: ${doc.unit}</text>
    <text x="12" y="124" fill="#475569">САПР: BeesCAD (Linux Engineering CAD)</text>
    <text x="242" y="124">Лист 1 / 1</text>
  </g>
</svg>
`;
}

export function exportProjectionDxf(scene: EvaluatedScene): string {
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$INSUNITS',
    '70',
    '4', // millimeters
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
  ];

  for (const b of scene.bodies) {
    if (!b.visible) continue;
    const e = b.mesh.edges;
    for (let i = 0; i < e.length; i += 6) {
      lines.push(
        '0',
        'LINE',
        '8',
        '0',
        '10',
        e[i].toFixed(4),
        '20',
        e[i + 2].toFixed(4),
        '30',
        e[i + 1].toFixed(4),
        '11',
        e[i + 3].toFixed(4),
        '21',
        e[i + 5].toFixed(4),
        '31',
        e[i + 4].toFixed(4),
      );
    }
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n') + '\n';
}

// ---------------- Экспорт спецификации деталей и масс (BOM CSV) ----------------

export function exportBomCsv(scene: EvaluatedScene): string {
  const header =
    'Поз.;Наименование тела;Материал;Плотность (г/см3);Габариты X×Y×Z (мм);Объём (см3);Площадь (см2);Масса (г);Треугольников';
  const rows = scene.bodies.map((b, i) => {
    const mat = getMaterial(b.materialId);
    const [sx, sy, sz] = b.bbox.size;
    return [
      i + 1,
      `"${b.name.replace(/"/g, '""')}"`,
      `"${mat.name.replace(/"/g, '""')}"`,
      mat.densityGcm3.toFixed(2),
      `${sx.toFixed(1)}x${sy.toFixed(1)}x${sz.toFixed(1)}`,
      (b.volumeMm3 / 1000).toFixed(3),
      (b.areaMm2 / 100).toFixed(2),
      b.massGrams.toFixed(2),
      b.triangleCount,
    ].join(';');
  });
  return [header, ...rows].join('\n') + '\n';
}

// ---------------- Импорт внешних STL и OBJ файлов в дерево построения ----------------

export function parseStlFile(buffer: ArrayBuffer, fileName: string): ImportedMeshFeature {
  const bytes = new Uint8Array(buffer);
  const textSample = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(256, bytes.length)));
  const isAscii =
    textSample.trimStart().startsWith('solid') && textSample.includes('facet');

  const positions: number[] = [];
  const normals: number[] = [];

  if (isAscii) {
    const fullText = new TextDecoder('utf-8').decode(bytes);
    const facetRe =
      /facet\s+normal\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)[\s\S]*?vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m: RegExpExecArray | null;
    while ((m = facetRe.exec(fullText)) !== null) {
      const nx = parseFloat(m[1]) || 0;
      const ny = parseFloat(m[2]) || 1;
      const nz = parseFloat(m[3]) || 0;
      for (let v = 0; v < 3; v++) {
        positions.push(
          parseFloat(m[4 + v * 3]) || 0,
          parseFloat(m[5 + v * 3]) || 0,
          parseFloat(m[6 + v * 3]) || 0,
        );
        normals.push(nx, ny, nz);
      }
    }
  } else if (bytes.byteLength >= 84) {
    const view = new DataView(buffer);
    const triCount = Math.min(
      view.getUint32(80, true),
      Math.floor((bytes.byteLength - 84) / 50),
    );
    let offset = 84;
    for (let t = 0; t < triCount; t++) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      for (let v = 0; v < 3; v++) {
        positions.push(
          view.getFloat32(offset + 12 + v * 12, true),
          view.getFloat32(offset + 16 + v * 12, true),
          view.getFloat32(offset + 20 + v * 12, true),
        );
        normals.push(nx, ny, nz);
      }
      offset += 50;
    }
  }

  return {
    id: `imp-${Date.now().toString(36)}`,
    kind: 'imported_mesh',
    name: `Импорт STL: ${fileName.replace(/\.stl$/i, '')}`,
    sourceFormat: 'STL',
    positions,
    normals,
    scaleFactor: 1,
  };
}

export function parseObjFile(text: string, fileName: string): ImportedMeshFeature {
  const verts: [number, number, number][] = [];
  const positions: number[] = [];
  const normals: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      verts.push([
        parseFloat(parts[1]) || 0,
        parseFloat(parts[2]) || 0,
        parseFloat(parts[3]) || 0,
      ]);
    } else if (line.startsWith('f ')) {
      const parts = line.slice(2).trim().split(/\s+/);
      const indices = parts.map((tok) => {
        const idx = parseInt(tok.split('/')[0], 10);
        return idx > 0 ? idx - 1 : verts.length + idx;
      });
      for (let i = 1; i + 1 < indices.length; i++) {
        const a = verts[indices[0]];
        const b = verts[indices[i]];
        const c = verts[indices[i + 1]];
        if (!a || !b || !c) continue;
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
        positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      }
    }
  }

  return {
    id: `imp-${Date.now().toString(36)}`,
    kind: 'imported_mesh',
    name: `Импорт OBJ: ${fileName.replace(/\.obj$/i, '')}`,
    sourceFormat: 'OBJ',
    positions,
    normals,
    scaleFactor: 1,
  };
}
