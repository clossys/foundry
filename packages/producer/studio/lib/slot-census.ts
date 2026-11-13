import { useEffect, useRef, useState } from 'react';
import { censusStates, loadSlotCensus, type HomeSlotCensus, type SlotCensusByAgent } from './slot-census-load';

export { loadSlotCensus, type HomeSlotCensus, type SlotCensusByAgent } from './slot-census-load';

/** Refresh on the native Producer revision channel, without waiting for a gallery request. */
export function useSlotCensus(revision: number, initial?: SlotCensusByAgent): SlotCensusByAgent {
  const [census, setCensus] = useState<SlotCensusByAgent>(() => initial ?? censusStates(() => ({ state: 'loading' })));
  // A server-rendered census is already current for the first revision.
  const seeded = useRef(initial === undefined ? undefined : revision);
  useEffect(() => {
    if (seeded.current === revision) return;
    seeded.current = undefined;
    const controller = new AbortController();
    setCensus(censusStates(() => ({ state: 'loading' })));
    loadSlotCensus(controller.signal).then(value => { if (!controller.signal.aborted) setCensus(value); });
    return () => controller.abort();
  }, [revision]);
  return census;
}
