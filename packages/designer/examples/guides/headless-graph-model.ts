import { validateGraph, neighbors, radialLayout, forceLayout, type GraphInput } from "@clossys/designer/blocks";

const input: GraphInput = {
  nodes: [
    { id: "program", kind: "program", label: "Program" },
    { id: "package", kind: "package", label: "Package" },
  ],
  edges: [{ id: "includes", from: "program", to: "package", kind: "includes" }],
};
const graph = validateGraph(input);
const outgoing = neighbors(graph, "program", { direction: "out" });
const rings = radialLayout(graph, "program", { ringGap: 100 });
const positions = forceLayout(graph, { iterations: 300, seed: 1 });
export { outgoing, rings, positions };
