import { Icon } from "@clossys/designer/atoms";
import { Clock } from "@clossys/designer/icons";

// Decorative — adds no information beyond text already next to it.
export default function Example() { return <>
<Icon glyph={Clock} decorative />

{/* Meaningful — the ONLY signal of what this is. Carries an accessible name. */}
<Icon glyph={Clock} label="Last updated 3 hours ago" />

{/* Compile error: TypeScript rejects this before it ever reaches a browser. */}
{/* <Icon glyph={Clock} /> */}
</>; }
