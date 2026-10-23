import { SiteHeader } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

export default function Example() { return <>
<SiteHeader brand={<Link href="/" variant="standalone">Acme</Link>} actions={<SiteHeader.ActionLink href="/admin" label="Admin" isCurrent />} />
</>; }
