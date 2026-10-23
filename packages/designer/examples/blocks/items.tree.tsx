import { Tree, type TreeNodeData } from "@clossys/designer/blocks/server";

function OrganizationTree() {
  const nodes: TreeNodeData[] = [
    { id: "organization", heading: "Organization", description: "Sample structure." },
    { id: "research", parent: "organization", heading: "Research", edgeLabel: "Includes", figure: { value: "4", delta: "+1", trend: "up" } },
    { id: "operations", parent: "organization", heading: "Operations", edgeLabel: "Includes", status: { tone: "info", label: "Forming" } },
  ];
  return <>
    <h2 id="organization-structure">Organization structure</h2>
    <Tree nodes={nodes} labelledBy="organization-structure" />
  </>;
}

export default OrganizationTree;
