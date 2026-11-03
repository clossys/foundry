/**
 * Checks for the Designer slot contracts (`clossys.slot-contract/1`) in
 * catalog/slot-contracts/<layer>.json, one file per layer (themes, assets, components,
 * sections, frames). Every canonical slot in the layer's catalog must have exactly one
 * record. Every reference must name a pinned folder under references/ whose manifest row
 * carries the same version and hash, and every input must be something the slot's own
 * catalog contract declares.
 *
 * The record schema itself lives in @clossys/producer (which depends on this
 * package); this check covers what only Designer can know: the slot catalog and
 * the references folder.
 */
export type SlotContractLayer = "themes" | "assets" | "components" | "sections" | "frames";
export type SpecimenKind = "visual" | "text" | "data" | "media" | "flow";
export type SlotContractInput = { readonly name: string; readonly kind: "copy" | "prop" | "asset" | "theme" | "data" | "cell"; readonly required: boolean; readonly description?: string };
export type SlotContractReference = { readonly registry: string; readonly item: string; readonly version: string; readonly hash?: string; readonly url?: string };
export type SlotContractRecord = {
    readonly schema: "clossys.slot-contract/1";
    readonly slot: string;
    readonly package: string;
    readonly layer: string;
    readonly purpose: string;
    readonly inputs: readonly SlotContractInput[];
    readonly limits: Readonly<Record<string, number | string | boolean>>;
    readonly references: readonly SlotContractReference[];
    readonly checkSuite: string;
    readonly specimenKind: SpecimenKind;
};
type CatalogSlot = {
    readonly id: string;
    readonly contract: {
        readonly $type?: string;
        readonly members?: { readonly mode?: string; readonly names?: readonly string[] };
        readonly props?: readonly string[];
        readonly allowedReads?: { readonly themes?: readonly string[]; readonly assets?: readonly string[] };
        readonly copy?: { readonly fields?: readonly { readonly key: string }[] };
        readonly slots?: readonly { readonly name?: string; readonly id?: string }[];
    };
};
type ManifestItem = { readonly registry: string; readonly name: string; readonly version: string; readonly dir: string; readonly hash: string };
export interface SlotContractContext {
    readonly layer: SlotContractLayer;
    /** The layer's canonical catalog (src/catalog/slots/<layer>.json); every slot needs a record. */
    readonly slots: readonly CatalogSlot[];
    readonly manifest: { readonly items: readonly ManifestItem[] };
    /** Whether `references/<dir>` exists, for a manifest-relative dir such as `shadcn/sonner@4.23.0`. */
    readonly folderExists: (dir: string) => boolean;
}
const KINDS = new Set(["copy", "prop", "asset", "theme", "data", "cell"]);
/** Theme specimens follow the token type: colors, shadows and dimensions are seen, fonts are read, motion plays. */
const THEME_SPECIMEN: Readonly<Record<string, SpecimenKind>> = { color: "visual", shadow: "visual", dimension: "visual", fontFamily: "text", number: "text", duration: "flow" };

/** The specimen a slot's record must declare: per layer, and per token type for themes. */
export function specimenKindFor(layer: SlotContractLayer, slot: CatalogSlot): SpecimenKind | undefined {
    if (layer === "themes") return THEME_SPECIMEN[slot.contract.$type ?? ""];
    return layer === "assets" ? "media" : "visual";
}

/** Member axes of a slot: `variant.primary` gives `variant`; a member without a dot is its own axis. */
export function memberAxes(slot: CatalogSlot): string[] {
    return [...new Set((slot.contract.members?.names ?? []).map(name => name.split(".")[0]!))];
}

/** Every finding for one layer's contracts; an empty list means the layer is clean and complete. */
export function slotContractFindings(contracts: readonly SlotContractRecord[], context: SlotContractContext): string[] {
    const findings: string[] = [];
    const slots = new Map(context.slots.map(slot => [slot.id, slot]));
    const seen = new Set<string>();
    for (const contract of contracts) {
        const at = contract.slot;
        const fail = (message: string) => findings.push(`${at}: ${message}`);
        if (contract.schema !== "clossys.slot-contract/1") fail("schema must be clossys.slot-contract/1");
        if (contract.layer !== context.layer || !contract.slot.startsWith(`${context.layer}.`)) fail(`slot must be in layer ${context.layer}`);
        if (seen.has(contract.slot)) fail("duplicate contract");
        seen.add(contract.slot);
        if (contract.package !== "designer") fail("package must be designer");
        if (!contract.purpose?.trim()) fail("purpose required");
        if (!contract.checkSuite?.trim()) fail("checkSuite required");
        const slot = slots.get(contract.slot);
        if (!slot) { fail("slot is not in the catalog"); continue; }
        const specimen = specimenKindFor(context.layer, slot);
        if (contract.specimenKind !== specimen) fail(`specimenKind must be ${specimen ?? "a known kind"}`);
        const copy = new Set((slot.contract.copy?.fields ?? []).map(field => field.key));
        const themes = new Set(slot.contract.allowedReads?.themes ?? []);
        const assets = new Set(slot.contract.allowedReads?.assets ?? []);
        const cells = new Set((slot.contract.slots ?? []).map(port => port.name ?? port.id));
        const props = new Set([...(slot.contract.props ?? []), ...memberAxes(slot)]);
        const ownMembers = context.layer === "themes" || context.layer === "assets";
        const values = new Set(slot.contract.members?.mode === "open" ? ["entries"] : slot.contract.members?.names ?? []);
        const names = new Set<string>();
        if (!contract.inputs.length) fail("inputs required");
        for (const input of contract.inputs) {
            const key = `${input.kind}:${input.name}`;
            if (names.has(key)) fail(`duplicate input ${key}`);
            names.add(key);
            if (!KINDS.has(input.kind)) fail(`unknown input kind ${input.kind}`);
            if (input.kind === "copy" && !copy.has(input.name)) fail(`copy key ${input.name} is not declared by the slot`);
            if (input.kind === "theme" && !themes.has(input.name)) fail(`theme read ${input.name} is not allowed by the slot`);
            if (input.kind === "asset" && !assets.has(input.name)) fail(`asset read ${input.name} is not allowed by the slot`);
            if (input.kind === "cell" && !cells.has(input.name)) fail(`cell ${input.name} is not a slot region`);
            if (input.kind === "prop" && !props.has(input.name)) fail(`prop ${input.name} is not a slot prop or member axis`);
            if (input.kind === "data" && ownMembers && !values.has(input.name)) fail(`data ${input.name} is not a slot member`);
        }
        for (const reference of contract.references) {
            const dir = `${reference.registry}/${reference.item}@${reference.version}`;
            if (!context.folderExists(dir)) { fail(`missing reference folder references/${dir}`); continue; }
            const row = context.manifest.items.find(item => item.dir === dir);
            if (!row || row.registry !== reference.registry || row.name !== reference.item || row.version !== reference.version) { fail(`reference ${dir} is not in references/manifest.json`); continue; }
            if (reference.hash !== undefined && reference.hash !== row.hash) fail(`reference ${dir} hash differs from references/manifest.json`);
        }
    }
    for (const slot of context.slots) if (!seen.has(slot.id)) findings.push(`${slot.id}: canonical slot has no contract record`);
    return findings;
}
