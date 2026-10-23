import { Items } from "@clossys/designer/blocks/server";

function FeatureStatus() {
  return (
    <section>
      <h2 id="feature-status-heading">Feature status</h2>
      <Items
        aria-labelledby="feature-status-heading"
        arrangement="rows"
        columns={1}
        order="none"
        reveal="all"
        treatment="rule"
        scale="item"
        items={[
          { id: "search", heading: "Search", description: "Find a record.", badge: { label: "Live", tone: "success" } },
          { id: "imports", heading: "Imports", description: "Bring records together.", badge: { label: "In progress", tone: "info" } },
          { id: "exports", heading: "Exports", description: "Take a copy with you.", badge: { label: "Planned", tone: "neutral" } },
        ]}
      />
    </section>
  );
}

export default FeatureStatus;
