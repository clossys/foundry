import type { Finding } from "../catalog-core/types.js";

const EXEMPTION = /^exempt: (logotype), (\S.*)$/s;

/** Splits the engine's "exempt: <kind>, <reason>" notice into its parts; undefined for anything else. */
export function engineExemption(message: string): { kind: string; reason: string } | undefined {
  const match = EXEMPTION.exec(message);
  return match ? { kind: match[1]!, reason: match[2]! } : undefined;
}

/** Default plain words for an exemption: "Logotype exemption: <reason>". */
export const defaultExemptionLabel = (kind: string, reason: string): string => `${kind.charAt(0).toUpperCase()}${kind.slice(1)} exemption: ${reason}`;

/**
 * An exemption is visible evidence and never a successful contrast verdict. The engine prefix is
 * rendered as plain words; the subject id follows in the mono face as secondary text.
 */
export function AssetExemptions({ findings, label = defaultExemptionLabel }: { findings: readonly Finding[]; label?: (kind: string, reason: string) => string }) {
  return <>{findings.flatMap((finding, index) => {
    const exemption = finding.code === "A5" && finding.severity === "notice" ? engineExemption(finding.message) : undefined;
    return exemption ? [<p key={`${finding.subject}:${index}`} role="status" data-studio-asset-verdict="exempt" data-studio-asset-subject={finding.subject} data-studio-asset-exemption={exemption.kind} className="flex min-w-0 flex-col text-body-s">
      <span className="break-words text-ink-primary">{label(exemption.kind, exemption.reason)}</span>
      <span data-studio-asset-subject-id="" className="break-words font-mono tabular-nums text-caption text-ink-secondary">{finding.subject}</span>
    </p>] : [];
  })}</>;
}
