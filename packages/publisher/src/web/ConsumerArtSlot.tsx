import { checkConsumerArtContract, type ConsumerArtContract } from "@clossys/designer/tokens";
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
  const squareMedia = !backdrop && contract.aspect === "1:1";
  const mediaClasses = "block h-full w-full";
  return (
    <div
      data-consumer-art-slot={contract.slot}
      aria-hidden={decorative ? true : undefined}
      className={`pointer-events-none w-full overflow-hidden ${backdrop ? "absolute inset-0 h-full" : "relative"}${squareMedia ? " aspect-square" : ""}`}
      style={{
        aspectRatio: backdrop || squareMedia ? undefined : `${contract.width} / ${contract.height}`,
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
          className={mediaClasses}
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
          className={`${mediaClasses}${contract.fit === "cover" ? " object-cover" : ""}`}
          // The shipped stylesheets contain object-cover; contain is still an inline fit.
          style={contract.fit === "contain" ? { objectFit: "contain" } : undefined}
        />
      )}
    </div>
  );
}
