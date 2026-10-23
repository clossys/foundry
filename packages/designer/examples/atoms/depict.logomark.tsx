import { Logomark } from "@clossys/designer/atoms";
import { Lockup } from "@clossys/designer/blocks";

function Identity() {
  return <Lockup src="/glyph.svg" wordmark="Example" size="md" plate="shared" clearSpace />;
}
function DecorativeMark() {
  return <Logomark src="/glyph-mono.svg" size="sm" title="Decorative mark" />;
}

export default function Example() { return <><Identity /><DecorativeMark /></>; }
