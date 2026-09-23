/**
 * Operating cadence (issue #1221): a zero-token heartbeat that
 * deterministically finds stale loops, open blockers, and pending
 * decisions across every role's `clossys/<role>/loop.json`, and writes
 * one "decisions waiting for you" digest. See `./digest.js` for the pure
 * computation and `./fs.js` for the I/O wrapper.
 *
 * Per #1221's own ownership table, this package owns only the engine and
 * computation. Installing the workflow is Launcher's job; the digest's
 * final wording and prioritization is Advisor's -- `renderDigest`
 * (`./digest.js`) is deliberately a plain, mechanical renderer in the
 * same style as `../loop/status.js`'s `renderStatusDocument`, documented
 * as the computation layer a later Advisor wording pass can wrap or
 * supersede, exactly as that module's own header already defers to
 * Advisor's parallel STATUS document.
 */
import type { BlockerKind, LoopStage } from "../loop/types.js";

export type { BlockerKind, LoopStage };

/** The four things the heartbeat surfaces. Never a fifth -- see `./digest.js`'s `computeHeartbeat` for exactly how each is detected. */
export const HEARTBEAT_FINDING_KINDS = Object.freeze(["blocked-capability", "pending-decision", "stale-capability", "review-waiting"] as const);
export type HeartbeatFindingKind = (typeof HEARTBEAT_FINDING_KINDS)[number];

/** One line of the digest: one role's one capability, at one finding. */
export interface DigestEntry {
  readonly role: string;
  readonly capabilityId: string;
  readonly kind: HeartbeatFindingKind;
  /** Plain, mechanical prose -- Advisor's own wording pass supersedes this, not this module's job to guess at. */
  readonly detail: string;
  /** Present only for `"blocked-capability"`: the blocker's own `since`. */
  readonly since?: string;
  /** Present only for `"blocked-capability"`: the blocker's own `nextAction.byWhen`. */
  readonly byWhen?: string;
  /** Present only for `"blocked-capability"`: whether this blocker is past its own `byWhen`. */
  readonly overdue?: boolean;
}

export interface HeartbeatDigest {
  readonly entries: readonly DigestEntry[];
  /** ISO 8601 datetime the digest was computed. */
  readonly generatedAt: string;
}
