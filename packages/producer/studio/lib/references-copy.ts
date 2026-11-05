import type { ReferencesCopy } from '../sections/studio-references';
import { studioCopy } from './studio-copy';

/** Resolve the existing References section labels from pinned Writer records. */
export function referencesCopy(): ReferencesCopy {
  return {
    title: studioCopy('studio.references-title'),
    description: studioCopy('studio.references-description'),
    uses: studioCopy('studio.references-uses'),
    usedBy: studioCopy('studio.references-used-by'),
    lineage: studioCopy('studio.references-lineage'),
    version: studioCopy('studio.references-version'),
    source: studioCopy('studio.references-source'),
    none: studioCopy('studio.references-none'),
  };
}
