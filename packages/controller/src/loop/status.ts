/**
 * The generated per-role STATUS document (issue #1195): a human-readable
 * Markdown file at `clossys/<role>/`, alongside that role's own
 * `loop.json`, with exactly five fixed sections: Mandate / Where we are /
 * Recommended next / Decisions / Blockers. `renderStatusDocument` is the
 * generic five-section renderer, deliberately decoupled from `LoopState`
 * so the Advisor lane's own parallel STATUS document (written
 * independently, in the same wave, per issue #1187's plan) can call it
 * with its own section bodies and stay byte-compatible with this one --
 * "so the engine can take over rendering it later." `renderLoopStatus` is
 * this package's own use of it, building those five bodies from one
 * role's `LoopState`.
 */
import { isBlockerOverdue } from "./blockers.js";
import type { LoopState } from "./types.js";

export interface StatusSections {
  readonly mandate: string;
  readonly whereWeAre: string;
  readonly recommendedNext: string;
  readonly decisions: string;
  readonly blockers: string;
}

const STATUS_SECTION_TITLES = Object.freeze(["Mandate", "Where we are", "Recommended next", "Decisions", "Blockers"] as const);

/** The generic five-section renderer. Any caller with its own section bodies gets the same fixed structure, byte-for-byte. */
export function renderStatusDocument(role: string, sections: StatusSections): string {
  const bodies = [sections.mandate, sections.whereWeAre, sections.recommendedNext, sections.decisions, sections.blockers];
  const lines: string[] = [`# ${role} — STATUS`, ""];
  STATUS_SECTION_TITLES.forEach((title, index) => {
    lines.push(`## ${title}`, "", bodies[index]!.trim().length > 0 ? bodies[index]!.trim() : "Nothing recorded.", "");
  });
  return lines.join("\n");
}

function renderWhereWeAre(state: LoopState): string {
  const rows = Object.values(state.capabilities)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((capability) => `- **${capability.id}** — ${capability.state} (${capability.condition})${capability.stage ? `, at \`${capability.stage}\`` : ""}`);
  return rows.length > 0 ? rows.join("\n") : "No capabilities are tracked yet.";
}

function renderRecommendedNext(state: LoopState): string {
  const rows = Object.values(state.capabilities)
    .filter((capability) => capability.blockers.length === 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((capability) => `- **${capability.id}**: continue at \`${capability.stage ?? "sense"}\`.`);
  return rows.length > 0 ? rows.join("\n") : "Nothing unblocked is waiting on a next step.";
}

function renderDecisions(state: LoopState): string {
  const rows = Object.entries(state.capabilities)
    .flatMap(([id, capability]) => capability.decisions.map((decision) => ({ id, ...decision })))
    .sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0))
    .map((decision) => `- **${decision.id}** (${decision.when}): recommended _${decision.recommended}_, chose _${decision.chosen}_.`);
  return rows.length > 0 ? rows.join("\n") : "No decisions recorded yet.";
}

function renderBlockers(state: LoopState, now: Date): string {
  const rows = Object.values(state.capabilities)
    .flatMap((capability) => capability.blockers)
    .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0))
    .map((blocker) => {
      const overdue = isBlockerOverdue(blocker, now) ? " **OVERDUE**" : "";
      return `- **${blocker.capabilityId}** (${blocker.kind}, owner: ${blocker.owner}): ${blocker.nextAction.how} — ${blocker.nextAction.who}, by ${blocker.nextAction.byWhen}.${overdue}`;
    });
  return rows.length > 0 ? rows.join("\n") : "No open blockers.";
}

/** Renders one role's `STATUS document` from its `loop.json` and its mandate (the brief's own statement of why this role is here). */
export function renderLoopStatus(role: string, state: LoopState, mandate: string, now: Date = new Date()): string {
  return renderStatusDocument(role, {
    mandate,
    whereWeAre: renderWhereWeAre(state),
    recommendedNext: renderRecommendedNext(state),
    decisions: renderDecisions(state),
    blockers: renderBlockers(state, now),
  });
}
