import type { Finding } from "../catalog-core/types.js";

/** An exemption is visible evidence and never a successful contrast verdict. */
export function AssetExemptions({ findings }: { findings: readonly Finding[] }) {
  return <>{findings.filter(finding => finding.code === "A5" && finding.severity === "notice" && /^exempt: logotype, \S/.test(finding.message)).map((finding, index) =>
    <p key={`${finding.subject}:${index}`} role="status" data-studio-asset-verdict="exempt" data-studio-asset-subject={finding.subject} className="text-body-s text-ink-secondary">{finding.message}</p>)}</>;
}
