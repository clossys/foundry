import { Tooltip, Button } from "@clossys/designer/atoms";

function InfoTooltip() {
  return (
    <Tooltip trigger={<Button aria-label="Why is this required?">?</Button>}>
      Required for tax purposes.
    </Tooltip>
  );
}

export default InfoTooltip;
