import { useEffect, useRef, useState } from 'react';
import { evaluateDocument } from './evaluator';
import type { CadDocument, EvaluatedScene } from './types';
import type { PerfProfile } from '../perf';

export interface EvaluationState {
  scene: EvaluatedScene | null;
  busy: boolean;
  error: string | null;
}

/** Evaluate the parametric model in a module worker; stale responses are ignored. */
export function useEvaluatedScene(doc: CadDocument, profile: PerfProfile): EvaluationState {
  const [state, setState] = useState<EvaluationState>({ scene: null, busy: true, error: null });
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, busy: true, error: null }));
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('./evaluator.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; scene?: EvaluatedScene; error?: string }>) => {
        if (event.data.id !== seq.current) return;
        if (event.data.scene) setState({ scene: event.data.scene, busy: false, error: null });
        else setState((s) => ({ ...s, busy: false, error: event.data.error || 'Не удалось пересчитать модель.' }));
        worker?.terminate();
        worker = null;
      };
      worker.onerror = (event) => {
        if (id !== seq.current) return;
        worker?.terminate();
        worker = null;
        // Старые браузеры могут не поддерживать module workers. Синхронный fallback
        // оставляет модель рабочей, пусть и без фонового пересчёта.
        try {
          const scene = evaluateDocument(doc);
          setState({ scene, busy: false, error: null });
        } catch (error) {
          setState((s) => ({
            ...s,
            busy: false,
            error: error instanceof Error ? error.message : String(error || event.message),
          }));
        }
      };
      worker.postMessage({ id, doc, profile });
    } catch (error) {
      try {
        const scene = evaluateDocument(doc);
        setState({ scene, busy: false, error: null });
      } catch (fallbackError) {
        setState((s) => ({
          ...s,
          busy: false,
          error: fallbackError instanceof Error ? fallbackError.message : String(error),
        }));
      }
    }
    return () => {
      worker?.terminate();
    };
  }, [doc, profile]);

  return state;
}
