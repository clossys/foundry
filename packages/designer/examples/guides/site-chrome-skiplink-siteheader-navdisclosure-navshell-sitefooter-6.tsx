import { NavDisclosure, SiteHeader } from "@clossys/designer/shell";
import { Home } from "@clossys/designer/icons";

export default function Example() { return <>
<SiteHeader
  brand={<a href="/"><img src="/logo.svg" alt="Example" style={{ maxWidth: "100%", height: "auto" }} /></a>}
  nav={
    <NavDisclosure aria-label="Primary" trigger="icon" triggerLabel="Menu">
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </NavDisclosure>
  }
  actions={<SiteHeader.ActionLink href="/start" label="Get started" icon={Home} variant="primary" />}
/>
</>; }
