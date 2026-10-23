import { Items } from "@clossys/designer/blocks/server";

function ServiceMetrics() {
  return <Items arrangement="rows" items={[
    { id: "requests", heading: "Requests", figure: { value: "2,481", delta: "+12%", trend: "up" }, status: { tone: "success", label: "Available" } },
    { id: "latency", heading: "Latency", figure: { value: "120 ms", delta: "-3%", trend: "down" }, status: { tone: "neutral", label: "Stable" } },
  ]} />;
}

export default ServiceMetrics;
