import type { Resolved } from '../catalog-core/types.js';
import { createStudioTokenReference } from '../catalog-core/studio-host-parts.js';

/** The token's registered emit mapping supplies the property; a caller supplies only its member id. */
export function specimenTokenReference(values: Resolved, memberId: string, mode: 'light' | 'dark') {
  return createStudioTokenReference(values, memberId, mode);
}
