import type { Finding } from "../../catalog-core/index.js";

/**
 * The first error's message on one line beside an error badge, so an error card says why it failed
 * without a hover. The full list stays in the badge's tooltip; the title carries the untruncated line.
 */
export function ErrorReason({ findings }: { findings: readonly Pick<Finding, "severity" | "message">[] }) {
  const first = findings.find(finding => finding.severity === "error");
  return first ? <p data-error-reason="" title={first.message} className="max-w-full truncate text-caption text-status-danger-text">{first.message}</p> : null;
}
