export interface RelationGraphNode<Kind extends string = string> {
  id: string;
  label: string;
  kind: Kind;
  description?: string;
  status?: string;
  href?: string;
}
export interface RelationGraphEdge {
  from: string;
  to: string;
  label?: string;
}
export interface RelationGraphProps<Kind extends string = string> {
  nodes: readonly RelationGraphNode<NoInfer<Kind>>[];
  edges: readonly RelationGraphEdge[];
  /** The host's closed vocabulary, checked for every node at runtime. */
  kinds: readonly Kind[];
  label: string;
  selectedId?: string;
  /** Activation reports the authored id; selection remains controlled. */
  onSelectionChange?: (id: string) => void;
  /** @default "No relationships" */
  emptyMessage?: string;
  /** @default "Drawing unavailable: cycle" */
  unavailableMessage?: string;
  /** @default "Incoming" */
  incomingLabel?: string;
  /** @default "Outgoing" */
  outgoingLabel?: string;
  /** @default "Refused links" */
  refusedLabel?: string;
}
