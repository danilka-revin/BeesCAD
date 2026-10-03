// Heavy feature-tree recomputation runs off the UI thread so interaction stays
// responsive while a large model rebuilds, including on older CPUs.
import { evaluateDocument } from './evaluator';
import { setPerfMode, type PerfProfile } from '../perf';
import type { CadDocument, EvaluatedScene } from './types';

interface WorkerRequest {
  id: number;
  doc: CadDocument;
  profile: PerfProfile;
}
interface WorkerResponse {
  id: number;
  scene?: EvaluatedScene;
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};

workerScope.onmessage = (event) => {
  const { id, doc, profile } = event.data;
  try {
    // Worker has no navigator/window. Apply the main thread's selected LOD before tessellation.
    setPerfMode(profile);
    const scene = evaluateDocument(doc);
    const transfer: Transferable[] = [];
    for (const body of scene.bodies) {
      transfer.push(body.mesh.positions.buffer, body.mesh.normals.buffer, body.mesh.edges.buffer);
    }
    for (const sketch of scene.sketches) transfer.push(sketch.segments3D.buffer);
    workerScope.postMessage({ id, scene }, transfer);
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
