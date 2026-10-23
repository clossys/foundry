import { Specimen } from "@clossys/designer/blocks/server";

export default function Example() { return <>
<Specimen
  label="An order record with its delivery fields, two checks and the stock level against its floor."
  panels={[
    {
      id: "order",
      title: "Order 1042",
      meta: "Placed 1 March",
      status: { tone: "info", label: "Open" },
      parts: [
        {
          id: "fields",
          type: "fields",
          items: [
            { id: "qty", label: "Quantity", value: "240 units" },
            { id: "due", label: "Due", value: "12 March" },
          ],
        },
        {
          id: "checks",
          type: "status-rows",
          label: "Checks",
          items: [
            { id: "count", label: "Stock count", status: { tone: "warning", label: "In progress" } },
            { id: "labels", label: "Labels printed", status: { tone: "success", label: "Done" } },
          ],
        },
        {
          id: "stock",
          type: "meter",
          label: "Stock level",
          value: 38,
          scaleMax: 100,
          limit: 25,
          direction: "min",
          tone: "success",
          valueText: "38 units",
          limitText: "floor 25",
        },
      ],
      footer: { assignee: { initials: "AL", name: "Alex Lane", note: "owner" } },
    },
  ]}
/>
</>; }
