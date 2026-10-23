import { Brandmark, SiteHeader } from "@clossys/designer/shell";

export default function Example() { return <>
<SiteHeader
  brand={
    <Brandmark
      variant="lockup"
      size="md"
      label="Acme home"
      markSrc="/brand/acme-mark.svg"
      wordmark="Acme"
    />
  }
/>
</>; }
