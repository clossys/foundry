import type { ComponentProps } from "react";
import type { Badge } from "./preview-runtime/components/badge/badge.js";

export type BadgeProps = ComponentProps<typeof Badge>;
export type BadgeVariant = NonNullable<BadgeProps["variant"]>;
