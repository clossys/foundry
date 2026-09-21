export type YesNo = "yes" | "no";

export type KeepVerdict = "keep" | "fail";

export type InhabitIntent = "keep" | "feedback" | "compare" | "refer" | "churn" | "adopt" | "worth";

export type Familiarity = "fresh" | "returning";

export type AlternativeRelationship = "i-use-this" | "a-peer-uses-this" | "i-considered-this";

export interface Audience {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly painPoints?: readonly string[];
}

export interface KeepImpressions {
  readonly firstSeconds: string;
  readonly isThisForMe: YesNo;
  readonly doIBelieve: YesNo;
  readonly wouldIStay: YesNo;
  readonly wouldITellAPeer: YesNo;
}

export interface KeepChannelImpression {
  readonly impression: string;
}

export interface InhabitEnvelope {
  readonly speaker: "customer";
  readonly inhabitedAs: "target-audience";
  readonly audienceId: string;
  readonly persona: { readonly name: string };
  readonly stance: string;
  readonly topic: string;
  readonly familiarity: Familiarity;
  readonly intent: InhabitIntent;
}

/** Charter seal-gate session. The only intent that counts toward `customer keep rate`. */
export interface KeepRecord extends InhabitEnvelope {
  readonly intent: "keep";
  readonly impressions: KeepImpressions;
  readonly visual: KeepChannelImpression;
  readonly verbal: KeepChannelImpression;
  readonly verdict: KeepVerdict;
}

export interface LivedFunctional {
  readonly happened: string;
  readonly expected: string;
}

export interface LivedExpectation {
  readonly assumed: string;
  readonly actually: string;
}

/**
 * Lived feedback on any topic — functional, experiential, or both.
 * A synthetic power user on speed dial, not a contractor scorecard.
 */
export interface FeedbackRecord extends InhabitEnvelope {
  readonly intent: "feedback";
  readonly functional: readonly LivedFunctional[];
  readonly experience: readonly string[];
  readonly expectations: readonly LivedExpectation[];
  readonly blockedMe: YesNo;
  readonly whatIDidInstead: string;
  readonly wantedInstead: string;
  readonly stillForMe: YesNo;
}

export interface KnownAlternative {
  readonly name: string;
  readonly relationship: AlternativeRelationship;
  readonly whyItMatters: string;
}

/** Competitive compare from this person's actual consideration set. */
export interface CompareRecord extends InhabitEnvelope {
  readonly intent: "compare";
  readonly alternatives: readonly KnownAlternative[];
  readonly versus: string;
  readonly whatTheyDoBetter: string;
  readonly whatThisDoesBetter: string;
  readonly whenIReachForThem: string;
  readonly switchingCost: string;
  readonly iWouldSwitch: YesNo;
  readonly whatKeepsMeHere: string;
  readonly whatWouldMakeMeSwitch: string;
}

export interface ReferRecord extends InhabitEnvelope {
  readonly intent: "refer";
  readonly wouldITellAPeer: YesNo;
  readonly alreadyToldSomeone: YesNo;
  readonly whatIdSay: string;
  readonly whatStopsMe: string;
  readonly whatItWouldTake: string;
  readonly whoIdTell: string;
}

export interface ChurnRecord extends InhabitEnvelope {
  readonly intent: "churn";
  readonly wouldILeave: YesNo;
  readonly alreadyLooking: YesNo;
  readonly theWarning: string;
  readonly theMoment: string;
  readonly whatWouldKeepMe: string;
  readonly whereIdGo: string;
}

/** What it would take for this person to start using the candidate in their real life. */
export interface AdoptRecord extends InhabitEnvelope {
  readonly intent: "adopt";
  readonly wouldIStart: YesNo;
  readonly whatStopsMeStarting: string;
  readonly whatItWouldTake: string;
  readonly firstJobIdGiveIt: string;
}

/** Whether this is worth what it costs this person — time, money, attention. */
export interface WorthRecord extends InhabitEnvelope {
  readonly intent: "worth";
  readonly isItWorthIt: YesNo;
  readonly whatItCostsMe: string;
  readonly whatIGet: string;
  readonly whatWouldMakeItWorthIt: string;
}

export type InhabitRecord =
  | KeepRecord
  | FeedbackRecord
  | CompareRecord
  | ReferRecord
  | ChurnRecord
  | AdoptRecord
  | WorthRecord;

export interface KeepFormFinding {
  readonly rule: string;
  readonly severity: "error";
  readonly message: string;
  readonly path?: string;
}

export type KeepFormState = "satisfied" | "violated" | "indeterminate";

export interface KeepFormReport {
  readonly state: KeepFormState;
  readonly findings: readonly KeepFormFinding[];
}
