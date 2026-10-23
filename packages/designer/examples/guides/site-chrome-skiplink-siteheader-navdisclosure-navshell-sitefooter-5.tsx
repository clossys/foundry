import { SiteHeader } from "@clossys/designer/shell";

export default function Example() { return <>
<SiteHeader
  surface="glass"
  tone="inverse"
  brand={<a href="/" className="text-inherit">Acme</a>}
  actions={<a href="/sign-in" className="text-inherit">Sign in</a>}
/>
</>; }
