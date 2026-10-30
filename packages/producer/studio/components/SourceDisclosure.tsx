'use client';

import { useStudioUI } from './StudioSelection';

export interface SourceDisclosureProps {
  source: string;
}

/** Raw cell source is read-only and hidden until the selected disclosure opens. */
export function SourceDisclosure({ source }: SourceDisclosureProps) {
  const { Disclosure } = useStudioUI();
  return <Disclosure title="Source" defaultExpanded={false}>
    <pre aria-label="Cell source">{source}</pre>
  </Disclosure>;
}
