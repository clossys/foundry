import type { ReactNode } from "react";
import { DOT_FIELD_PATH } from "./dot-field-tile-data.js";

export interface DotFieldProps {
  className?: string;
  /** Decorative island slot; no content, focusable elements or scripts. */
  children?: ReactNode;
  /** Caller-owned, document-unique pattern ID when multiple render roots share a page. @default "dot-field-tile" */
  patternId?: string;
}
export const DOT_FIELD_TILE = { seed: 7, cells: 18, pitch: 32, radius: 1.5, path: DOT_FIELD_PATH } as const;

/** A server-safe, static seeded backdrop. The enclosing view supplies its clipping and opaque copy halos. */
export function DotField({ className, children, patternId = "dot-field-tile" }: DotFieldProps) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(patternId)) throw new TypeError("DotField patternId must be a plain SVG identifier.");
  return (
    <div data-dot-field="" aria-hidden="true" className={["dot-field", className].filter(Boolean).join(" ")} style={{ pointerEvents: "none" }}>
      <svg focusable="false" aria-hidden="true">
        <defs>
          <pattern id={patternId} width={576} height={576} patternUnits="userSpaceOnUse">
            <path d={DOT_FIELD_TILE.path} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {children}
    </div>
  );
}
