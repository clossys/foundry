import { Hero } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

export default function Example() { return <>
<Hero heading="Heading text" description="Subheading copy goes here." actions={<Button>CTA label</Button>} align="center" />
</>; }
