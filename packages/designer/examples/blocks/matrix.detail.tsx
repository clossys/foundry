import { DetailView } from "@clossys/designer/blocks";
import { Badge, Button } from "@clossys/designer/atoms";

function OrderDetail({ order }: { order: { id: string; owner: string; status: string; notes: string } }) {
  return (
    <DetailView
      title={`Order #${order.id}`}
      actions={<Button variant="secondary">Edit</Button>}
      fields={[
        { label: "Owner", value: order.owner },
        { label: "Status", value: <Badge variant="success">{order.status}</Badge> },
        { label: "Notes", value: order.notes, span: 2 },
      ]}
    />
  );
}

export default OrderDetail;
export const smokeProps = { order: { id: "1042", owner: "Example User", status: "Open", notes: "Review this order." } } satisfies React.ComponentProps<typeof OrderDetail>;
