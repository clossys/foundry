import type { InstanceRecord, InstanceBlockRef, InstanceFrameBlockId, InstanceViewBlockId, InstanceSiteSurfaceKind, InstanceRecordValidationResult, InstanceRecordReason, InstanceRecordOptions, PackRecord } from "./index.js";
import { validateInstanceRecords } from "./index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Surface = Assert<Equal<InstanceRecord["surface"], "site" | "app">>;
type Frames = Assert<Equal<InstanceFrameBlockId, "SiteFrame" | "AppFrame">>;
type Views = Assert<Equal<InstanceViewBlockId, "AuthView" | "CaptureView" | "CollectionView" | "ContactView" | "DocumentView" | "HeroView" | "LandingView" | "LegalView" | "MarketingView" | "SectionedView" | "StatusView">>;
type Kinds = Assert<Equal<InstanceSiteSurfaceKind, "site" | "front-door" | "admin" | "demo">>;
type PlainRefs = Assert<Equal<keyof InstanceBlockRef, "blockId" | "configId">>;
type Status = Assert<Equal<InstanceRecordValidationResult["status"], "valid" | "refused">>;
type Reasons = Assert<Equal<InstanceRecordReason, "shape" | "identity" | "frame" | "view" | "pairing" | "duplicate" | "uses" | "membership">>;
type Medium = Assert<Equal<InstanceRecord["context"]["medium"], "web">>;
type OptionalPath = Assert<Equal<InstanceRecord["path"], string | undefined>>;
// @ts-expect-error Consumers extend Views and Blocks, not the closed Frame set.
const frame: InstanceFrameBlockId = "ExampleFrame";
// @ts-expect-error A Pack record does not declare qualification.
const pack: PackRecord = { packId: "pack.example", label: "Example", instanceIds: [], qualification: "qualified" };
// @ts-expect-error Frame registration is outside the current extension contract.
const options: InstanceRecordOptions = { customFrameIds: ["ExampleFrame"] };
void [frame, pack, options, validateInstanceRecords];
export type { Surface, Frames, Views, Kinds, PlainRefs, Status, Reasons, Medium, OptionalPath };
