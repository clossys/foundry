import { validateWebRolePairEvidence, WEB_ROLE_PAIR_EVIDENCE, WEB_ROLE_PAIR_BINDINGS } from "./index.js";
import type { WebRolePairStatus, WebRolePairCheck, WebRolePairEvidence, WebRolePairEvidenceResult, BlockRoleBindingIdentity } from "./index.js";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Status = Assert<Equal<WebRolePairStatus, "measured" | "violated" | "unmeasured">>;
type Result = Assert<Equal<WebRolePairEvidenceResult["status"], WebRolePairStatus>>;
type Identity = Assert<Equal<WebRolePairEvidence["identity"], BlockRoleBindingIdentity>>;
type Medium = Assert<Equal<WebRolePairEvidence["medium"], "web">>;
type CheckStatus = Assert<Equal<WebRolePairEvidence["checks"][WebRolePairCheck]["status"], WebRolePairStatus>>;
type Checks = Assert<Equal<WebRolePairCheck, "standaloneMain" | "standaloneChrome" | "composedMain" | "frameMain" |
  "skipLinks" | "skipTargets" | "viewMain" | "viewContent" | "chromeOutsideMain" | "chromeInsideMain">>;
// @ts-expect-error Evidence has no qualified state.
const qualified: WebRolePairStatus = "qualified";
void [qualified, validateWebRolePairEvidence, WEB_ROLE_PAIR_EVIDENCE, WEB_ROLE_PAIR_BINDINGS];
export type { Status, Result, Identity, Medium, CheckStatus, Checks };
