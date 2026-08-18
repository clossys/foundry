/**
 * Unobserved surface: declared subjects producing no telemetry.
 *
 * Reported as its own metric, never combined with `escape-rate.ts`'s
 * output — see that module's header and `metrics.check.ts` for the
 * compiled proof that the two cannot be blended into one score. A single
 * blended number would hide exactly the case this metric exists to
 * surface: a gate silent because nothing is watching it, indistinguishable
 * in a combined score from a gate silent because nothing goes wrong.
 */
import type { Observation } from "./observation.js";

/** One subject a plane has declared it expects telemetry from. */
export interface DeclaredSubject {
  readonly id: string;
  readonly description?: string;
}

/** Whether telemetry for `subject` could be found, and how much if so. */
export type TelemetryPresence = Observation<{ readonly eventCount: number }>;

/** One subject's telemetry-presence read, keyed to a `DeclaredSubject.id`. */
export interface SubjectTelemetryRead {
  readonly subject: string;
  readonly presence: TelemetryPresence;
}

/**
 * The unobserved-surface metric. Deliberately its own shape, sharing no
 * field name with `EscapeRateMetric` (`escape-rate.ts`).
 */
export interface UnobservedSurfaceMetric {
  readonly kind: "unobserved-surface";
  readonly declaredCount: number;
  /** Declared subjects with confirmed telemetry. */
  readonly observed: readonly string[];
  /** Declared subjects confirmed to produce none. */
  readonly unobserved: readonly string[];
  /**
   * Declared subjects whose telemetry presence could not be determined —
   * INCLUDING every declared subject with no read supplied at all. A
   * subject nobody attempted to read is exactly as unproven as one whose
   * read failed; treating an absent read as "unobserved" would silently
   * launder "nobody checked" into "checked, and found nothing," which is
   * the same manufactured-confidence failure `could-not-read` exists to
   * refuse everywhere else in this package.
   */
  readonly couldNotRead: readonly string[];
}

/** Computes the unobserved-surface metric from a plane's declared subjects and whatever presence reads it supplied. */
export function computeUnobservedSurface(
  declared: readonly DeclaredSubject[],
  reads: readonly SubjectTelemetryRead[],
): UnobservedSurfaceMetric {
  const presenceById = new Map<string, TelemetryPresence>();
  for (const read of reads) {
    presenceById.set(read.subject, read.presence);
  }

  const observed: string[] = [];
  const unobserved: string[] = [];
  const couldNotRead: string[] = [];

  for (const subject of declared) {
    const presence = presenceById.get(subject.id);
    if (presence === undefined || presence.state === "could-not-read") {
      couldNotRead.push(subject.id);
    } else if (presence.state === "observed") {
      observed.push(subject.id);
    } else {
      unobserved.push(subject.id);
    }
  }

  return {
    kind: "unobserved-surface",
    declaredCount: declared.length,
    observed,
    unobserved,
    couldNotRead,
  };
}
