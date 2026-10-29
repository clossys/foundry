import { type ComponentProps } from "react";
import { Toolbar as Root, composeRenderProps } from "react-aria-components";
import { buttonGroupVariants } from "../_parts/rail-u1-button-group/button-group.js";
export function Toolbar({ className, orientation = "horizontal", ...props }: ComponentProps<typeof Root>) {
 return <Root {...props} orientation={orientation} className={composeRenderProps(className, (className) => buttonGroupVariants({ orientation, className }))} />;
}
