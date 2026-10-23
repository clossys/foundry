import { Icon, iconButtonLinkClassName } from "@clossys/designer/atoms/server";
import { ChevronDown } from "@clossys/designer/icons";

export default function Example() { return <>
<a href="#next" aria-label="Scroll to next section" className={iconButtonLinkClassName("base")}>
  <Icon glyph={ChevronDown} decorative size="md" />
</a>
</>; }
