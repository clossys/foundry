interface GraphNode { readonly id: string; readonly kind: string; readonly label: string }
interface GraphEdge { readonly id: string; readonly from: string; readonly to: string; readonly kind: string; readonly weight?: number }
interface GraphInput { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] }
interface GraphModelEdge extends GraphEdge { readonly selfLoop: boolean }
interface GraphModel { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphModelEdge[] }
type GraphErrorCode = "INVALID_INPUT" | "NODE_CAP" | "EDGE_CAP" | "DUPLICATE_NODE" | "DUPLICATE_EDGE" | "UNKNOWN_ENDPOINT" | "UNKNOWN_NODE" | "INVALID_OPTIONS";
interface GraphNeighborOptions { readonly direction?: "in" | "out" | "both"; readonly edgeKinds?: readonly string[] }
interface GraphSubgraphOptions { readonly depth: number; readonly edgeKinds?: readonly string[]; readonly nodeKinds?: readonly string[] }
interface GraphDegree { readonly id: string; readonly in: number; readonly out: number; readonly total: number }
interface GraphKindGroup { readonly kind: string; readonly nodes: readonly GraphNode[] }
interface GraphPosition { readonly id: string; readonly x: number; readonly y: number }
interface GraphRadialOptions { readonly ringGap?: number }
interface GraphForceOptions { readonly iterations?: number; readonly seed?: number }
interface GraphEdgeRoutingHint { readonly id: string; readonly type: "straight"; readonly selfLoop: boolean; readonly parallelIndex: number; readonly parallelCount: number }
export type { GraphInput, GraphModel, GraphErrorCode, GraphNeighborOptions, GraphSubgraphOptions, GraphDegree, GraphKindGroup, GraphPosition, GraphRadialOptions, GraphForceOptions, GraphEdgeRoutingHint };
export {};
