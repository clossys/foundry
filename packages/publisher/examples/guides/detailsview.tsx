"use client";
import { DetailsView, type DetailsViewSection } from "@clossys/publisher/web/client";

const sections: DetailsViewSection[] = [{
  id: "identity", title: "Identity",
  block: { kind: "detail", props: { fields: [{ label: "Identifier", value: "one" }] } },
}];

export function RecordArea() {
  return <DetailsView
    sections={sections}
    empty={{ title: "No sections" }}
  />;
}

export default RecordArea;
