"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { RegisteredPublicationSession, RegisteredPublicationSnapshot } from "./registered-route-query.js";

/** The route prepares initial native regions synchronously. Both server and
 * hydration read that exact snapshot; subsequent session updates change props
 * on the same Designer frame component, preserving its inspector/chat subtree. */
export function RegisteredPublicationOutlet({ publication, initial }: { readonly publication: RegisteredPublicationSession; readonly initial: RegisteredPublicationSnapshot }) {
  const baseline = useMemo(() => publication.getSnapshot(), [initial, publication]);
  const getServerSnapshot = useCallback(() => initial, [initial]);
  const getSnapshot = useCallback(() => {
    const current = publication.getSnapshot();
    return current && current !== baseline && current.routeId === initial.routeId ? current : initial;
  }, [publication, initial, baseline]);
  const snapshot = useSyncExternalStore(publication.subscribe, getSnapshot, getServerSnapshot);
  const Frame = publication.Frame;
  if (!Frame) throw new TypeError("A declarative selected Designer frame adapter is required");
  return <Frame publication={publication.publication} ports={publication.ports} snapshot={snapshot} />;
}
