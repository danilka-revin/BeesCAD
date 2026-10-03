import { useSyncExternalStore } from 'react';
import { getPerfConfig, subscribePerf, type PerfConfig } from '../perf';

export function usePerf(): PerfConfig {
  return useSyncExternalStore(subscribePerf, getPerfConfig, getPerfConfig);
}
