import { checkConsumerArtContract, type ConsumerArtContract } from "@clossys/designer/tokens";
import type { CSSProperties } from "react";
import { RenderError } from "../internal/errors.js";

/** Checked consumer-owned static art for an existing backdrop or media seam. */
export interface ConsumerArtSlotProps {
  contract: ConsumerArtContract;
}

/**
 * Checks the Designer contract before constructing inert image/path markup.
 * Inline vector paint follows live brand/theme tokens. Raster pixels remain
 * consumer-owned. The surrounding view or section owns scrim contrast.
 */
export function ConsumerArtSlot({ contract }: ConsumerArtSlotProps) {
  const report = checkConsumerArtContract(contract);
  if (!report.ok) {
    throw new RenderError("resolution-failed", report.findings.map(finding => `${finding.path}: ${finding.message}`).join("; "));
  }
  const backdrop = contract.slot !== "media";
  const decorative = contract.purpose === "decorative";
  const mediaStyle: CSSProperties = { display: "block", width: "100%", height: "100%", objectFit: contract.fit };
  return (
    <div
      data-consumer-art-slot={contract.slot}
      aria-hidden={decorative ? true : undefined}
      style={{
        position: backdrop ? "absolute" : "relative",
        inset: backdrop ? 0 : undefined,
        width: "100%",
        height: backdrop ? "100%" : undefined,
        aspectRatio: backdrop ? undefined : `${contract.width} / ${contract.height}`,
        overflow: "hidden",
        pointerEvents: "none",
        backgroundColor: `var(${contract.backgroundToken})`,
      }}
    >
      {contract.source.format === "svg" ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={`0 0 ${contract.width} ${contract.height}`}
          width={contract.width}
          height={contract.height}
          preserveAspectRatio={contract.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet"}
          role={decorative ? undefined : "img"}
          aria-hidden={decorative ? true : undefined}
          aria-label={decorative ? undefined : contract.alt}
          focusable="false"
          style={mediaStyle}
        >
          {contract.source.paths.map((path, index) => (
            <path
              key={index}
              d={path.d}
              fill={`var(${path.fillToken})`}
              stroke={path.strokeToken === undefined ? "none" : `var(${path.strokeToken})`}
              strokeWidth={path.strokeWidth}
            />
          ))}
        </svg>
      ) : (
        <img
          src={contract.source.src}
          alt={contract.alt}
          width={contract.width}
          height={contract.height}
          loading={contract.loading}
          decoding="async"
          draggable={false}
          style={mediaStyle}
        />
      )}
    </div>
  );
}
