/**
 * The brief certifier (R05): a Director candidate fits its slot when every heading the contract
 * fixture requires is a `## <heading>` line of its body and every slot it cites is one the slot
 * declares (`inputs` or `uses`, R07.1). Its schema (frontmatter, brief rules) is `validateCandidate`'s.
 */
import { parseFrontmatter } from "../../records/slot-model/index.js";
import { candidateCitations, dependencySet, isObject, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import type { CertifyEnv } from "./env.js";
import { reason, type Reason } from "./types.js";

/** Headings (`## ...`, trimmed) of a markdown body. */
export const bodyHeadings = (body: string): Set<string> => new Set([...body.matchAll(/^##\s+(.+?)\s*#*\s*$/gm)].map(match => match[1]!.trim()));

/** Slots a candidate cites that the slot does not declare (R07.1), as fit failures. */
export function citationReasons(slot: SlotRecord, candidate: CandidateRecord, env: CertifyEnv): Reason[] {
  const declared = dependencySet(slot) ?? new Set<string>();
  const out: Reason[] = [];
  for (const cite of candidateCitations(slot, candidate, env.homes, env.installOwners())) {
    if (cite.slots.some(target => declared.has(target))) continue;
    out.push(reason("citation", `cites ${cite.slots.join(" or ")} (${cite.via} ${cite.text}), which slot.json inputs and uses do not list`));
  }
  return out;
}

export function certifyBrief(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  const fixture = isObject(contract.fixture) ? contract.fixture : {};
  const parsed = parseFrontmatter(candidate.text);
  if (!parsed.ok) return [reason("invalid", parsed.message)];
  const headings = bodyHeadings(parsed.value.body);
  const out: Reason[] = [];
  for (const heading of stringList(fixture.headings)) if (!headings.has(heading)) out.push(reason("fixture", `has no "## ${heading}" section, which the contract fixture requires`));
  return [...out, ...citationReasons(slot, candidate, env)];
}
