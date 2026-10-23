import { Card } from "@clossys/designer/atoms/server";

function Plates() {
  return (
    <div className="grid gap-lg">
      <Card variant="plate" ground="sunken">A plate on a sunken band.</Card>
      <Card variant="outline">A product panel.</Card>
    </div>
  );
}

export default Plates;
