/**
 * `derive contract-fixtures --dry-run` (planner decision D1): for each Designer element slot,
 * propose the slot contract fixture (`contract.fixture`) from the pinned candidate's own
 * `meta.preview`, then certify every candidate of the slot, pinned or not, against the proposed
 * contract. Deterministic and read-only: it writes no agent data; a slot.json change lands through
 * the Designer skill. The report is the data workload that makes every candidate certify.
 *
 * A proposal copies the pinned preview's fixture (`fixtures.file`, `fixtures.export`,
 * `fixtures.props`), its declared `inputs` and its frame (`container`, `theme`, `width`), never a
 * copy snapshot. A contract fixture is typed by `contract.props`, so the proposed contract also
 * declares every fixture prop `contract.props` does not list yet (`propsToDeclare`).
 */
import { listSlots, readCandidate, readSlot } from "../records/slots.js";
import { CANDIDATE_NAME } from "../records/slot-model/index.js";
import { CONTRACT_FIXTURE_SCHEMA, type ContractFixture } from "../records/slot-model/contract-fixture.js";
import { pinnedWriterCopy } from "../server/specimen-tree.js";
import { certifyCandidate } from "./library-source.js";

/** One Designer element slot's proposal. */
export interface ContractFixtureProposal {
  readonly slot: string;
  /**
   * `declared`: slot.json already declares `contract.fixture`; `derived`: proposed from the pinned
   * candidate's preview; `no-source`: nothing to propose from (no pin, or a pin with no preview).
   */
  readonly status: "declared" | "derived" | "no-source";
  /** The pinned candidate file, when the slot has a pin. */
  readonly pinned?: string;
  /** Why there is no source fixture (`no-source` only). */
  readonly reason?: "unpinned" | "pinned-without-preview" | "pinned-preview-without-fixture";
  /** Whether the pinned candidate's specimen mounts a component (needs a contract fixture to certify). */
  readonly mounts?: boolean;
  /** The proposed `contract.fixture` (`derived` only). */
  readonly fixture?: ContractFixture;
  /** Fixture props `contract.props` must also declare for the fixture to type (`derived` only). */
  readonly propsToDeclare?: readonly string[];
}

/** One candidate that would not certify against the (proposed) contract. */
export interface UncertifiedCandidate { readonly slot: string; readonly candidate: string; readonly pinned: boolean; readonly reasons: readonly string[] }

export interface ContractFixtureReport {
  readonly slots: number;
  readonly declared: number;
  readonly derived: number;
  /** Slots with no source fixture, split by why and by whether the pin mounts a component. */
  readonly noSource: { readonly total: number; readonly unpinned: number; readonly pinnedWithoutPreview: number; readonly pinnedWithoutPreviewMounting: number; readonly pinnedPreviewWithoutFixture: number };
  /** Derived slots whose contract.props must also declare props. */
  readonly propsToDeclare: number;
  readonly candidates: { readonly checked: number; readonly certified: number; readonly pinnedFailing: number; readonly nonPinnedFailing: number };
  /** Failing candidates per reason class (a candidate counts once per class it fails). */
  readonly reasonClasses: Readonly<Record<string, number>>;
  readonly proposals: readonly ContractFixtureProposal[];
  readonly failing: readonly UncertifiedCandidate[];
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The contract fixture a pinned candidate's preview proposes, or undefined when it names no `{ file, export, props }` fixture. */
export function fixtureFromPreview(preview: unknown): ContractFixture | undefined {
  if (!object(preview)) return undefined;
  const fixtures = preview.fixtures;
  if (!object(fixtures) || typeof fixtures.file !== "string" || typeof fixtures.export !== "string" || !object(fixtures.props)) return undefined;
  return {
    schema: CONTRACT_FIXTURE_SCHEMA,
    fixtures: { file: fixtures.file, export: fixtures.export, props: fixtures.props },
    ...(object(preview.inputs) ? { inputs: preview.inputs as ContractFixture["inputs"] } : {}),
    ...(typeof preview.container === "string" ? { container: preview.container } : {}),
    ...(typeof preview.theme === "string" ? { theme: preview.theme } : {}),
    ...(typeof preview.width === "number" ? { width: preview.width } : {}),
  };
}

/** The class a certification reason belongs to, for counting. */
export function reasonClass(reason: string): string {
  if (reason.startsWith("uncertified: slot")) return "no-contract-fixture";
  if (reason.startsWith("the candidate needs props")) return "needs-extra-props";
  if (reason.startsWith("the candidate does not ship")) return "does-not-ship-fixture-export";
  if (reason.startsWith("the slot's contract.fixture")) return "contract-fixture-invalid";
  if (reason === "the candidate is not JSON") return "not-json";
  if (/^candidate .*: /.test(reason)) return "fixture-inputs";
  return "other";
}

/** Propose `contract.fixture` for every Designer element slot of one consumer root and certify every candidate against it. */
export function deriveContractFixtures(root: string): ContractFixtureReport {
  let writer: Readonly<Record<string, string>> | undefined;
  const writerSource = () => writer ??= pinnedWriterCopy(root);
  const proposals: ContractFixtureProposal[] = [], failing: UncertifiedCandidate[] = [];
  const reasonClasses = new Map<string, number>();
  let checked = 0, certified = 0;
  for (const entry of listSlots(root, "designer")) {
    let doc: ReturnType<typeof readSlot>;
    try { doc = readSlot(root, "designer", entry.id); } catch { continue; }
    if (doc.kind !== "element") continue;
    const layer = entry.position.l0 ?? entry.id.split(".")[0]!;
    const pinName = entry.pin?.candidate;
    const pinnedJson = pinName && CANDIDATE_NAME.exec(pinName)?.[3] === "json" ? pinName : undefined;
    let pinnedItem: { meta?: { preview?: unknown } } | undefined, pinnedBytes = "";
    if (pinnedJson) { try { pinnedBytes = readCandidate(root, "designer", entry.id, pinnedJson).bytes; pinnedItem = JSON.parse(pinnedBytes); } catch { pinnedItem = undefined; } }
    let contract: Readonly<Record<string, unknown>> = doc.contract;
    if (doc.contract.fixture !== undefined) {
      proposals.push({ slot: entry.id, status: "declared", ...(pinName ? { pinned: pinName } : {}) });
    } else if (!pinnedJson || !pinnedItem) {
      proposals.push({ slot: entry.id, status: "no-source", reason: "unpinned", ...(pinName ? { pinned: pinName } : {}) });
    } else {
      const preview = pinnedItem.meta?.preview;
      const fixture = fixtureFromPreview(preview);
      const mounts = certifyCandidate({ root, slot: entry.id, name: pinnedJson, bytes: pinnedBytes, contract: {}, layer, writerSource }).mounts;
      if (!fixture) {
        proposals.push({ slot: entry.id, status: "no-source", pinned: pinnedJson, mounts, reason: preview === undefined ? "pinned-without-preview" : "pinned-preview-without-fixture" });
      } else {
        const declared = Array.isArray(doc.contract.props) ? (doc.contract.props as unknown[]).filter((name): name is string => typeof name === "string") : [];
        const propsToDeclare = Object.keys(fixture.fixtures.props).filter(key => !declared.includes(key)).sort();
        contract = { ...doc.contract, props: [...declared, ...propsToDeclare], fixture };
        proposals.push({ slot: entry.id, status: "derived", pinned: pinnedJson, mounts, fixture, propsToDeclare });
      }
    }
    for (const name of entry.candidates) {
      if (CANDIDATE_NAME.exec(name)?.[3] !== "json") continue;
      checked++;
      let bytes: string;
      try { bytes = readCandidate(root, "designer", entry.id, name).bytes; }
      catch (error) { failing.push({ slot: entry.id, candidate: name, pinned: name === pinName, reasons: [error instanceof Error ? error.message : String(error)] }); continue; }
      const result = certifyCandidate({ root, slot: entry.id, name, bytes, contract, layer, writerSource });
      if (result.certified) { certified++; continue; }
      failing.push({ slot: entry.id, candidate: name, pinned: name === pinName, reasons: result.reasons });
      for (const cls of new Set(result.reasons.map(reasonClass))) reasonClasses.set(cls, (reasonClasses.get(cls) ?? 0) + 1);
    }
  }
  const noSource = proposals.filter(row => row.status === "no-source");
  return {
    slots: proposals.length,
    declared: proposals.filter(row => row.status === "declared").length,
    derived: proposals.filter(row => row.status === "derived").length,
    noSource: {
      total: noSource.length,
      unpinned: noSource.filter(row => row.reason === "unpinned").length,
      pinnedWithoutPreview: noSource.filter(row => row.reason === "pinned-without-preview").length,
      pinnedWithoutPreviewMounting: noSource.filter(row => row.reason === "pinned-without-preview" && row.mounts).length,
      pinnedPreviewWithoutFixture: noSource.filter(row => row.reason === "pinned-preview-without-fixture").length,
    },
    propsToDeclare: proposals.filter(row => row.propsToDeclare?.length).length,
    candidates: { checked, certified, pinnedFailing: failing.filter(row => row.pinned).length, nonPinnedFailing: failing.filter(row => !row.pinned).length },
    reasonClasses: Object.fromEntries([...reasonClasses].sort(([a], [b]) => a.localeCompare(b))),
    proposals,
    failing,
  };
}
