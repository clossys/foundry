const field = { text: "Example consent", recordId: "example", entryId: "example", revision: "1", locale: "en" };
const snapshot: ReturnType<ConsentLifecyclePort["getSnapshot"]> = { regime: "prompt", effective: "none", allowed: false, promptAutomatically: false, persistence: "none", storage: "readable", evidence: "none", withdrawal: "idle", gpcInForce: false, simulated: false, sequence: 0 };

import type { ReactNode } from "react";
import { ConsentExperience } from "@clossys/publisher/web/consent";
import type { AnalyticsPermissionPort, ConsentLifecyclePort, ResolvedConsentCopy } from "@clossys/publisher/web/consent";

const copy: ResolvedConsentCopy = { title: field, promptLead: field, noticeLead: field, acceptLabel: field, rejectLabel: field, privacyLinkLabel: field, status: { memoryOnly: field, withdrawalFailed: field, evidenceUnavailable: field, evidenceConflict: field, storageUnavailable: field, gpcInForce: field } };
const transport: AnalyticsPermissionPort = { setPermission: () => {} };
function buildLifecycle(): ConsentLifecyclePort { return { getSnapshot: () => snapshot, subscribe: () => () => {}, grant: () => snapshot, refuse: () => snapshot, refresh: () => snapshot, dispose: () => {} }; }

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <ConsentExperience copy={copy} createLifecycle={() => buildLifecycle()} transport={transport} policyLink={{ href: "/privacy" }}>
      {children}
    </ConsentExperience>
  );
}

export const smokeProps = { children: "Example content" } satisfies Parameters<typeof PublicShell>[0];
export default PublicShell;
