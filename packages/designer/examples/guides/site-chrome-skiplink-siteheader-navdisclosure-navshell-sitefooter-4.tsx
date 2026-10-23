import { SiteHeader } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

import { Home, Settings } from "@clossys/designer/icons";

export default function Example() { return <>
<SiteHeader
  brand={<Link href="https://example.com/" variant="standalone">Acme</Link>}
  actions={
    <>
      <SiteHeader.ActionLink href="https://app.example.com/" label="App" icon={Home} isCurrent />
      <SiteHeader.ActionLink href="https://admin.example.com/" label="Admin" icon={Settings} />
    </>
  }
/>
</>; }
