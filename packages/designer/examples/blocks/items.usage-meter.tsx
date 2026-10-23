import { UsageMeter } from "@clossys/designer/blocks/server";

function RequestUsage() {
  return (
    <UsageMeter
      id="request-usage"
      label="API requests" used={8420} limit={10000}
      usedText="8,420 requests" limitText="of 10,000" periodText="Resets Nov 1"
      thresholds={[
        { at: 0.8, tone: "warning", message: "You have used at least 80 percent of this limit." },
        { at: 1, tone: "danger", message: "You have reached this limit." },
      ]}
      projectedText="On track for about 11,200 by Oct 31"
      action={<a href="/account/usage">View usage</a>}
    />
  );
}

export default RequestUsage;
