/** The business boundary whose operating architecture is being described. */
export type OperatingScopeKind = "portfolio" | "business";

/** A provider-neutral kind of system in an operating topology. */
export type OperatingSystemKind = "workspace" | "repository" | "service" | "data-store" | "external-system";

/** Stable responsibilities that systems can perform without prescribing repository names. */
export type OperatingResponsibility =
  | "control-plane"
  | "product"
  | "commercial"
  | "delivery"
  | "knowledge"
  | "platform";

export interface OperatingScopeDefinition {
  id: string;
  kind: OperatingScopeKind;
}

/** One addressable system. Provider locators are descriptive, never credentials. */
export interface OperatingSystemDefinition {
  id: string;
  kind: OperatingSystemKind;
  responsibilities: readonly OperatingResponsibility[];
  provider?: string;
  locator?: string;
  visibility?: "public" | "private" | "restricted";
}

/** One consumer-owned declaration of authority and its authoritative record. */
export interface AuthorityDefinition {
  responsibility: OperatingResponsibility;
  owner: string;
  systemOfRecord: string;
}

/** An allowed directional crossing between two declared systems. */
export interface OperatingInterfaceDefinition {
  id: string;
  from: string;
  to: string;
  responsibilities: readonly OperatingResponsibility[];
  description?: string;
}

/** Provider-neutral desired operating architecture. */
export interface OperatingTopologyDefinition {
  id: string;
  schemaVersion: string;
  scope: OperatingScopeDefinition;
  systems?: readonly OperatingSystemDefinition[];
  authorities?: readonly AuthorityDefinition[];
  interfaces?: readonly OperatingInterfaceDefinition[];
}

export interface OperatingTopology extends OperatingTopologyDefinition {
  systems: readonly OperatingSystemDefinition[];
  authorities: readonly AuthorityDefinition[];
  interfaces: readonly OperatingInterfaceDefinition[];
}

export type ArchitectureFindingSeverity = "error" | "warning";

export interface ArchitectureFinding {
  rule: string;
  severity: ArchitectureFindingSeverity;
  message: string;
  path?: string;
}

export interface OperatingTopologyChange {
  kind: "additive" | "breaking";
  subject: "topology" | "scope" | "system" | "authority" | "interface";
  id: string;
  message: string;
}

export interface OperatingTopologyCompatibilityReport {
  compatible: boolean;
  changes: readonly OperatingTopologyChange[];
  previousFindings: readonly ArchitectureFinding[];
  nextFindings: readonly ArchitectureFinding[];
}

/** One actual system-to-system crossing observed during a change. */
export interface BoundaryCrossingObservation {
  from: string;
  to: string;
  responsibility: OperatingResponsibility;
  interface?: string;
}

/** Evidence about one actual change. Non-material changes do not enter the metric. */
export interface ArchitectureChangeObservation {
  id: string;
  observedAt: string;
  material: boolean;
  crossings: readonly BoundaryCrossingObservation[];
}

export interface ArchitectureAssessmentOptions {
  /** Inclusive setpoint in [0, 1]. */
  maximumExceptionRate: number;
}

export type ArchitectureAssessmentState = "satisfied" | "violated" | "indeterminate";

export interface AssessedBoundaryCrossing extends BoundaryCrossingObservation {
  declared: boolean;
}

export interface AssessedArchitectureChange {
  id: string;
  observedAt: string;
  material: boolean;
  crossings: readonly AssessedBoundaryCrossing[];
  hasException: boolean;
}

/** Pure assessment result. `exceptionRate` is null whenever evidence is indeterminate. */
export interface ArchitectureExceptionAssessment {
  state: ArchitectureAssessmentState;
  exceptionRate: number | null;
  maximumExceptionRate: number;
  observedChanges: number;
  observedMaterialChanges: number;
  materialChangesWithExceptions: number;
  changes: readonly AssessedArchitectureChange[];
  findings: readonly ArchitectureFinding[];
}

export const OPERATING_SCOPE_KINDS: readonly OperatingScopeKind[] = ["portfolio", "business"];
export const OPERATING_SYSTEM_KINDS: readonly OperatingSystemKind[] = ["workspace", "repository", "service", "data-store", "external-system"];
export const OPERATING_RESPONSIBILITIES: readonly OperatingResponsibility[] = [
  "control-plane",
  "product",
  "commercial",
  "delivery",
  "knowledge",
  "platform",
];
