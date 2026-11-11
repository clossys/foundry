// Kibo UI Status (MIT, Copyright (c) 2023 — Present shadcnblocks), copied from
// shadcnblocks/kibo packages/status/index.tsx at commit
// 3d63cdb15b79d972e3dc38a10997987672f9b263. Local adaptations, imports and tokens only:
// the `@/` imports point at the vendored stock badge and `cn`; the palette colours
// (emerald/red/blue/amber-500, muted-foreground) are the Designer status and ink tokens;
// and the status union gains `neutral`, which carries no indicator colour.
import type { ComponentProps, HTMLAttributes } from "react";
import { Badge } from "../../preview-runtime/components/badge/badge.js";
import { cn } from "../../preview-runtime/components/_parts/utils/index.js";

export type StatusProps = ComponentProps<typeof Badge> & {
  status: "online" | "offline" | "maintenance" | "degraded" | "neutral";
};

export const Status = ({ className, status, ...props }: StatusProps) => (
  <Badge
    className={cn("flex items-center gap-2", "group", status, className)}
    variant="secondary"
    {...props}
  />
);

export type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement>;

export const StatusIndicator = ({
  className,
  ...props
}: StatusIndicatorProps) => (
  <span className="relative flex h-2 w-2" {...props}>
    <span
      className={cn(
        "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
        "group-[.online]:bg-(--color-status-success)",
        "group-[.offline]:bg-(--color-status-danger)",
        "group-[.maintenance]:bg-(--color-status-info)",
        "group-[.degraded]:bg-(--color-status-warning)"
      )}
    />
    <span
      className={cn(
        "relative inline-flex h-2 w-2 rounded-full",
        "group-[.online]:bg-(--color-status-success)",
        "group-[.offline]:bg-(--color-status-danger)",
        "group-[.maintenance]:bg-(--color-status-info)",
        "group-[.degraded]:bg-(--color-status-warning)"
      )}
    />
  </span>
);

export type StatusLabelProps = HTMLAttributes<HTMLSpanElement>;

export const StatusLabel = ({
  className,
  children,
  ...props
}: StatusLabelProps) => (
  <span className={cn("text-(--color-ink-muted)", className)} {...props}>
    {children ?? (
      <>
        <span className="hidden group-[.online]:block">Online</span>
        <span className="hidden group-[.offline]:block">Offline</span>
        <span className="hidden group-[.maintenance]:block">Maintenance</span>
        <span className="hidden group-[.degraded]:block">Degraded</span>
      </>
    )}
  </span>
);
