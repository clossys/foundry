import { Icon } from "@clossys/designer/atoms";
import { Clock } from "@clossys/designer/icons";

function LastUpdated({ label }: { label: string }) {
  return (
    <span>
      <Icon glyph={Clock} decorative /> {label}
    </span>
  );
}

function SearchTrigger() {
  return <Icon glyph={Clock} label="Search" />;
}

export default function Example() { return <><LastUpdated label="Updated today" /><SearchTrigger /></>; }
