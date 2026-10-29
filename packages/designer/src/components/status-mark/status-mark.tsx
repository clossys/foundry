import { type HTMLAttributes, type ReactNode } from "react";
import { Badge } from "../_parts/rail-badge/index.js";
import { Icon } from "../icon/index.js";
export type StatusMarkTone = "success" | "warning" | "danger" | "info" | "neutral";
export interface StatusMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> { tone: StatusMarkTone; children: ReactNode }
const assets = {success: "assets.icon-success", warning: "assets.icon-warning", danger: "assets.icon-danger", info: "assets.icon-info"} as const;
function StatusMark({tone, children, ...props}: StatusMarkProps) {
  return <Badge {...props} variant="outline" data-tone={tone}>
    {tone === "neutral" ? <span aria-hidden="true" data-part="mark" data-shape="dash">—</span> : <Icon asset={assets[tone]} decorative focusable="false" data-part="mark" data-shape={tone} size="sm" />}
    <span>{children}</span>
  </Badge>;
}
export { StatusMark };
