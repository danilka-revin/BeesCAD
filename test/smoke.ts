import { strict as assert } from 'node:assert';
import { buildBoxMesh, buildExtrudedProfileMesh, computeMeshMetrics } from '../src/cad/mesh-builder';
import { booleanMeshes } from '../src/cad/boolean';
import { evaluateDocument } from '../src/cad/evaluator';
import { createDemoGearboxDoc, createEmptyDoc } from '../src/cad/templates';
import { exportStlBinary, exportStlAscii, exportStepAp214, parseStlFile } from '../src/cad/io';

const box = buildBoxMesh(20, 10, 20);
const boxMetrics = computeMeshMetrics(box);
assert.ok(Math.abs(boxMetrics.volumeMm3 - 4000) < 1e-3, `box volume ${boxMetrics.volumeMm3}`);
assert.deepEqual(boxMetrics.bbox.size.map((x) => Math.round(x)), [20, 10, 20]);
const extruded = buildExtrudedProfileMesh({
  plane: 'XY', planeOffset: 0, distance: 10, symmetric: false, draftDeg: 0,
  shapes: [{ id: 'profile', kind: 'rect', cx: 0, cy: 0, width: 20, height: 20, radius: 0, innerRadius: 0, sides: 4, rotationDeg: 0 }],
});
assert.ok(Math.abs(computeMeshMetrics(extruded).volumeMm3 - 4000) < 1e-3, 'extrude mesh should be closed and consistently wound');
const extrudeCut = booleanMeshes(extruded, buildBoxMesh(4, 12, 4), 'cut');
assert.ok(Math.abs(computeMeshMetrics(extrudeCut).volumeMm3 - 3840) < 1, 'extrude result should support mesh Booleans');

// A closed-box subtraction should change the actual mesh, not just its reported volume.
const cutter = buildBoxMesh(4, 12, 4);
const cut = booleanMeshes(box, cutter, 'cut');
const cutMetrics = computeMeshMetrics(cut);
assert.ok(Math.abs(cutMetrics.volumeMm3 - 3840) < 1, `cut volume ${cutMetrics.volumeMm3}`);
assert.ok(cut.positions.length > box.positions.length, 'cut mesh should contain the inside walls');
const intersection = booleanMeshes(box, cutter, 'intersect');
assert.ok(Math.abs(computeMeshMetrics(intersection).volumeMm3 - 160) < 1, 'intersection volume should match the overlapping box');
const union = booleanMeshes(box, cutter, 'join');
assert.ok(Math.abs(computeMeshMetrics(union).volumeMm3 - 4032) < 1, 'union should match A + B - intersection volume');

const demo = createDemoGearboxDoc();
const scene = evaluateDocument(demo);
assert.ok(scene.bodies.length >= 4, `demo body count ${scene.bodies.length}`);
assert.ok(scene.totalTriangles > 100, `demo triangle count ${scene.totalTriangles}`);
assert.ok(Number.isFinite(scene.totalMassGrams) && scene.totalMassGrams > 0);
assert.equal(scene.issues.some((issue) => issue.featureId === 'hole-center' && issue.severity === 'error'), false, 'demo hole Boolean should succeed');
assert.ok(scene.bodies.find((body) => body.featureId === 'ext-base')!.volumeMm3 < 84 * 64 * 10, 'hole should reduce the base volume');

const stl = exportStlBinary(scene);
assert.ok(stl.byteLength > 84);
const ascii = exportStlAscii(scene, demo.name);
assert.ok(ascii.startsWith('solid '));
const imported = parseStlFile(stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength), 'test.stl');
assert.equal(imported.sourceFormat, 'STL');
assert.ok(imported.positions.length > 0);

const step = exportStepAp214(scene, demo);
assert.ok(step.includes('ISO-10303-21;'));
assert.ok(step.includes('END-ISO-10303-21;'));

const empty = createEmptyDoc();
assert.equal(empty.features.length, 2);
assert.equal(empty.features[0].kind, 'sketch');

process.stdout.write('BeesCAD smoke OK: mesh, boolean cut, evaluator, STL/STEP interchange, templates.\n');
