import type { CoverageInput } from "../types.js";

export const fixture = (): CoverageInput => ({
  catalog: {
    placements: [{ layer: "strings", nodes: [{ id: "interface", label: "Interface", children: [{ id: "labels", label: "Labels", leaves: ["strings.labels"] }] }] }],
    slots: [{ id: "strings.labels", layer: "strings", status: "draft", requires: [], contract: { kind: "string", source: "writer" } }],
  },
  designer: { slots: [] },
  connections: { nodes: [{ id: "publisher:example", uses: ["strings.labels"] }], adminRoots: ["publisher:example"], completeAdminGraph: true },
});
