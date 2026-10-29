import { type ComponentProps } from "react";
import { LinkButton } from "../_parts/rail-u1-button/index.js";
type Props = ComponentProps<typeof LinkButton> & { appearance?: "inline" | "button" };
export function Link({ appearance = "inline", className, ...props }: Props) {
 return <LinkButton {...props} variant={appearance === "inline" ? "link" : props.variant} className={[appearance === "inline" ? "h-auto p-0" : "", className].filter(Boolean).join(" ")} />;
}
