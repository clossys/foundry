import { Brandmark } from "@clossys/designer/shell";

export default function Example() { return <>
<Brandmark
  variant="lockup"
  size="md"
  label="Acme home"
  markSrc="/brand/acme-mark.svg"
  wordmark="Acme"
  markInk="accent"
/>
</>; }
