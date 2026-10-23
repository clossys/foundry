import { Meter } from "@clossys/designer/atoms/server";

function LeverageRow() {
  return (
    <Meter value={3.4} scaleMax={5} limit={3} direction="max" tone="danger" valueText="3.4x" limitText="limit 3.0x" />
  );
}

export default LeverageRow;
