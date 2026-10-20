import { useState } from "react";
import type { Inspection } from "./signature-views.js";
import type { SignatureChartProps } from "./signature-types.js";

export function useInspection(props: SignatureChartProps): Inspection {
  const [active, setActive] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  return {
    active: props.activeIndex === undefined ? active : props.activeIndex,
    selected:
      props.selectedIndex === undefined ? selected : props.selectedIndex,
    inspect(index) {
      if (props.activeIndex === undefined) setActive(index);
      props.onActiveIndexChange?.(index);
    },
    select(index) {
      if (props.selectedIndex === undefined) setSelected(index);
      props.onSelectionChange?.(index);
    },
  };
}
