/** Canonical, unpinned Designer candidates emitted from registered package implementations. */
import { emitSurfacePackageCandidate, runtimeHash, runtimeSnapshot, type CompositeCatalogData, type RuntimeJson, type SurfacePackageEvidence, type SurfaceSlot } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/node";
import { specimenRecordFrom } from "@clossys/publisher/specimen";
import { listSlots, readCandidate, readSlot } from "../records/slots.js";
import { writeCandidate } from "../records/slot-write.js";
import { CANDIDATE_NAME, candidateName, jsonBytes, sameJson, validateCandidate, validateSlotDoc } from "../records/slot-model/index.js";
import { RecordError } from "../records/validate.js";
import { sha256Hex } from "../records/hash.js";
import { libraryRecordStore } from "./library-source.js";

export interface CatalogCandidateInput {
  readonly root: string;
  readonly slot: SurfaceSlot;
  /** The consumer's admitted candidate name; the next version is allocated from its actual filenames. */
  readonly element: string;
  readonly source: string;
  readonly catalog: CompositeCatalogData;
  readonly packages: readonly SurfacePackageEvidence[];
  /** Installed package lookup root, when the provider is not installed beside Designer. */
  readonly packageFrom?: string;
  readonly preview: {
    readonly props: Readonly<Record<string, RuntimeJson>>;
    /** Only for a native implementation whose registered prop contract consumes `copy`. */
    readonly copyKeys?: Readonly<Record<string, RuntimeJson>>;
    readonly width?: number;
  };
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(message: string): never { throw new TypeError(`catalog candidate: ${message}`); }
/** The Writer keys a preview value names (`{ "$copy": key }`), sorted: the candidate declares them as its specimen inputs. */
function copyInputs(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => copyInputs(item, found));
  else if (object(value)) {
    if (typeof value.$copy === "string") found.add(value.$copy);
    Object.values(value).forEach(item => copyInputs(item, found));
  }
  return found;
}
function unresolved(value: unknown): boolean {
  return Array.isArray(value) ? value.some(unresolved) : object(value) && (Object.hasOwn(value, "$copy") || Object.hasOwn(value, "$asset") || Object.values(value).some(unresolved));
}

/**
 * Write one new standard registry candidate in an EXISTING canonical IA slot.
 * This is a DRAFT provider record: no adoption, pin, approval or browser qualification is created.
 */
export async function materializeCatalogCandidate(input: CatalogCandidateInput) {
  const preview = runtimeSnapshot(input.preview);
  if (!CANDIDATE_NAME.test(candidateName(input.element, 1, "json")) || input.element.includes("..")) fail("invalid admitted element name");
  const emission = emitSurfacePackageCandidate(input);
  const installed = await readSurfacePackageEvidence([emission.document], input.packageFrom ? { from: input.packageFrom } : {});
  if (!sameJson(installed.find(row => row.module === emission.package.module), emission.package)) fail("installed package artifact evidence differs");
  const entry = listSlots(input.root, "designer").find(row => row.id === input.slot);
  if (!entry) fail("target slot is not in the Designer IA");
  const slot = readSlot(input.root, "designer", input.slot), issues = validateSlotDoc(slot);
  if (slot.id !== input.slot || slot.agent !== "designer" || slot.kind !== "element" || !sameJson(slot.ia, entry.position) || !sameJson(slot.contract, emission.contract.contract)) fail("target slot identity, position or native contract differs");
  if (issues.length) throw new RecordError(`slot ${input.slot}`, issues);
  const descriptor = emission.descriptor;
  const contract = emission.contract.contract;
  const required = contract.slots.filter(row => row.required).map(row => "name" in row ? row.name : row.id);
  const mappings = "slotMap" in descriptor ? descriptor.slotMap : descriptor.slots;
  const roots = new Set(Object.values({ ...mappings, ...descriptor.propMap, ...("statePorts" in descriptor ? descriptor.statePorts : descriptor.configs) }).flatMap(pointer => pointer.replace(/^.*#\w+\./, "").split(/[,/]/).map(path => path.split(/[.=]/)[0]!)));
  const props = preview.props;
  const ports = { required, supplied: Object.keys(props), unresolved: [] as string[], serverRequired: emission.adapter === "siteShellProps" || emission.rendering === "server" };
  if (!object(props)) fail("preview props must be an object");
  if (emission.adapter === "siteShellProps") {
    if (preview.copyKeys !== undefined) fail("siteShellProps has no native copyKeys adapter");
    if (Object.keys(props).some(key => !["content", "selection", "slots", "locale"].includes(key))) fail("unsupported siteShellProps port");
    const selection = props.selection, content = props.content;
    if (!object(selection) || selection.leaf !== input.slot || selection.fill !== emission.document.$extensions["com.clossys.fill"].id || selection.config !== null || !Array.isArray(selection.members) || selection.members.some((member: unknown) => typeof member !== "string" || !Object.hasOwn(descriptor.propMap, member))) fail("native selection identity, config or members differ");
    if (!object(content) || !object(selection.content)) fail("real native content and references are required");
    for (const key of required.filter(key => key !== "main")) if (!Object.hasOwn(content, key)) fail(`required content port ${key} is missing`);
    for (const [key, row] of Object.entries(content)) {
      if (!Object.hasOwn(mappings, key) || !object(row) || !sameJson(row.reference, selection.content[key]) || !object(row.reference) || typeof row.reference.ref !== "string") fail(`native content reference ${key} differs`);
      if (unresolved(row.value)) fail(`native content ${key} must be Writer/asset-resolved before hashing`);
      if (row.hash !== runtimeHash(row.value)) fail(`native content hash ${key} differs`);
    }
    if (object(props.slots) && Object.hasOwn(props.slots, "main")) fail("main is supplied by bound children");
    ports.unresolved.push("children/main");
  } else {
    if (Object.keys(props).some(key => !roots.has(key))) fail("preview prop has no native package binding");
    for (const key of required) for (const target of mappings[key]?.replace(/^.*#\w+\./, "").split(/[,/]/).map(path => path.split(".")[0]) ?? []) if (!target || !Object.hasOwn(props, target)) fail(`required native port ${key} is missing`);
    if (required.some(key => !mappings[key])) fail("required native port has no implementation binding");
    if (preview.copyKeys !== undefined && !roots.has("copy")) fail("native package has no copy prop contract");
    for (const pointer of Object.values(descriptor.propMap) as string[]) {
      const [prop, literal] = pointer.replace(/^.*#\w+\./, "").split("=");
      if (literal !== undefined && Object.hasOwn(props, prop!) && !Object.values(descriptor.propMap).some(value => String(value).endsWith(`${prop}=${String(props[prop!])}`))) fail("native configuration value differs");
    }
  }
  if (preview.width !== undefined && (!Number.isInteger(preview.width) || preview.width < 1 || preview.width > 3840)) fail("invalid preview width");
  const meta = emission.document.$extensions["com.clossys.fill"], pin = meta.pin!;
  const copyExport = preview.copyKeys === undefined ? {} : { copyKeys: "catalogCopyKeys" };
  const inputs = [...copyInputs(props)].sort();
  const content = emission.file.contents + (preview.copyKeys === undefined ? "" : `export const catalogCopyKeys = ${JSON.stringify(preview.copyKeys)} as const;\n`);
  const item = {
    name: input.element, type: "registry:block", dependencies: [`${pin.package}@${pin.version}`],
    files: [{ path: emission.file.path, target: `components/foundry/${input.element}.${emission.file.path.endsWith("tsx") ? "tsx" : "ts"}`, type: "registry:component", content }],
    meta: { slot: input.slot, source: { kind: "registry", ref: [meta.id, `${pin.package}@${pin.version}${pin.export}`], hash: emission.descriptorHash, license: meta.license },
      preview: { fixtures: { file: emission.file.path, export: emission.export, ...copyExport, props }, ...(inputs.length ? { inputs: { copy: inputs } } : {}), ...(preview.width === undefined ? {} : { width: preview.width }) },
      catalog: { document: emission.document, descriptorHash: emission.descriptorHash, package: emission.package, adapter: emission.adapter, ports } },
  };
  const versions = entry.candidates.flatMap(name => { const match = CANDIDATE_NAME.exec(name); return match?.[1] === input.element && match[3] === "json" ? [Number(match[2])] : []; });
  const version = Math.max(0, ...versions) + 1;
  if (!Number.isSafeInteger(version)) fail("candidate version exhausted");
  const candidate = candidateName(input.element, version, "json"), bytes = jsonBytes(item);
  const findings = validateCandidate("element", input.slot, candidate, bytes);
  if (findings.length) throw new RecordError(`candidate ${candidate}`, findings);
  // Exercise the common payload/preview validator before the exclusive write.
  specimenRecordFrom({ id: `${input.slot}/${input.element}`, version, kind: item.type, files: [{ path: `${input.element}.json`, content: bytes }], preview: item.meta.preview, contentHash: sha256Hex(bytes) });
  // The one slot-model writer allocates the same next version and refuses aliased paths.
  let written: { name: string };
  try { written = writeCandidate(input.root, "designer", input.slot, input.element, item, { canonical: true }); }
  catch (error) { fail(error instanceof Error ? error.message.replace(/^candidate refused: /, "") : String(error)); }
  if (written.name !== candidate) fail("candidate version allocation differs");
  const read = readCandidate(input.root, "designer", input.slot, candidate);
  const record = await libraryRecordStore([input.root]).load(`${input.slot}/${input.element}`, version);
  if (!record || read.bytes !== bytes) fail("canonical candidate readback differs");
  return { status: "DRAFT" as const, approved: false as const, candidate, id: record.id, version, contentHash: record.contentHash, record, ports };
}
