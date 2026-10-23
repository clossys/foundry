import { Drawer } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

export function InspectorSheet() {
  return (
    <Drawer heading="Inspector" closeLabel="Close inspector" placement="end"
      wide="sheet" trigger={<Button>Inspect</Button>}>
      <p>Selection details</p>
    </Drawer>
  );
}

export default InspectorSheet;
