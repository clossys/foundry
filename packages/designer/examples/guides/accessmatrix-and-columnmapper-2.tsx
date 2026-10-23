import { useState } from "react";
import { ColumnMapper, type ColumnMapperProps } from "@clossys/designer/blocks";

const columnMapperSample: ColumnMapperProps = {
  targets: [{ id: "name", label: "Full name", kind: "text", required: true }, { id: "email", label: "Email", kind: "text", required: true }, { id: "department", label: "Department", kind: "enum", required: false }, { id: "start", label: "Start date", kind: "date", required: false }],
  sourceColumns: [
    { id: "name", header: "Name", samples: ["Ada Lovelace", "Grace Hopper"] },
    { id: "email", header: "E-mail address", samples: ["ada@example.com", "grace@example.com"] },
    { id: "team", header: "Team", samples: ["Research", "Operations"] },
    { id: "joined", header: "Joined", samples: ["2024-03-01", "2025-11-17"] },
  ],
  mapping: { name: "name", email: null, department: "team", start: "joined" },
  onMappingChange: () => {},
  labels: {
    legend: "Match file columns to fields", notMapped: "Not mapped", required: "Required",
    requiredMissing: target => `${target} needs a column`, duplicate: header => `"${header}" is used more than once`,
    samples: values => `Examples: ${values.join(", ")}`, summary: (mapped, total, problems) => `${mapped} of ${total} fields mapped, ${problems} to fix`,
  },
};

export function PeopleColumnMapping() {
  const [mapping, setMapping] = useState(columnMapperSample.mapping);
  return <ColumnMapper {...columnMapperSample} mapping={mapping} onMappingChange={setMapping} />;
}

export default PeopleColumnMapping;
