/**
 * The heartbeat's reference schedule declaration (issue #1221): it is
 * declarable under Controller's existing schedule conventions
 * (`../conventions/schedules.js`), never a routine -- "work that runs
 * without a model is a schedule" (`../conventions/schedules.js`'s own
 * header), and the heartbeat is explicitly zero-token and never calls a
 * model. `validateHeartbeatSchedule` reuses the EXISTING
 * `validateScheduleDeclaration` rather than reinventing validation for
 * this one declaration.
 *
 * Per #1221's own ownership table, installing the workflow is Launcher's
 * job, not this package's -- `controllerHeartbeatSchedule` is exported so
 * a consuming repository (through Launcher) can import and register it
 * with its OWN scope, rather than hand-writing a new declaration. A
 * declaration is not a deployment: this module never claims the
 * heartbeat is actually installed anywhere, only states what it would
 * look like declared.
 */
import { validateScheduleDeclaration } from "../conventions/schedules.js";
import type { Finding, ScheduleDeclaration, ScheduleRegistry } from "../conventions/types.js";

/**
 * Builds the reference `controller-heartbeat` schedule declaration,
 * scoped to the repositories the calling plane actually governs.
 *
 * Cadence is business-days-only, once a day -- #1259's "no sub-hourly
 * cron without a stated reason" is satisfied by the reason stated
 * directly in `purpose`: staleness, blocker, and review-window state
 * does not move faster than the roles that create it, so a heartbeat
 * firing more often than once a day would only rerun an identical scan.
 */
export function controllerHeartbeatSchedule(scope: readonly string[]): ScheduleDeclaration {
  return Object.freeze({
    id: "controller-heartbeat",
    cadence: "0 13 * * 1-5",
    scope: Object.freeze([...scope]),
    executionHost: "github-actions",
    artifact: "scripts/run-heartbeat.mjs",
    purpose:
      "Once each business day (not sub-hourly -- staleness, blockers, and review windows do not move faster than the roles that create them), scans every clossys/<role>/loop.json for stale capabilities, open blockers, and pending decisions, and writes clossys/.state/decisions-waiting-for-you.md. Zero-token: no model call, no live external change.",
  });
}

/** Validates a `controllerHeartbeatSchedule` declaration against a plane's own registry -- a thin, named call to the existing schedule-tier validator so a caller never re-derives this by hand. */
export function validateHeartbeatSchedule(declaration: ScheduleDeclaration, registry: ScheduleRegistry): readonly Finding[] {
  return validateScheduleDeclaration(declaration, registry);
}
