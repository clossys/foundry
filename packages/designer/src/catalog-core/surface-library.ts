/** Pure closed-schema ownership and provenance. No source callbacks run here. */
import { CatalogError } from "./api.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { runtimeSnapshot } from "./runtime-ports.js";
import type { CompositeCatalogData, CompositeLibraryData, CompositeResolved } from "./types.js";
import type { SurfaceAnyDocument, SurfaceEntry, SurfacePackageDocument, SurfacePackageEntry, SurfacePackageOrigin, SurfacePackagePin, SurfacePackageRegistration, SurfaceContractDiff, SurfaceBase, SurfaceCandidate, SurfaceCandidateDocument, SurfaceDocument, SurfaceFile, SurfaceFileHash, SurfaceInputIdentity, SurfaceInputRef, SurfaceLibraryPortion, SurfaceOperation, SurfaceOrigin, SurfaceRuleIdentity, SurfaceSourceBundle, SurfaceSelection, SurfaceResolutionOptions } from "./surface-types.js";
export const surfaceDigest = (value: unknown): string => `sha256:${sha256(stableStringify(value))}`;
export function surfaceFault(message: string): never { throw new CatalogError(`surfaces: ${message}`); }
const safeKey = (key: string): boolean => !["__proto__", "constructor", "prototype"].includes(key);
const name = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && safeKey(value);
const pascal = (value: unknown): value is string => name(value) && /^[A-Z]/.test(value);
export const surfacePrimary = (slot: string): string => slot.split(".")[1]!.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
type Node = Record<string, unknown>;
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Node {
    if (!value || typeof value !== "object" || Array.isArray(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !safeKey(key) || !required.includes(key) && !optional.includes(key)))
        surfaceFault("S1 closed object schema differs");
}
function string(value: unknown): asserts value is string { if (typeof value !== "string" || !value.trim())
    surfaceFault("S1 nonempty string required"); }
function list(value: unknown, visit: (item: unknown) => void, nonempty = false): void { if (!Array.isArray(value) || nonempty && !value.length)
    surfaceFault("S1 array required"); value.forEach(visit); }
function strings(value: unknown): void { list(value, string); if (new Set(value as string[]).size !== (value as string[]).length)
    surfaceFault("S1 duplicate set entry"); }
function choice(value: unknown, values: readonly unknown[]): void { if (!values.includes(value))
    surfaceFault("S1 unknown discriminant"); }
function hash(value: unknown, prefixed = false): void { if (typeof value !== "string" || !(prefixed ? /^sha256:[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/).test(value))
    surfaceFault("S2 invalid digest"); }
export function surfacePath(path: string, slot?: string): void {
    if (typeof path !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(path) || path.split("/").some(part => part === "." || part === ".."))
        surfaceFault("S1 unsafe path");
    if (!slot)
        return;
    const [kind, leaf] = slot.split(".");
    const owned = new RegExp(`^${kind}/${leaf}/.+\\.tsx?$`).test(path) || /^surfaces\/_parts\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/.+\.tsx?$/.test(path) || /^surfaces\/receipts\/r-[a-f0-9]{64}\.json$/.test(path) || /^notices\/surfaces\/n-[a-f0-9]{64}\.txt$/.test(path);
    if (!owned || path === `${kind}/${leaf}/index.ts`)
        surfaceFault("S1 foreign or generated owned path");
}
function manifest(value: unknown): void {
    list(value, row => { object(row, ["path", "sha256"]); string(row.path); surfacePath(row.path); hash(row.sha256); }, true);
    if (new Set((value as SurfaceFileHash[]).map(row => row.path)).size !== (value as SurfaceFileHash[]).length)
        surfaceFault("S2 duplicate manifest path");
}
function pin(value: unknown): void {
    object(value, ["kind", "files"], ["url", "commit", "tree"]);
    manifest(value.files);
    if (value.kind === "git") {
        object(value, ["kind", "files", "url", "commit"]);
        string(value.url);
        string(value.commit);
        let url: URL;
        try {
            url = new URL(value.url);
        }
        catch {
            return surfaceFault("S2 invalid git URL");
        }
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_./-]+$/.test(url.pathname) || !/^[a-f0-9]{40}$/.test(value.commit))
            surfaceFault("S2 immutable credential-free git pin required");
    }
    else {
        object(value, ["kind", "files", "tree"]);
        choice(value.kind, ["local-tree"]);
        if (typeof value.tree !== "string" || !/^[a-f0-9]{40}$/.test(value.tree))
            surfaceFault("S2 immutable tree required");
    }
}
export function assertSurfaceRule(value: unknown): asserts value is SurfaceRuleIdentity { object(value, ["id", "version", "sha256"]); string(value.id); string(value.version); hash(value.sha256); }
function base(value: unknown): asserts value is SurfaceBase {
    object(value, ["source", "fill", "license", "pin", "descriptorHash", "upstreamSha256", "notices"]);
    [value.source, value.fill, value.license].forEach(string);
    pin(value.pin);
    hash(value.descriptorHash, true);
    manifest(value.upstreamSha256);
    manifest(value.notices);
    if (stableStringify(sortedManifest((value.pin as SurfaceBase["pin"]).files)) !== stableStringify(sortedManifest(value.upstreamSha256 as SurfaceFileHash[])) || (value.notices as SurfaceFileHash[]).some(row => !(value.upstreamSha256 as SurfaceFileHash[]).some(up => up.path === row.path && up.sha256 === row.sha256)))
        surfaceFault("S2 upstream/notice set differs");
}
export function assertSurfaceInputs(value: unknown): asserts value is SurfaceInputIdentity[] {
    list(value, row => { object(row, ["input", "hash"]); inputRef(row.input); hash(row.hash, true); });
    const rows = value as SurfaceInputIdentity[];
    if (new Set(rows.map(row => `${row.input.kind}:${row.input.id}`)).size !== rows.length)
        surfaceFault("S6 duplicate inputs");
}
function inputRef(value: unknown): void {
    object(value, ["kind", "id"]);
    string(value.id);
    choice(value.kind, ["component", "value", "surface", "dependency"]);
    if (value.kind !== "dependency" && !(value.kind === "component" ? /^components\.[a-z][a-z0-9-]*$/ : value.kind === "surface" ? /^(sections|frames)\.[a-z][a-z0-9-]*$/ : /^(tokens|assets)\.[a-z][a-z0-9.-]*$/).test(value.id))
        surfaceFault("S6 invalid input reference");
}
function binding(value: unknown): void { object(value, ["export", "path"]); if (!pascal(value.export))
    surfaceFault("S1 binding target invalid"); list(value.path, item => { if (item !== "[]" && !name(item))
    surfaceFault("S1 binding path invalid"); }, true); if ((value.path as string[])[0] === "[]" || (value.path as string[]).some((item, i, all) => item === "[]" && all[i - 1] === "[]"))
    surfaceFault("S1 binding path invalid"); }
function map(value: unknown, visit: (entry: unknown, key: string) => void): void { if (!value || typeof value !== "object" || Array.isArray(value))
    surfaceFault("S1 map required"); for (const [key, entry] of Object.entries(value)) {
    if (!safeKey(key))
        surfaceFault("S1 unsafe map key");
    visit(entry, key);
} }
function origin(value: unknown): asserts value is SurfaceOrigin {
    object(value, ["kind", "descriptorHash"], ["base", "transform", "adoptedAt", "rule", "inputs", "inputsHash", "license", "lineage", "note"]);
    hash(value.descriptorHash, true);
    if (value.kind === "adopted") {
        object(value, ["kind", "descriptorHash", "base", "transform", "adoptedAt"]);
        base(value.base);
        assertSurfaceRule(value.transform);
        string(value.adoptedAt);
        if (!Number.isFinite(Date.parse(value.adoptedAt)))
            surfaceFault("S2 invalid date");
    }
    else if (value.kind === "derived") {
        object(value, ["kind", "descriptorHash", "base", "transform", "rule", "inputs", "inputsHash"]);
        base(value.base);
        assertSurfaceRule(value.transform);
        assertSurfaceRule(value.rule);
        assertSurfaceInputs(value.inputs);
        hash(value.inputsHash, true);
    }
    else {
        object(value, ["kind", "descriptorHash", "license"], ["lineage", "note"]);
        choice(value.kind, ["authored"]);
        string(value.license);
        if (value.lineage !== undefined)
            base(value.lineage);
        if (value.note !== undefined)
            string(value.note);
    }
}
export function assertSurfaceCandidate(value: unknown, installed = false): asserts value is SurfaceCandidate & {
    origin?: SurfaceOrigin;
} {
    const common = ["kind", "slot", "source", "impl", "rendering", "members", "states", "reads", "composes", "parts", "api", "bindings", "dependencies", "license", "pin", "notice", "outputSha256", "blockers", "propMap"];
    object(value, [...common, ...(installed ? ["origin"] : [])], ["slotMap", "configs", "slots", "statePorts"]);
    choice(value.kind, ["section", "frame"]);
    if (typeof value.slot !== "string" || !(value.kind === "section" ? /^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ : /^frames\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).test(value.slot))
        surfaceFault("S1 slot/kind differs");
    object(value, [...common, ...(value.kind === "section" ? ["slotMap", "configs"] : ["slots", "statePorts"]), ...(installed ? ["origin"] : [])]);
    [value.source, value.license, value.notice].forEach(string);
    pin(value.pin);
    choice(value.rendering, ["client", "server"]);
    object(value.impl, ["kind", "entry", "export"]);
    choice(value.impl.kind, ["source"]);
    if (!pascal(value.impl.export))
        surfaceFault("S1 implementation identifier");
    string(value.impl.entry);
    surfacePath(value.impl.entry, value.slot);
    for (const field of [value.members, value.states, value.composes, value.parts])
        strings(field);
    if (!(value.states as string[]).includes("default"))
        surfaceFault("S1 default state required");
    object(value.reads, ["tokens", "assets"]);
    strings(value.reads.tokens);
    strings(value.reads.assets);
    object(value.api, ["version", "exports"]);
    choice(value.api.version, [1]);
    list(value.api.exports, row => { object(row, ["name", "export"]); if (!pascal(row.name) || !pascal(row.export) || row.name === "LibraryProvider" || row.export === "LibraryProvider")
        surfaceFault("S1 unsafe API"); }, true);
    const api = value.api.exports as SurfaceCandidate["api"]["exports"];
    if (new Set(api.map(row => row.name)).size !== api.length || new Set(api.map(row => row.export)).size !== api.length || api.filter(row => row.name === surfacePrimary(value.slot as string) && row.export === (value.impl as SurfaceCandidate["impl"]).export).length !== 1)
        surfaceFault("S1 API primary/duplicates");
    list(value.bindings, row => { object(row, ["file", "module", "name", "local", "slot"]); [row.file, row.module, row.slot].forEach(string); surfacePath(row.file as string, value.slot as string); if (!name(row.name) || !name(row.local) || !/^components\.[a-z][a-z0-9-]*$/.test(row.slot as string))
        surfaceFault("S1 component binding"); });
    list(value.dependencies, row => { object(row, ["module", "version", "license"]); [row.module, row.version, row.license].forEach(string); if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/.test(row.module as string) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(row.version as string))
        surfaceFault("S4 exact dependency required"); });
    if (new Set((value.dependencies as SurfaceCandidate["dependencies"]).map(row => row.module)).size !== (value.dependencies as unknown[]).length || new Set((value.bindings as SurfaceCandidate["bindings"]).map(row => stableStringify(row))).size !== (value.bindings as unknown[]).length)
        surfaceFault("S1 duplicate dependency/binding");
    manifest(value.outputSha256);
    list(value.blockers, row => { object(row, ["code", "message"]); string(row.code); string(row.message); });
    map(value.propMap, binding);
    if (value.kind === "section") {
        map(value.slotMap, binding);
        map(value.configs, (config, key) => { if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key))
            surfaceFault("S1 config id"); object(config, ["members", "props"]); strings(config.members); list(config.props, row => { object(row, ["export", "path", "value"]); const { value: _literal, ...target } = row; binding(target); }); });
    }
    else {
        map(value.slots, binding);
        map(value.statePorts, row => { object(row, ["value", "change"]); binding(row.value); binding(row.change); if ((row.change as {
            path: string[];
        }).path.length !== 1)
            surfaceFault("S1 direct change prop required"); });
    }
    const visitBinding = (row: unknown) => { const target = row as {
        export: string;
    }; if (!api.some(api => api.export === target.export))
        surfaceFault("S1 unknown local API binding"); };
    Object.values(value.propMap as Node).forEach(visitBinding);
    Object.values((value.kind === "section" ? value.slotMap : value.slots) as Node).forEach(visitBinding);
    if (installed)
        origin(value.origin);
}
const PACKAGE_SPECIFIER = /^(?:@[a-z0-9-]+\/)?[a-z0-9-]+(?:\/[A-Za-z0-9_-]+)*$/;
function packagePin(value: unknown): asserts value is SurfacePackagePin {
    object(value, ["package", "version", "export"]);
    [value.package, value.version, value.export].forEach(string);
    if (!PACKAGE_SPECIFIER.test(value.package as string) || !/^\d+\.\d+\.\d+$/.test(value.version as string))
        surfaceFault("S2 exact package pin required");
}
/** The component K8 rule for surfaces: exact semver, and the pin export names exactly the implementation module and export. */
export function assertSurfacePackagePin(impl: SurfacePackageEntry["impl"], pin: unknown): asserts pin is SurfacePackagePin {
    packagePin(pin);
    const pointer = /^\.\/([A-Za-z0-9_/-]+)#([A-Z][A-Za-z0-9]*)$/.exec(pin.export);
    if (!pointer || `${pin.package}/${pointer[1]}` !== impl.module || pointer[2] !== impl.export)
        surfaceFault("S2 package export differs from pin");
}
function packageOrigin(value: unknown): asserts value is SurfacePackageOrigin {
    object(value, ["kind", "source", "fill", "pin", "license", "descriptorHash", "adoptedAt"], ["history"]);
    choice(value.kind, ["package"]);
    [value.source, value.fill, value.license, value.adoptedAt].forEach(string);
    packagePin(value.pin);
    hash(value.descriptorHash, true);
    if (value.history !== undefined) {
        list(value.history, row => { object(row, ["from", "to"]); hash(row.from, true); hash(row.to, true); if (row.from === row.to) surfaceFault("S2 invalid refresh history"); }, true);
        const history = value.history as { from: string; to: string }[];
        if (history.some((row, index) => index > 0 && row.from !== history[index - 1]!.to) || history.at(-1)!.to !== value.descriptorHash)
            surfaceFault("S2 discontinuous refresh history");
    }
    if (!Number.isFinite(Date.parse(value.adoptedAt as string)))
        surfaceFault("S2 invalid date");
}
const pointers = (value: unknown): void => map(value, entry => string(entry));
/** Closed schema of a package-pointer descriptor, exactly the importer shape. `pin` is the fill-meta pin (catalog) or origin pin (installed). */
export function assertSurfacePackageEntry(value: unknown, pin: unknown, installed = false): asserts value is SurfacePackageEntry {
    const section = value && typeof value === "object" && typeof (value as Node).slot === "string" && ((value as Node).slot as string).startsWith("sections.");
    const fields = section ? ["slot", "source", "slotMap", "propMap", "configs", "parts", "impl", "license", "pin", "notes"] : ["slot", "members", "propMap", "slots", "statePorts", "impl"];
    object(value, [...fields, ...(installed ? ["origin"] : [])], ["reads", "composes", "consumption"]);
    if (typeof value.slot !== "string" || !/^(sections|frames)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.slot))
        surfaceFault("S1 slot/kind differs");
    object(value.impl, ["kind", "module", "export"]);
    choice(value.impl.kind, ["package"]);
    string(value.impl.module);
    if (!PACKAGE_SPECIFIER.test(value.impl.module as string) || !pascal(value.impl.export))
        surfaceFault("S1 implementation identifier");
    pointers(value.propMap);
    if (section) {
        [value.source, value.license].forEach(string);
        pointers(value.slotMap);
        pointers(value.configs);
        strings(value.parts);
        strings(value.notes);
        if (stableStringify(value.pin) !== stableStringify(pin))
            surfaceFault("S2 package pin differs");
    }
    else {
        strings(value.members);
        pointers(value.slots);
        pointers(value.statePorts);
    }
    if (value.reads !== undefined) { object(value.reads, ["tokens", "assets"]); strings(value.reads.tokens); strings(value.reads.assets); }
    if (value.composes !== undefined) strings(value.composes);
    if (value.consumption !== undefined) {
        const measured = value.consumption;
        object(measured, ["scanStatus", "sourceFiles", "scannedReads", "scannedComposes"], ["unresolved"]);
        choice(measured.scanStatus, ["lower-bound", "unavailable"]);
        list(measured.sourceFiles, row => { object(row, ["path", "sha256"]); string(row.path); surfacePath(row.path); hash(row.sha256); });
        object(measured.scannedReads, ["tokens", "assets", "components"]);
        strings(measured.scannedReads.tokens); strings(measured.scannedReads.assets); strings(measured.scannedReads.components);
        strings(measured.scannedComposes);
        if (measured.unresolved !== undefined) list(measured.unresolved, row => {
            object(row, ["file", "line", "evidence"], ["code"]);
            if (typeof row.file !== "string" || !Number.isInteger(row.line) || (row.line as number) < 0) surfaceFault("S1 invalid source finding");
            if (row.file) surfacePath(row.file as string);
            string(row.evidence);
            if (row.code !== undefined) choice(row.code, ["DF1", "DF2", "DF3", "DF4", "DF5", "DF6", "DF7", "DF8"]);
        });
    }
    assertSurfacePackagePin(value.impl as SurfacePackageEntry["impl"], pin);
}
export const isSurfacePackageEntry = (fill: SurfaceEntry): fill is SurfacePackageEntry & { origin?: SurfacePackageOrigin } => fill.impl.kind === "package";
/** Validated whole leaf of either origin family; `surfaceOf` stays the source-only view. */
export function surfaceEntryOf(doc: SurfaceAnyDocument): SurfaceEntry {
    const snapshot = runtimeSnapshot(doc);
    object(snapshot, ["$extensions"], ["sections", "frames"]);
    object(snapshot.$extensions, ["com.clossys.fill"]);
    const meta = snapshot.$extensions["com.clossys.fill"];
    object(meta, ["id", "slot", "source", "mode", "sourceAddress", "relation", "builtOn", "conforms", "evidence", "author", "trust", "license", "status"], ["pin", "signoff", "derivation", "unmapped", "reads", "originKinds", "baseline"]);
    [meta.id, meta.slot, meta.source, meta.sourceAddress, meta.license].forEach(string);
    choice(meta.mode, ["implementation", "reference", "derived"]);
    choice(meta.relation, ["same-contract", "subset", "superset", "derived"]);
    choice(meta.author, ["foundry", "consumer", "third-party"]);
    choice(meta.trust, ["foundry", "consumer", "pinned-upstream", "unpinned"]);
    choice(meta.status, ["draft", "stable"]);
    strings(meta.builtOn);
    strings(meta.conforms);
    list(meta.evidence, () => { });
    const kind = (meta.slot as string).startsWith("sections.") ? "sections" : "frames";
    object(snapshot, ["$extensions", kind]);
    const entries = snapshot[kind];
    object(entries, [(meta.slot as string).split(".")[1]!]);
    const fill = entries[(meta.slot as string).split(".")[1]!]!;
    const installed = !!fill && typeof fill === "object" && Object.hasOwn(fill, "origin");
    const impl = fill && typeof fill === "object" ? (fill as unknown as Node).impl : undefined;
    if (impl && typeof impl === "object" && (impl as Node).kind === "package") {
        if (installed)
            packageOrigin((fill as unknown as Node).origin);
        const pin = installed ? ((fill as unknown as Node).origin as SurfacePackageOrigin).pin : meta.pin;
        assertSurfacePackageEntry(fill, pin, installed);
        const origin = (fill as SurfacePackageEntry & { origin?: SurfacePackageOrigin }).origin;
        if (fill.slot !== meta.slot || (origin ? origin.license !== meta.license || "source" in fill && fill.source !== origin.source : "source" in fill && fill.source !== meta.source || "license" in fill && fill.license !== meta.license))
            surfaceFault("S1 inconsistent whole leaf");
        return fill as SurfaceEntry;
    }
    assertSurfaceCandidate(fill, installed);
    if (fill.slot !== meta.slot || fill.source !== meta.source || fill.license !== meta.license)
        surfaceFault("S1 inconsistent whole leaf");
    return fill;
}
export function surfaceOf(doc: SurfaceAnyDocument): SurfaceCandidate & {
    origin?: SurfaceOrigin;
} {
    const fill = surfaceEntryOf(doc);
    if (isSurfacePackageEntry(fill))
        surfaceFault("S1 closed object schema differs");
    return fill;
}
/** Output rows a leaf owns; a package pointer owns none. */
export const surfaceOutputs = (fill: SurfaceEntry): readonly SurfaceFileHash[] => isSurfacePackageEntry(fill) ? [] : fill.outputSha256;
export const surfacePackageDescriptorHash = (fill: SurfacePackageEntry): string => { const { origin: _origin, ...descriptor } = fill as SurfacePackageEntry & { origin?: unknown }; return surfaceDigest(descriptor); };
const packageCandidates = (catalog: CompositeCatalogData, slot: string, source: string) => (catalog.surfaces?.fills ?? []).filter(doc => { const meta = doc.$extensions["com.clossys.fill"]; return meta.slot === slot && meta.source === source && meta.mode === "implementation"; }).map(doc => ({ doc, fill: surfaceEntryOf(doc) })).filter(row => isSurfacePackageEntry(row.fill));
type PackageIdentity = Pick<SurfacePackageOrigin, "source" | "fill" | "pin" | "license" | "descriptorHash">;
const packageIdentityMatches = (doc: SurfacePackageDocument, identity: PackageIdentity): boolean => {
    const meta = doc.$extensions["com.clossys.fill"];
    return meta.source === identity.source && meta.id === identity.fill && meta.license === identity.license && stableStringify(meta.pin) === stableStringify(identity.pin);
};
/** Validate historical contract fields consumed by static checks and contract diffs. */
function assertPackageContract(value: unknown, slot: string): asserts value is SurfacePackageRegistration["contract"] {
    if (!value || typeof value !== "object" || Array.isArray(value)) surfaceFault("S2 historical contract required");
    const row = value as Node, section = slot.startsWith("sections.");
    if (row.id !== slot || row.layer !== (section ? "sections" : "frames")) surfaceFault("S2 historical contract identity differs");
    if (!row.contract || typeof row.contract !== "object" || Array.isArray(row.contract)) surfaceFault("S2 historical contract required");
    const contract = row.contract as Node;
    if (contract.kind !== (section ? "section" : "frame")) surfaceFault("S2 historical contract kind differs");
    object(contract.members, ["mode", "names"]); choice(contract.members.mode, ["closed"]); strings(contract.members.names);
    list(contract.slots, item => {
        if (!item || typeof item !== "object" || Array.isArray(item)) surfaceFault("S2 historical content slot required");
        const port = item as Node;
        string(port[section ? "name" : "id"]);
        if (typeof port.required !== "boolean") surfaceFault("S2 historical content slot required flag differs");
        string(port[section ? "type" : "accepts"]);
    });
    const contentSlots = (contract.slots as Node[]).map(port => port[section ? "name" : "id"]);
    if (new Set(contentSlots).size !== contentSlots.length) surfaceFault("S2 duplicate historical content slot");
    object(contract.allowedReads, ["tokens", "assets"]); strings(contract.allowedReads.tokens); strings(contract.allowedReads.assets);
    if (section) { strings(contract.allowedComposes); strings(contract.parts); if (contract.composes !== undefined) strings(contract.composes); }
    else {
        choice(contract.rendering, ["server", "client"]);
        list(contract.statePorts, port => { object(port, ["id", "type"], ["values"]); string(port.id); choice(port.type, ["boolean", "number", "string"]); if (port.values !== undefined) strings(port.values); });
        const ports = (contract.statePorts as Node[]).map(port => port.id);
        if (new Set(ports).size !== ports.length) surfaceFault("S2 duplicate historical state port");
        if (contract.composes !== undefined) strings(contract.composes);
    }
}
function historicalPackageDescriptors(catalog: CompositeCatalogData, descriptorHash: string): readonly SurfacePackageRegistration[] {
    const history = catalog.surfaces?.packageHistory;
    if (!history || !Object.hasOwn(history, descriptorHash)) return [];
    const rows = history[descriptorHash]!;
    if (!Array.isArray(rows)) surfaceFault("S2 invalid historical descriptor bucket");
    return rows.map((row: SurfacePackageRegistration) => {
        object(row as unknown, ["document", "contract"]);
        const entry = surfaceEntryOf(row.document);
        if (!isSurfacePackageEntry(entry) || entry.origin || surfacePackageDescriptorHash(entry) !== descriptorHash)
            surfaceFault("S2 historical descriptor registration differs");
        assertPackageContract(row.contract, entry.slot);
        return row;
    });
}
/** Resolve authentic upstream bytes by hash AND full metadata identity, including version-only pins. */
export function resolveSurfacePackageDescriptor(catalog: CompositeCatalogData, slot: string, identity: PackageIdentity): SurfacePackageRegistration {
    const current = packageCandidates(catalog, slot, identity.source).filter(row => surfacePackageDescriptorHash(row.fill as SurfacePackageEntry) === identity.descriptorHash && packageIdentityMatches(row.doc as unknown as SurfacePackageDocument, identity));
    if (current.length > 1) surfaceFault("S2 ambiguous current package descriptor");
    if (current.length === 1) {
        const contract = catalog.surfaces?.slots.find(row => row.id === slot);
        if (!contract) surfaceFault("S1 authored contract missing");
        return runtimeSnapshot({ document: current[0]!.doc as unknown as SurfacePackageDocument, contract });
    }
    const registered = historicalPackageDescriptors(catalog, identity.descriptorHash).filter(row => row.document.$extensions["com.clossys.fill"].slot === slot && packageIdentityMatches(row.document, identity));
    if (registered.length !== 1) surfaceFault("S2 unique registered historical upstream required");
    return runtimeSnapshot(registered[0]!);
}
/** Current upstream remains required; only a catalog-registered old identity can become a stale finding. */
export function verifySurfacePackageProvenance(catalog: CompositeCatalogData, fill: SurfacePackageEntry & { origin?: SurfacePackageOrigin }) {
    const o = fill.origin;
    if (!o || o.descriptorHash !== surfacePackageDescriptorHash(fill))
        surfaceFault("S6 descriptor hand edit requires author");
    const candidates = packageCandidates(catalog, fill.slot, o.source);
    if (candidates.length !== 1) surfaceFault("S2 upstream candidate identity differs: unique current upstream candidate required");
    const current = candidates[0]!, meta = current.doc.$extensions["com.clossys.fill"];
    if (meta.id !== o.fill || meta.pin!.package !== o.pin.package || stableStringify(current.fill.impl) !== stableStringify(fill.impl))
        surfaceFault("S2 foreign upstream candidate identity differs");
    const registration = resolveSurfacePackageDescriptor(catalog, fill.slot, o);
    const registered = surfaceEntryOf(registration.document), registeredMeta = registration.document.$extensions["com.clossys.fill"];
    if (surfacePackageDescriptorHash(registered as SurfacePackageEntry) !== o.descriptorHash || registeredMeta.author !== meta.author || registeredMeta.trust !== meta.trust)
        surfaceFault("S2 upstream candidate identity differs");
    for (const transition of o.history ?? []) for (const digest of [transition.from, transition.to]) {
        const known = surfacePackageDescriptorHash(current.fill as SurfacePackageEntry) === digest || historicalPackageDescriptors(catalog, digest).some(row => {
            const leaf = surfaceEntryOf(row.document), priorMeta = row.document.$extensions["com.clossys.fill"];
            return priorMeta.source === o.source && priorMeta.id === o.fill && priorMeta.pin!.package === o.pin.package && stableStringify(leaf.impl) === stableStringify(fill.impl);
        });
        if (!known) surfaceFault("S2 unregistered refresh history identity");
    }
    const expectedHash = surfacePackageDescriptorHash(current.fill as SurfacePackageEntry);
    return { registration, expectedHash, actualHash: o.descriptorHash, expectedPin: meta.pin as SurfacePackagePin, actualPin: o.pin, stale: expectedHash !== o.descriptorHash || !packageIdentityMatches(current.doc as unknown as SurfacePackageDocument, o) };
}
/** Deterministic public refresh diff. Removing any declared member, slot or state port is breaking. */
export function surfaceContractDiff(before: SurfacePackageEntry, after: SurfacePackageEntry, contracts?: { before: SurfacePackageRegistration["contract"]; after: SurfacePackageRegistration["contract"] }): SurfaceContractDiff {
    if (before.slot !== after.slot) surfaceFault("S1 contract diff slot differs");
    const sorted = (values: readonly string[]) => [...new Set(values)].sort();
    const mapped = (entry: SurfacePackageEntry) => ({
        members: sorted([...("members" in entry ? entry.members : []), ...Object.keys(entry.propMap)]),
        slots: Object.keys("slotMap" in entry ? entry.slotMap : entry.slots),
        statePorts: Object.keys("statePorts" in entry ? entry.statePorts : {}),
    });
    const declared = (registered?: SurfacePackageRegistration["contract"]) => {
        if (!registered) return { members: [], slots: [], statePorts: [] };
        assertPackageContract(registered, before.slot);
        const contract = registered.contract;
        return { members: contract.members.names, slots: contract.kind === "section" ? contract.slots.map(port => port.name) : contract.slots.map(port => port.id), statePorts: contract.kind === "frame" ? contract.statePorts.map(port => port.id) : [] };
    };
    const old = mapped(before), next = mapped(after), oldContract = declared(contracts?.before), nextContract = declared(contracts?.after);
    const difference = (from: typeof old, to: typeof old, fromContract: ReturnType<typeof declared>, toContract: ReturnType<typeof declared>) => {
        const field = (key: keyof typeof old) => sorted([...to[key].filter(value => !from[key].includes(value)), ...toContract[key].filter(value => !fromContract[key].includes(value))]);
        return { members: field("members"), slots: field("slots"), statePorts: field("statePorts") };
    };
    const added = difference(old, next, oldContract, nextContract), removed = difference(next, old, nextContract, oldContract);
    return { fromHash: surfacePackageDescriptorHash(before), toHash: surfacePackageDescriptorHash(after), added, removed, breaking: Object.values(removed).some(keys => keys.length > 0) };
}
export function surfacePackageDocument(library: CompositeLibraryData, fill: SurfacePackageEntry, origin: SurfacePackageOrigin): SurfacePackageDocument {
    const meta = { id: `${library.source.id}/${fill.slot}`, slot: fill.slot, source: library.source.id, mode: "implementation" as const, sourceAddress: `fills/${fill.slot}.json`, relation: "same-contract" as const, builtOn: [], conforms: [], evidence: [], author: "consumer" as const, trust: "consumer" as const, license: origin.license, status: "draft" as const, originKinds: ["package"] };
    return fill.slot.startsWith("sections.") ? { $extensions: { "com.clossys.fill": meta as unknown as SurfacePackageDocument["$extensions"]["com.clossys.fill"] }, sections: { [fill.slot.slice(9)]: { ...structuredClone(fill), origin } } } : { $extensions: { "com.clossys.fill": meta as unknown as SurfacePackageDocument["$extensions"]["com.clossys.fill"] }, frames: { [fill.slot.slice(7)]: { ...structuredClone(fill), origin } } };
}
export const sortedManifest = (rows: readonly SurfaceFileHash[]): SurfaceFileHash[] => [...rows].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
export const surfaceManifest = (files: readonly SurfaceFile[]): SurfaceFileHash[] => sortedManifest(files.map(file => ({ path: file.path, sha256: sha256(file.content) })));
function canonicalSurfaceEntry<T extends SurfaceCandidate>(entry: T): T { const fill = structuredClone(entry); const normalize = (values: readonly string[]) => [...values].sort(); fill.members = normalize(fill.members); fill.states = normalize(fill.states); fill.composes = normalize(fill.composes); fill.parts = normalize(fill.parts); fill.reads = { tokens: normalize(fill.reads.tokens), assets: normalize(fill.reads.assets) }; fill.api = { version: 1, exports: [...fill.api.exports].sort((a, b) => a.name < b.name ? -1 : 1) }; fill.bindings = [...fill.bindings].sort((a, b) => stableStringify([a.file, a.module, a.name, a.local, a.slot]) < stableStringify([b.file, b.module, b.name, b.local, b.slot]) ? -1 : 1); fill.dependencies = [...fill.dependencies].sort((a, b) => a.module < b.module ? -1 : 1); fill.outputSha256 = sortedManifest(fill.outputSha256); fill.pin = { ...fill.pin, files: sortedManifest(fill.pin.files) }; if (fill.kind === "section")
    fill.configs = Object.fromEntries(Object.entries(fill.configs).map(([id, config]) => [id, { ...config, members: normalize(config.members) }])); return fill; }
export function surfaceDescriptorHash(fill: SurfaceCandidate): string { const { origin: _origin, ...descriptor } = canonicalSurfaceEntry(fill) as SurfaceCandidate & {
    origin?: SurfaceOrigin;
}; return surfaceDigest(descriptor); }
export function canonicalSurfacePortion(input: SurfaceLibraryPortion): SurfaceLibraryPortion {
    const copy = runtimeSnapshot(input);
    object(copy, ["version", "fills", "files"]);
    choice(copy.version, [1]);
    list(copy.fills, row => { surfaceEntryOf(row as SurfaceDocument); });
    list(copy.files, row => { object(row, ["path", "content"]); string(row.path); if (typeof row.content !== "string" || row.content.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row.content))
        surfaceFault("S1 invalid UTF-8 source"); surfacePath(row.path); });
    const fills = [...input.fills].map(doc => structuredClone(doc)).sort((a, b) => surfaceEntryOf(a).slot < surfaceEntryOf(b).slot ? -1 : 1), files = [...input.files].sort((a, b) => a.path < b.path ? -1 : 1);
    if (new Set(fills.map(doc => surfaceEntryOf(doc).slot)).size !== fills.length || new Set(files.map(file => file.path)).size !== files.length)
        surfaceFault("S1 duplicate ownership");
    for (const doc of fills) {
        const entry = surfaceEntryOf(doc);
        if (isSurfacePackageEntry(entry))
            continue;
        const fill = canonicalSurfaceEntry(entry);
        // Replace the cloned entry (surfaceOf deliberately returns a frozen validation snapshot).
        const layer = fill.kind === "section" ? "sections" : "frames";
        Object.assign((doc as unknown as Record<string, Record<string, unknown>>)[layer]!, { [fill.slot.split(".")[1]!]: fill });
    }
    return { version: 1, fills, files };
}
export function surfacePortionHash(portion: SurfaceLibraryPortion): string { return surfaceDigest(canonicalSurfacePortion(portion)); }
export function verifySurfaceFiles(fill: SurfaceCandidate, files: readonly SurfaceFile[]): void {
    for (const row of fill.outputSha256) {
        surfacePath(row.path, fill.slot);
        const file = files.find(file => file.path === row.path);
        if (!file || sha256(file.content) !== row.sha256)
            surfaceFault("S2 output hash differs");
        if (row.path.startsWith("notices/surfaces/") && row.path !== `notices/surfaces/n-${sha256(file.content)}.txt`)
            surfaceFault("S2 notice identity differs");
        if (row.path.startsWith("surfaces/receipts/") && row.path !== `surfaces/receipts/r-${sha256(file.content)}.json`)
            surfaceFault("S2 receipt identity differs");
    }
    if (!fill.outputSha256.some(row => row.path === fill.impl.entry) || !fill.outputSha256.some(row => row.path === fill.notice) || !files.find(file => file.path === fill.notice)?.content.trim())
        surfaceFault("S2 missing entry/notice");
}
export function surfaceSelection(library: CompositeLibraryData): SurfaceSelection { return { version: 1, consumer: library.source.id, slots: (library.surfaces?.fills ?? []).map(doc => { const fill = surfaceEntryOf(doc), origin = fill.origin!; return { slot: fill.slot, fill: doc.$extensions["com.clossys.fill"].id, originKind: origin.kind, source: origin.kind === "authored" ? library.source.id : origin.kind === "package" ? origin.source : origin.base.source }; }).sort((a, b) => a.slot < b.slot ? -1 : 1) }; }
export function surfaceInputs(catalog: CompositeCatalogData, library: CompositeLibraryData, resolved: CompositeResolved, inputs: readonly SurfaceInputRef[], options: SurfaceResolutionOptions): SurfaceInputIdentity[] {
    const result = inputs.map(input => {
        inputRef(input);
        let value: unknown;
        if (input.kind === "component") {
            const component = resolved.components.components[input.id];
            if (!component)
                surfaceFault("S6 selected component input missing");
            value = { component, files: resolved.components.files, packageExports: resolved.components.packageExports };
        }
        else if (input.kind === "value") {
            const matches = Object.entries(resolved.values.members).filter(([id]) => id === input.id || id.startsWith(input.id + "."));
            if (!matches.length)
                surfaceFault("S6 selected value input missing");
            value = matches;
        }
        else if (input.kind === "dependency") {
            value = options.packages.find(row => row.module === input.id);
            if (!value)
                surfaceFault("S6 dependency input missing");
        }
        else {
            const row = resolved.surfaces?.fills[input.id];
            if (!row)
                surfaceFault("S6 surface input missing or cyclic");
            value = { descriptorHash: row.descriptorHash, outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash };
        }
        return { input, hash: surfaceDigest(value) };
    }).sort((a, b) => `${a.input.kind}:${a.input.id}` < `${b.input.kind}:${b.input.id}` ? -1 : 1);
    assertSurfaceInputs(result);
    return result;
}
export function surfaceDerivationHash(base: SurfaceBase, transform: SurfaceRuleIdentity, rule: SurfaceRuleIdentity | null, catalog: CompositeCatalogData, slot: string, inputs: readonly SurfaceInputIdentity[]): string { return surfaceDigest({ base, transform, rule, contracts: catalog.surfaces?.slots.find(row => row.id === slot), inputs }); }
export function assertRegistryIdentity(identity: SurfaceRuleIdentity, source: readonly SurfaceFile[]): void { assertSurfaceRule(identity); if (!source.length || new Set(source.map(file => file.path)).size !== source.length || surfaceDigest(surfaceManifest(source)).slice(7) !== identity.sha256)
    surfaceFault("S2 registered source identity differs"); }
export function verifySurfaceProvenance(catalog: CompositeCatalogData, library: CompositeLibraryData, fill: SurfaceCandidate & {
    origin?: SurfaceOrigin;
}): void {
    const o = fill.origin;
    if (!o || o.descriptorHash !== surfaceDescriptorHash(fill))
        surfaceFault("S6 descriptor hand edit requires author");
    if (o.kind === "authored") {
        if (o.license !== fill.license || !o.lineage)
            surfaceFault("S2 authored lineage missing");
        return;
    }
    base(o.base);
    const registry = catalog.surfaces;
    if (!registry)
        surfaceFault("S2 registry missing");
    const transform = registry.transforms.filter(row => stableStringify(row.identity) === stableStringify(o.transform));
    if (transform.length !== 1)
        surfaceFault("S2 transform identity missing");
    assertRegistryIdentity(transform[0]!.identity, transform[0]!.source);
    const candidate = registry.fills.map(surfaceEntryOf).filter((row): row is SurfaceCandidate => !isSurfacePackageEntry(row) && row.slot === fill.slot && row.source === o.base.source);
    if (candidate.length !== 1 || surfaceDescriptorHash(candidate[0]!) !== o.base.descriptorHash || stableStringify(candidate[0]!.pin) !== stableStringify(o.base.pin))
        surfaceFault("S2 upstream candidate identity differs");
    const inputs = o.kind === "derived" ? o.inputs : [];
    const rule = o.kind === "derived" ? o.rule : null;
    const receipt = stableStringify({ version: 1, base: o.base, transform: o.transform, rule, inputs });
    const path = `surfaces/receipts/r-${sha256(receipt)}.json`;
    if (!fill.outputSha256.some(row => row.path === path) || library.surfaces?.files.find(file => file.path === path)?.content !== receipt)
        surfaceFault("S2 provenance receipt differs");
    const expected = registry.materializations.filter(row => row.operation === (o.kind === "derived" ? "derive" : "adopt") && row.slot === fill.slot && row.baseDescriptorHash === o.base.descriptorHash && stableStringify(row.transform) === stableStringify(o.transform) && stableStringify(row.rule) === stableStringify(rule) && row.descriptorHash === o.descriptorHash && stableStringify(sortedManifest(row.outputSha256)) === stableStringify(sortedManifest(fill.outputSha256)));
    if (expected.length !== 1 || expected[0]!.inputsHash !== surfaceDerivationHash(o.base, o.transform, rule, catalog, fill.slot, inputs))
        surfaceFault("S2 immutable materialization receipt missing");
}
export function applySurfaceOperation(catalog: CompositeCatalogData, library: CompositeLibraryData, operation: SurfaceOperation, bundles: readonly SurfaceSourceBundle[], resolved: CompositeResolved, options: SurfaceResolutionOptions): CompositeLibraryData {
    const copy = structuredClone(library);
    const current = copy.surfaces?.fills.find(doc => surfaceEntryOf(doc).slot === operation.slot);
    if (operation.op === "remove" && !current)
        return copy;
    if (!catalog.surfaces?.slots.some(row => row.id === operation.slot))
        surfaceFault("S1 unknown surface contract");
    if (current) {
        const target = surfaceEntryOf(current), meta = current.$extensions["com.clossys.fill"];
        if (!target.origin) surfaceFault("S1 consumer origin missing");
        if (meta.id !== `${copy.source.id}/${target.slot}` || meta.source !== copy.source.id || !isSurfacePackageEntry(target) && target.source !== copy.source.id || meta.sourceAddress !== `fills/${target.slot}.json` || meta.author !== "consumer" || meta.trust !== "consumer" || meta.status !== "draft" || meta.conforms.length || meta.evidence.length || stableStringify(meta.originKinds) !== stableStringify([target.origin.kind]))
            surfaceFault("S1 consumer metadata differs");
    }
    if (operation.op === "refresh") {
        if (!current) surfaceFault("S2 refresh requires held surface");
        const held = surfaceEntryOf(current);
        if (!isSurfacePackageEntry(held) || !held.origin || held.origin.kind !== "package") surfaceFault("S2 refresh requires package origin");
        const origin = held.origin;
        if (origin.source !== operation.source)
            surfaceFault("S2 refresh source differs");
        verifySurfacePackageProvenance(catalog, held);
        const candidates = packageCandidates(catalog, operation.slot, operation.source);
        if (candidates.length !== 1) surfaceFault("S2 unique refresh upstream required");
        const candidate = candidates[0]!, upstream = candidate.doc.$extensions["com.clossys.fill"], next = candidate.fill as SurfacePackageEntry;
        // A refresh may update the descriptor and package version, never switch its upstream identity.
        if (origin.fill !== upstream.id || upstream.author !== "foundry" || upstream.trust !== "foundry" || origin.pin.package !== upstream.pin!.package || stableStringify(held.impl) !== stableStringify(next.impl))
            surfaceFault("S2 foreign refresh upstream");
        const descriptorHash = surfacePackageDescriptorHash(next);
        const history = descriptorHash === origin.descriptorHash ? origin.history : [...(origin.history ?? []), { from: origin.descriptorHash, to: descriptorHash }];
        const refreshed = surfacePackageDocument(copy, next, { ...origin, pin: structuredClone(upstream.pin) as SurfacePackagePin, license: upstream.license, descriptorHash, ...(history === undefined ? {} : { history }) });
        verifySurfacePackageProvenance(catalog, surfaceEntryOf(refreshed) as SurfacePackageEntry & { origin: SurfacePackageOrigin });
        copy.surfaces = canonicalSurfacePortion({ ...copy.surfaces!, fills: copy.surfaces!.fills.map(doc => surfaceEntryOf(doc).slot === operation.slot ? refreshed as unknown as SurfaceDocument : doc) });
        return copy;
    }
    if (current) {
        const target = surfaceEntryOf(current);
        if (isSurfacePackageEntry(target)) verifySurfacePackageProvenance(catalog, target);
        else { verifySurfaceFiles(target, copy.surfaces!.files); verifySurfaceProvenance(catalog, copy, target); }
    }
    let document: SurfaceDocument | undefined;
    let newFiles: readonly SurfaceFile[] = [];
    const pointer = operation.op === "adopt" && !bundles.some(bundle => bundle.operation === "adopt" && bundle.slot === operation.slot) ? packageCandidates(catalog, operation.slot, operation.source) : [];
    if (pointer.length) {
        // Package pointer: no bundle, no bytes; origin is joined to the catalog candidate, as components adopt K8 pins.
        if (pointer.length !== 1 || operation.op !== "adopt")
            surfaceFault("S2 unique package candidate required");
        if (!copy.adoptedAt || !/^\d{4}-\d{2}-\d{2}$/.test(copy.adoptedAt))
            surfaceFault("S2 adoption date required");
        const { doc, fill } = pointer[0]!;
        const meta = doc.$extensions["com.clossys.fill"];
        const entry = fill as SurfacePackageEntry;
        document = surfacePackageDocument(copy, entry, { kind: "package", source: operation.source, fill: meta.id, pin: structuredClone(meta.pin) as SurfacePackagePin, license: meta.license, descriptorHash: surfacePackageDescriptorHash(entry), adoptedAt: copy.adoptedAt }) as unknown as SurfaceDocument;
    }
    else if (operation.op === "adopt" || operation.op === "derive") {
        const matches = bundles.filter(bundle => bundle.operation === operation.op && bundle.slot === operation.slot);
        if (matches.length !== 1)
            surfaceFault("S2 unique bundle required");
        const bundle = runtimeSnapshot(matches[0]!);
        object(bundle, ["version", "operation", "slot", "document", "base", "upstream", "files", "transform", "rule", "inputs", "inputsHash"]);
        choice(bundle.version, [1]);
        base(bundle.base);
        assertSurfaceRule(bundle.transform);
        assertSurfaceInputs(bundle.inputs);
        if (operation.op === "adopt" && bundle.base.source !== operation.source)
            surfaceFault("S2 adoption source differs");
        const sourceFill = surfaceOf(bundle.document);
        if (sourceFill.slot !== operation.slot || !sourceFill.origin || sourceFill.origin.kind !== (operation.op === "adopt" ? "adopted" : "derived"))
            surfaceFault("S2 bundle operation differs");
        const installedOrigin = sourceFill.origin!;
        if (stableStringify(installedOrigin.base) !== stableStringify(bundle.base) || stableStringify(installedOrigin.transform) !== stableStringify(bundle.transform) || installedOrigin.kind === "derived" && (stableStringify(installedOrigin.rule) !== stableStringify(bundle.rule) || stableStringify(installedOrigin.inputs) !== stableStringify(bundle.inputs) || installedOrigin.inputsHash !== bundle.inputsHash))
            surfaceFault("S2 bundle provenance fields differ");
        if (stableStringify(surfaceManifest(bundle.upstream)) !== stableStringify(sortedManifest(bundle.base.upstreamSha256)))
            surfaceFault("S2 upstream bytes differ");
        if (operation.op === "derive") {
            if (!current || isSurfacePackageEntry(surfaceEntryOf(current)) || surfaceOf(current).origin?.kind === "authored")
                surfaceFault("S6 derive requires retained adopted base");
            const rules = catalog.surfaces.rules.filter(rule => rule.identity.id === operation.rule && rule.slot === operation.slot);
            if (rules.length !== 1)
                surfaceFault("S6 unique rule required");
            const rule = rules[0]!;
            assertRegistryIdentity(rule.identity, rule.source);
            if (stableStringify(rule.identity) !== stableStringify(bundle.rule) || stableStringify(rule.base) !== stableStringify(bundle.base) || stableStringify([...operation.inputs].sort((a, b) => stableStringify(a) < stableStringify(b) ? -1 : 1)) !== stableStringify([...rule.inputs].sort((a, b) => stableStringify(a) < stableStringify(b) ? -1 : 1)))
                surfaceFault("S6 rule/input set differs");
            if (operation.inputs.some(input => input.kind === "surface" && input.id === operation.slot))
                surfaceFault("S6 surface cycle");
            if (stableStringify(surfaceInputs(catalog, library, resolved, operation.inputs, options)) !== stableStringify(bundle.inputs))
                surfaceFault("S6 stale inputs");
        }
        else if (bundle.rule !== null || bundle.inputs.length)
            surfaceFault("S2 adoption has derivation inputs");
        if (bundle.inputsHash !== surfaceDerivationHash(bundle.base, bundle.transform, bundle.rule, catalog, operation.slot, bundle.inputs))
            surfaceFault("S6 stale derivation");
        // A package pointer at this leaf is replaced, never retained as the source fill.
        const prior = current ? surfaceEntryOf(current) : undefined;
        document = prior && !isSurfacePackageEntry(prior) && surfaceDescriptorHash(prior) === surfaceDescriptorHash(sourceFill) && stableStringify(prior.origin) === stableStringify(sourceFill.origin) ? current : bundle.document;
        newFiles = bundle.files;
    }
    else if (operation.op === "author") {
        if (!current)
            surfaceFault("S2 author requires existing owned leaf");
        const prior = surfaceOf(current);
        assertSurfaceCandidate(operation.fill);
        if (operation.fill.slot !== operation.slot || operation.fill.source !== copy.source.id || operation.fill.license !== prior.license || stableStringify(operation.fill.pin) !== stableStringify(prior.pin))
            surfaceFault("S2 authored lineage differs");
        const fill = { ...operation.fill, origin: { kind: "authored" as const, license: prior.license, descriptorHash: surfaceDescriptorHash(operation.fill), lineage: prior.origin!.kind === "authored" ? prior.origin!.lineage : prior.origin!.base, ...(operation.note === undefined ? {} : { note: operation.note }) } };
        document = surfaceDocument(copy, fill);
        newFiles = operation.files;
    }
    else if (operation.op !== "remove")
        surfaceFault("S1 unknown operation");
    const fills = (copy.surfaces?.fills ?? []).filter(doc => surfaceEntryOf(doc).slot !== operation.slot);
    const keptPaths = new Set(fills.flatMap(doc => surfaceOutputs(surfaceEntryOf(doc)).map(row => row.path)));
    const files = (copy.surfaces?.files ?? []).filter(file => keptPaths.has(file.path));
    for (const file of newFiles) {
        const prior = files.find(row => row.path === file.path);
        if (prior && prior.content !== file.content)
            surfaceFault("S1 conflicting shared path");
        if (!prior)
            files.push(file);
    }
    if (document && isSurfacePackageEntry(surfaceEntryOf(document))) {
        verifySurfacePackageProvenance(catalog, surfaceEntryOf(document) as SurfacePackageEntry & { origin: SurfacePackageOrigin });
        fills.push(document);
    }
    else if (document) {
        const fill = surfaceOf(document);
        verifySurfaceFiles(fill, newFiles);
        if (newFiles.length !== fill.outputSha256.length)
            surfaceFault("S2 extra bundle files");
        fills.push(document);
    }
    copy.surfaces = canonicalSurfacePortion({ version: 1, fills, files });
    return copy;
}
export function surfaceDocument(library: CompositeLibraryData, fill: SurfaceCandidate & {
    origin: SurfaceOrigin;
}): SurfaceDocument {
    const meta = { id: `${library.source.id}/${fill.slot}`, slot: fill.slot, source: library.source.id, mode: "implementation" as const, sourceAddress: `fills/${fill.slot}.json`, relation: "same-contract" as const, builtOn: [], conforms: [], evidence: [], author: "consumer" as const, trust: "consumer" as const, license: fill.license, status: "draft" as const, originKinds: [fill.origin.kind] };
    return fill.kind === "section" ? { $extensions: { "com.clossys.fill": meta }, sections: { [fill.slot.slice(9)]: fill } } : { $extensions: { "com.clossys.fill": meta }, frames: { [fill.slot.slice(7)]: fill } };
}
export function assertSurfaceResolutionOptions(options: SurfaceResolutionOptions): void {
    const value = runtimeSnapshot(options);
    object(value, ["packages", "measurements"]);
    list(value.packages, row => { object(row, ["module", "version", "artifactSha256", "values", "types"]); string(row.module); string(row.version); hash(row.artifactSha256); strings(row.values); strings(row.types); });
    if (new Set(value.packages.map(row => row.module)).size !== value.packages.length)
        surfaceFault("S4 duplicate package evidence");
    const command = (row: unknown) => { object(row, ["argv", "exitCode", "stdoutSha256", "stderrSha256"]); list(row.argv, string, true); if (typeof row.exitCode !== "number" || !Number.isInteger(row.exitCode))
        surfaceFault("S8 invalid command exit"); hash(row.stdoutSha256); hash(row.stderrSha256); };
    const closure = (row: unknown) => { object(row, ["entry", "files", "dependencies"]); string(row.entry); map(row.files, (text, path) => { surfacePath(path); if (typeof text !== "string")
        surfaceFault("S8 source bytes required"); }); map(row.dependencies, dep => { object(dep, ["version", "artifact"]); string(dep.version); hash(dep.artifact, true); }); };
    const renderer = (row: unknown) => { object(row, ["id", "source", "sourceHash"]); string(row.id); closure(row.source); hash(row.sourceHash, true); };
    list(value.measurements, row => { object(row, ["version", "slot", "scope", "identity", "source", "compiled", "compiler", "command", "checks", "runtime"]); choice(row.version, [1]); choice(row.scope, ["synthetic", "real"]); string(row.slot); object(row.identity, ["version", "descriptorHash", "outputHash", "apiHash", "inputsHash"]); choice(row.identity.version, [1]); [row.identity.descriptorHash, row.identity.outputHash, row.identity.apiHash, row.identity.inputsHash].forEach(value => hash(value, true)); closure(row.source); closure(row.compiled); renderer(row.compiler); command(row.command); object(row.checks, ["types", "closure"]); choice(row.checks.types, ["pass", "fail"]); choice(row.checks.closure, ["pass", "fail"]); if (row.runtime !== null) {
        object(row.runtime, ["renderer", "command", "checks"]);
        renderer(row.runtime.renderer);
        command(row.runtime.command);
        object(row.runtime.checks, ["module"]);
        choice(row.runtime.checks.module, ["pass", "fail"]);
    } });
}
