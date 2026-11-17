"use client";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { prepareRegisteredRoutePage } from "./registered-route-binding.js";
import type { PreparedRegisteredPage, RegisteredRoutePageProps } from "./registered-route-binding.js";
import { isRegionPageRouteRegistration } from "../core/route-identities.js";
import { normalizeRegionPageRoute } from "../core/route-identities.js";
import type { RegionPageRouteRegistry } from "../core/route-registry.js";
import type { RegisteredPageHeaderLease, RegisteredRouteRuntime } from "./registered-route-binding.js";
import { PageHeaderModule } from "@clossys/designer/shell";
import { RegisteredPublicationOutlet } from "./registered-publication-outlet.js";
import { registeredPublicationSnapshot } from "./registered-route-query.js";
// Every registered route page holds its one Frame header lease here, by construction: the binder places
// it in the Frame's main slot and the Frame keeps the header data without rendering a second lease.
const leasePageHeader: RegisteredPageHeaderLease = header => <PageHeaderModule key="registered-page-header" id={header.id} header={{ ...header.data, ...(header.actions ? { actions: { render: header.actions.render } } : {}) }} />;
const noSubscribe = () => () => {};
const zeroRevision = () => 0;
export function RegisteredRoutePage({ registry, routeId, useRuntime, renderActions, publication }: RegisteredRoutePageProps) {
  const route = registry.routes.find(route => route.routeId === routeId);
  if (!route) throw new Error("Registered route identity is unavailable");
  // The derived Designer body read the whole-Studio provider, which retired with the Studio (owner decision 8).
  if (!isRegionPageRouteRegistration(route) && route.composition.binding.body?.source.kind === "derived") throw new Error("Registered route refused: the derived Designer body needs the retired Studio provider");
  return <StaticRegisteredRoutePage registry={registry} routeId={routeId} useRuntime={useRuntime} renderActions={renderActions} publication={publication} />;
}
export function StaticRegisteredRoutePage({ registry, routeId, useRuntime, renderActions, publication: suppliedPublication }: RegisteredRoutePageProps) {
  const source = registry.routes.find(route => route.routeId === routeId)!;
  const route = source && isRegionPageRouteRegistration(source) ? normalizeRegionPageRoute(registry as RegionPageRouteRegistry, source) : source;
  const runtime: RegisteredRouteRuntime = useRuntime(route);
  let failure: unknown;
  const page = runtime?.page, publication = suppliedPublication ?? page?.options.publication;
  const revision = useSyncExternalStore(page?.subscribe ?? noSubscribe, page?.revision ?? zeroRevision, zeroRevision);
  const published = useRef<string | undefined>(undefined);
  useEffect(() => { page?.activate(); return () => { page?.deactivate(); }; }, [page, routeId]);
  useEffect(() => { if (page) void (runtime.itemPath === undefined ? page.start() : page.loadItem(runtime.itemPath)).catch(() => {}); }, [page, routeId, runtime.itemPath]);
  let result: PreparedRegisteredPage | undefined, node: import("react").ReactNode, regions: ReturnType<NonNullable<PreparedRegisteredPage["renderRegions"]>> | undefined;
  try {
    if (runtime && failure === undefined) {
      result = prepareRegisteredRoutePage(registry, routeId, runtime, renderActions, leasePageHeader);
      if (publication && result.renderRegions) regions = result.renderRegions(runtime.cell);
      else if (result.status === "ready") node = result.assembly.render(runtime.cell);
    }
  } catch (error) { failure = error; }
  const status = failure !== undefined || result?.status === "refused" ? "error" : result?.routeState?.main ?? (result?.status === "ready" || result?.status === "stream" ? "ready" : result?.status === "pending" ? "loading" : "error");
  const navigating = failure !== undefined || result?.status === "refused" ? false : result?.routeState?.navigating ?? status === "loading";
  const identity = `${routeId}:${status}:${navigating}:${result?.regionHash ?? (result?.status === "ready" ? result.assembly.snapshot.hash : status)}`;
  const initial = useMemo(() => {
    if (!publication) return undefined;
    if (regions) return registeredPublicationSnapshot(regions, { main: status, navigating }, page?.commandGroups());
    const previous = publication.getSnapshot();
    // A refused/pending route still owns the same shell. Retain already selected
    // regions while the frame displays its route state; do not remount chat.
    return previous ? Object.freeze({ ...previous, routeId, state: Object.freeze({ main: status, navigating }) })
      : registeredPublicationSnapshot({ routeId, trail: {}, regions: {} }, { main: status, navigating }, page?.commandGroups());
  }, [publication, identity, revision]);
  useEffect(() => {
    if (!publication) return;
    publication.activate(routeId);
    if (published.current === identity) return;
    published.current = identity;
    if (regions && (status === "ready" || result?.status === "stream")) publication.setPage(regions, page);
    publication.setState({ main: status, navigating }, page);
  }, [publication, routeId, identity, status, navigating]);
  if (publication) return initial && publication.Frame ? <RegisteredPublicationOutlet publication={publication} initial={initial} /> : null;
  if (failure !== undefined) throw failure;
  if (result?.status !== "ready") throw new Error(`Registered route ${result?.status ?? "refused"}: ${result && "findings" in result ? result.findings.join("; ") : "Runtime unavailable"}`);
  return node;
}

