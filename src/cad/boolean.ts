// Mesh-based Boolean operations for the current BeesCAD prototype.
// three-bvh-csg uses a BVH and runs inside evaluator.worker.ts so expensive
// intersections never block the UI thread. It is not a tolerance-grade kernel;
// production STEP/precision workflows should eventually use OpenCascade/OCCT.
import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import type { TriangleMesh } from './types';

export type MeshBoolean = 'join' | 'cut' | 'intersect';

const evaluator = new Evaluator();
evaluator.useGroups = false;
evaluator.attributes = ['position', 'normal'];

function brushFromMesh(mesh: TriangleMesh): Brush {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  const brush = new Brush(geometry, new THREE.MeshBasicMaterial());
  brush.updateMatrixWorld(true);
  return brush;
}

function geometryToMesh(geometry: THREE.BufferGeometry): TriangleMesh {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!prepared.getAttribute('normal')) prepared.computeVertexNormals();
  const position = prepared.getAttribute('position');
  const normal = prepared.getAttribute('normal');
  if (!position || position.count < 3) throw new Error('Boolean operation returned an empty mesh.');
  const positions = new Float32Array(position.array as ArrayLike<number>);
  const normals = new Float32Array(normal.array as ArrayLike<number>);
  const edgesGeo = new THREE.EdgesGeometry(prepared, 12);
  const edgeAttr = edgesGeo.getAttribute('position');
  const edges = new Float32Array(edgeAttr?.array as ArrayLike<number> || 0);
  edgesGeo.dispose();
  if (prepared !== geometry) prepared.dispose();
  return { positions, normals, edges };
}

/** Perform union (join), difference (cut), or intersection of two closed meshes. */
export function booleanMeshes(aMesh: TriangleMesh, bMesh: TriangleMesh, operation: MeshBoolean): TriangleMesh {
  const a = brushFromMesh(aMesh);
  const b = brushFromMesh(bMesh);
  try {
    const result = evaluator.evaluate(a, b, operation === 'join' ? ADDITION : operation === 'cut' ? SUBTRACTION : INTERSECTION);
    const mesh = geometryToMesh(result.geometry);
    result.geometry.dispose();
    if (mesh.positions.length < 9) throw new Error('Boolean result contains no faces.');
    return mesh;
  } finally {
    a.geometry.dispose();
    b.geometry.dispose();
    for (const mat of Array.isArray(a.material) ? a.material : [a.material]) mat.dispose();
    for (const mat of Array.isArray(b.material) ? b.material : [b.material]) mat.dispose();
  }
}
