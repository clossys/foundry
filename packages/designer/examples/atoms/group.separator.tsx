import { Separator } from "@clossys/designer/atoms";

function SectionDivider() {
  return <Separator />;
}

function ToolbarDivider() {
  return <Separator orientation="vertical" decorative />;
}

export default function Example() { return <><SectionDivider /><ToolbarDivider /></>; }
