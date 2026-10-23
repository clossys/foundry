import { SiteHeader, NavShell } from "@clossys/designer/shell";
import { Link } from "@clossys/designer/atoms";

export default function Example() { return <>
<SiteHeader
  navPlacement="centered"
  brand={<Link href="/" variant="standalone">Acme</Link>}
  nav={
    <NavShell aria-label="Primary">
      <Link href="/products" variant="standalone">Products</Link>
      <Link href="/pricing" variant="standalone">Pricing</Link>
    </NavShell>
  }
  actions={<>
    <SiteHeader.ActionLink href="/sign-in" label="Sign in" variant="ghost" />
    <SiteHeader.ActionLink href="/pricing" label="Pricing" variant="secondary" />
  </>}
/>
</>; }
