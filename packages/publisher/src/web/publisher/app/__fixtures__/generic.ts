export function genericInventory() {
  const states = { loading: { declared: false, scope: "none", condition: null }, empty: { declared: true, scope: "record", condition: "No supplied record" }, error: { declared: false, scope: "none", condition: null } };
  const common = { transport: "hash", parentRecordRoute: null, pathParameters: [], frame: "frames.app-shell", layoutConfig: "stack.index", fills: "unassigned", contentRefs: "unassigned", declaredStates: states };
  return { schemaVersion: 1, artifactType: "app-route-inventory", source: { head: "a".repeat(40), tree: "b".repeat(40) },
    routes: [
      { ...common, id: "sample.index", label: "Samples", path: "/#/samples", kind: "index", lane: "Collection" },
      { ...common, id: "sample.record", label: "Sample record", path: "/#/samples/:sampleId", pathParameters: ["sampleId"], kind: "details", lane: "Record" },
      { ...common, id: "sample.tab", label: "Overview", path: "/#/samples/:sampleId?tab=overview", pathParameters: ["sampleId"], kind: "detail-tab", lane: "Record", parentRecordRoute: "sample.record" },
      { ...common, id: "sample.studio", label: "Sample studio", path: "/studio/sample", transport: "next", kind: "native-page", lane: "Studio" },
    ], nonAddressableTabs: [{ hostRouteId: "sample.studio", tabIds: ["one", "two"], routeIdentity: null }] };
}
