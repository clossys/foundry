/** Structural copy contracts; shared i18n ownership is a recorded follow-up Need. */
export type CopyEntryId = string;
export type CopyLocale = string;
export type CopyValue = string | number | boolean;
export interface CopyRef {
  id: CopyEntryId;
  locale?: CopyLocale;
  values?: Readonly<Record<string, CopyValue>>;
}

export interface CopySource { kind: "consumer" | "generated" | "imported"; reference: string; }

export type CopyResolutionApproval =
  | { approvedBy: "owner"; pendingOwnerReview: false }
  | {
      approvedBy: "delegate";
      pendingOwnerReview: boolean;
      /**
       * Present only when this delegate-approved entry resolved on "production"
       * because the `approvalPlan` authorized it: that plan's canonical digest.
       * Absent when `acceptDelegateInProduction` authorized it, and on "preview".
       */
      authorizingPlanDigest?: string;
    };

/** A successful, fully traced resolution of one copy reference. */
export interface CopyResolution {
  ref: CopyRef;
  text: string;
  recordId: string;
  revision: string;
  locale: CopyLocale;
  source: CopySource;
  entryId: CopyEntryId;
  /** Present only when the resolved entry carries an approval record. */
  approval?: CopyResolutionApproval;
}

/** Resolver shape for callers that need rendered audience text. */
export type CopyResolver = (ref: CopyRef) => CopyResolution | undefined;
