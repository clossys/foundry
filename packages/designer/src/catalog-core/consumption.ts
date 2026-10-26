/** Static consumption evidence. Descriptor inventories and source observations remain distinct. */
export interface ConsumptionReads { tokens: readonly string[]; assets: readonly string[]; components: readonly string[] }
export interface ConsumptionToken { id: string; contract: { emit?: Readonly<Record<string, string>> } }
export interface ConsumptionBlocker { code: string; value?: string; message: string }
export interface ConsumptionFill {
  id: string; slot: string; source: string; members: readonly string[];
  reads: ConsumptionReads; composes: readonly string[];
  conforms: readonly string[]; evidence: readonly unknown[]; blockers?: readonly ConsumptionBlocker[];
}
export interface ConsumptionSourceScan {
  fill: string;
  /** Selected reachable runtime declarations, with comments removed, never an entire export barrel. */
  files: readonly { path: string; content: string }[];
  components: readonly string[];
}
export interface ConsumptionCoverage {
  slot: string; status: "candidate" | "subset" | "unavailable";
  supported: readonly string[]; missing: readonly string[]; notes: readonly string[];
}
export interface ConsumptionReceipt {
  slot: string; item: string; runtime: string; status: string; reason: string;
  issues: readonly ConsumptionBlocker[];
}
export interface ConsumptionInput {
  tokens: readonly ConsumptionToken[]; assets: readonly { id: string }[]; components: readonly { id: string }[];
  fills: ConsumptionFill[]; sourceScans: ConsumptionSourceScan[];
  themeCss: string; foundryCoverage: readonly ConsumptionCoverage[]; shadcnReceipt: readonly ConsumptionReceipt[];
}
export interface ConsumptionFinding {
  code: "missing-declared-reads" | "source-scan-unavailable" | "unknown-read";
  fill: string; layer?: keyof ConsumptionReads; reads?: readonly string[];
}
const sorted = (values: readonly string[]): string[] => [...new Set(values)].sort();
const empty = (): ConsumptionReads => ({ tokens: [], assets: [], components: [] });
const layers = ["tokens", "assets", "components"] as const;
const union = (a: ConsumptionReads, b: ConsumptionReads): ConsumptionReads => ({ tokens: sorted([...a.tokens, ...b.tokens]), assets: sorted([...a.assets, ...b.assets]), components: sorted([...a.components, ...b.components]) });

/** Theme aliases are followed transitively; self references retain their underlying consumer property. */
export function scanComponentReads(content: string, tokens: readonly ConsumptionToken[], themeCss: string) {
  const memberByProperty = new Map<string, string[]>();
  for (const token of tokens) for (const [member, property] of Object.entries(token.contract.emit ?? {})) {
    memberByProperty.set(property, [...(memberByProperty.get(property) ?? []), `${token.id}.${member}`]);
  }
  const aliases = new Map<string, string[]>();
  const css = themeCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g)) aliases.set(match[1]!, sorted([...match[2]!.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(item => item[1]!)));
  const bindings = new Map<string, string[]>();
  const add = (name: string, property: string) => bindings.set(name, sorted([...(bindings.get(name) ?? []), property]));
  for (const key of aliases.keys()) {
    for (const [namespace, prefixes] of [
      ["color", ["bg", "text", "border", "border-x", "border-y", "border-t", "border-r", "border-b", "border-l", "divide", "ring", "ring-offset", "outline", "fill", "stroke", "decoration", "accent", "caret", "from", "via", "to", "shadow"]],
      ["spacing", ["p", "px", "py", "ps", "pe", "pt", "pr", "pb", "pl", "m", "mx", "my", "ms", "me", "mt", "mr", "mb", "ml", "gap", "gap-x", "gap-y", "space-x", "space-y", "w", "h", "size", "min-w", "min-h", "max-w", "max-h", "inset", "inset-x", "inset-y", "top", "right", "bottom", "left", "translate-x", "translate-y", "basis"]],
      ["text", ["text"]], ["font", ["font"]], ["font-weight", ["font"]],
      ["radius", ["rounded", "rounded-t", "rounded-b", "rounded-l", "rounded-r", "rounded-tl", "rounded-tr", "rounded-bl", "rounded-br"]],
      ["tracking", ["tracking"]], ["leading", ["leading"]], ["ease", ["ease"]], ["blur", ["blur", "backdrop-blur"]], ["shadow", ["shadow"]],
    ] as const) {
      if (key.startsWith(`--${namespace}-`)) for (const prefix of prefixes) add(`${prefix}-${key.slice(namespace.length + 3)}`, key);
    }
  }
  // The caller supplies comment-free selected declarations. These lexical reads are a lower
  // bound: arbitrary dynamic construction and runtime member use cannot be inferred here.
  const properties = new Set<string>();
  const expand = (property: string, seen = new Set<string>()) => {
    if (seen.has(property)) return;
    seen.add(property);
    if (memberByProperty.has(property)) properties.add(property);
    for (const next of aliases.get(property) ?? []) expand(next, seen);
  };
  for (const match of content.matchAll(/--[a-zA-Z][a-zA-Z0-9-]*/g)) {
    // An incomplete template prefix is not an observed concrete member.
    if (!content.slice((match.index ?? 0) + match[0].length).startsWith("${")) expand(match[0]);
  }
  const utilities = new Set<string>();
  for (const match of content.matchAll(/[^\s"'`{};,()]+/g)) {
    const utility = match[0].split(":").at(-1)!.replace(/^!|!$/g, "").split("/")[0]!;
    if (bindings.has(utility)) {
      utilities.add(utility);
      for (const property of bindings.get(utility)!) expand(property);
    }
    if (utility === "transition" || utility.startsWith("transition-")) {
      expand("--default-transition-duration"); expand("--default-transition-timing-function");
    }
  }
  const tokenMembers = sorted([...properties].flatMap(property => memberByProperty.get(property) ?? []));
  return {
    tokens: sorted(tokens.filter(token => tokenMembers.some(member => member.startsWith(`${token.id}.`))).map(token => token.id)),
    assets: sorted([...content.matchAll(/\bassets\.[a-z][a-z0-9-]*/g)].map(match => match[0])),
    tokenMembers, properties: sorted([...properties]), utilities: sorted([...utilities]),
  };
}

export type FoundryComponentIntent = "OFFER" | "OFFER-BUILD" | "ADOPT-ONLY" | "GAP" | "COMPOSED";
/** Section 2 design intent is not a measurement of the available descriptors. */
export function componentCandidateIntent(slot: string) {
  const leaf = slot.replace(/^components\./, "");
  const adopt = ["toggle-button", "menu", "form", "toggle-group", "slider", "calendar", "badge", "keyboard", "skeleton", "avatar", "breadcrumbs", "separator", "tabs", "card", "disclosure", "dialog", "popover"];
  const conditional = ["menu", "badge", "skeleton", "avatar", "breadcrumbs", "separator", "tabs", "card", "disclosure", "dialog", "popover"];
  const build = ["tag-group", "number-field", "tree"];
  const gaps = ["color-picker", "file-trigger", "meter", "navigation-tree"];
  const uv = ["button", "toggle-button", "select", "calendar", "link"];
  const unv = ["menu", "form", "text-field", "checkbox", "radio-group", "switch", "combo-box", "toggle-group", "slider", "table", "badge", "keyboard", "banner", "progress-bar", "spinner", "skeleton", "avatar", "breadcrumbs", "separator", "tabs", "card", "disclosure", "dialog", "popover", "tooltip"];
  const foundry: FoundryComponentIntent = adopt.includes(leaf) ? "ADOPT-ONLY" : build.includes(leaf) ? "OFFER-BUILD" : gaps.includes(leaf) ? "GAP" : leaf === "date-picker" ? "COMPOSED" : "OFFER";
  const shadcn = uv.includes(leaf) ? "U-V" : unv.includes(leaf) ? "U-NV" : ["toast", "resize-handle"].includes(leaf) ? "X" : leaf === "field" ? "K2-fails-as-fetched" : leaf === "navigation-tree" ? "mapping-NV" : "none";
  const single = ["toggle-button", "form", "toggle-group", "slider", "calendar", "keyboard"].includes(leaf) ? "shadcn" : leaf === "date-picker" ? "composed" : ["color-picker", "navigation-tree"].includes(leaf) ? "none" : leaf === "field" ? "foundry-unless-NV-clears" : shadcn === "none" || shadcn === "X" ? "foundry" : "two-candidates";
  return { foundry, conditional: conditional.includes(leaf), baseline: ["file-trigger", "meter"].includes(leaf), shadcn, single };
}

export function buildComponentsConsumption(input: ConsumptionInput) {
  const inventory = { tokens: sorted(input.tokens.map(row => row.id)), assets: sorted(input.assets.map(row => row.id)), components: sorted(input.components.map(row => row.id)) };
  const findings: ConsumptionFinding[] = [];
  const scans = new Map(input.sourceScans.map(scan => [scan.fill, scan]));
  const fills = [...input.fills].sort((a, b) => a.id.localeCompare(b.id)).map(fill => {
    const source = scans.get(fill.id);
    const scanned = scanComponentReads(source?.files.map(file => file.content).join("\n") ?? "", input.tokens, input.themeCss);
    const declaredReads: ConsumptionReads = { tokens: sorted(fill.reads.tokens), assets: sorted(fill.reads.assets), components: sorted([...fill.reads.components, ...fill.composes]) };
    const scannedReads: ConsumptionReads = { tokens: scanned.tokens, assets: scanned.assets, components: sorted(source?.components ?? []) };
    const effectiveReads = union(declaredReads, scannedReads);
    const missingDeclaredReads = empty();
    for (const layer of layers) {
      missingDeclaredReads[layer] = scannedReads[layer].filter(read => !declaredReads[layer].includes(read));
      if (missingDeclaredReads[layer].length) findings.push({ code: "missing-declared-reads", fill: fill.id, layer, reads: missingDeclaredReads[layer] });
      const unknown = effectiveReads[layer].filter(read => !inventory[layer].includes(read));
      if (unknown.length) findings.push({ code: "unknown-read", fill: fill.id, layer, reads: unknown });
    }
    if (!source) findings.push({ code: "source-scan-unavailable", fill: fill.id });
    return {
      id: fill.id, slot: fill.slot, source: fill.source, members: sorted(fill.members),
      declaredReads, scannedReads, effectiveReads, missingDeclaredReads,
      scanStatus: source ? "lower-bound" : "unavailable",
      sourceFiles: sorted(source?.files.map(file => file.path) ?? []),
      scannedTokenMembers: scanned.tokenMembers, scannedProperties: scanned.properties, expandedUtilities: scanned.utilities,
      blockers: [...(fill.blockers ?? [])], conforms: [...fill.conforms], evidence: [...fill.evidence],
    };
  });
  const unread = (kind: "declaredReads" | "scannedReads" | "effectiveReads") => inventory.tokens.filter(token => !fills.some(fill => fill[kind].tokens.includes(token)));
  const reverseComposes = Object.fromEntries(inventory.components.map(slot => [slot, {
    declared: fills.filter(fill => fill.declaredReads.components.includes(slot)).map(fill => fill.id),
    scanned: fills.filter(fill => fill.scannedReads.components.includes(slot)).map(fill => fill.id),
    effective: fills.filter(fill => fill.effectiveReads.components.includes(slot)).map(fill => fill.id),
  }]));
  const candidates = inventory.components.map(slot => {
    const foundry = input.foundryCoverage.find(row => row.slot === slot);
    const shadcn = fills.filter(fill => fill.slot === slot && fill.source === "shadcn@aria");
    const receipts = input.shadcnReceipt.filter(row => row.slot === slot);
    const blockedCount = shadcn.filter(fill => fill.blockers.length).length;
    const blockerCount = shadcn.reduce((count, fill) => count + fill.blockers.length, 0);
    return { slot, intent: componentCandidateIntent(slot), foundry: foundry ?? { status: "unavailable", supported: [], missing: [], notes: ["No coverage inventory row."] },
      shadcn: { status: shadcn.length ? blockedCount ? "blocked" : "descriptor-only" : receipts.some(row => row.status === "rejected") ? "rejected" : receipts.length ? "no-fill" : "unavailable",
        descriptorCount: shadcn.length, blockedCount, blockerCount, items: receipts.map(row => ({ item: row.item, runtime: row.runtime, status: row.status, reason: row.reason, issueCount: row.issues.length })) },
    };
  });
  const shadcn = fills.filter(fill => fill.source === "shadcn@aria");
  return {
    schemaVersion: 1,
    scope: "Static descriptor and reachable-source consumption; no consumer runtime is inspected.",
    inventory,
    historicalInventory: { tokenProperties: 217, meaning: "Historical CSS property inventory; not the token leaf count." },
    claims: { runtimeAccessibility: "unmeasured", consumerAdoption: "unmeasured", descriptorConformance: "unmeasured", reportFreshness: "Reproducibility and signed leaf inventory only; not a component conformance clearance." },
    scanMethod: { reads: "Literal properties, glyph IDs, theme.css utility bindings and reachable local runtime declarations; lower bound only.", composition: "Reachable named package exports and declared source rebinds are recorded separately.", limitations: ["Dynamic property or glyph construction and runtime member use are not inferred.", "Unread means absent from this descriptor or static scan inventory, not proof of no runtime use.", "Contract member support is declared coverage, not observed consumer requirements.", "Source-distributed scans inspect pinned rewritten output; blocked output is not adopted code."] },
    summary: {
      foundry: { descriptors: fills.filter(fill => fill.source === "foundry").length, candidate: input.foundryCoverage.filter(row => row.status === "candidate").length, subset: input.foundryCoverage.filter(row => row.status === "subset").length, unavailable: input.foundryCoverage.filter(row => row.status === "unavailable").length },
      shadcn: { descriptors: shadcn.length, blocked: shadcn.filter(fill => fill.blockers.length).length, unblocked: shadcn.filter(fill => !fill.blockers.length).length, blockers: shadcn.reduce((count, fill) => count + fill.blockers.length, 0) },
      missingDeclaredReadFindings: findings.filter(row => row.code === "missing-declared-reads").length,
    },
    fills, findings, unreadTokenLeaves: { declared: unread("declaredReads"), scanned: unread("scannedReads"), effective: unread("effectiveReads") }, reverseComposes, candidates,
  };
}

/** Surface contracts are authored once per slot, never per rendered element. */
export interface SurfaceReadContract { id: string; allowedReads: Partial<ConsumptionReads>; allowedComposes?: readonly string[] }
export function scanSurfaceReads(files: readonly { path: string; content: string }[], slot: SurfaceReadContract, tokens: readonly ConsumptionToken[], themeCss: string) {
  return files.map(file => {
    const scanned = scanComponentReads(file.content, tokens, themeCss);
    const missing = scanned.tokens.filter(id => !(slot.allowedReads.tokens ?? []).includes(id));
    const unknown = [...file.content.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map(match => match[1]!).filter(property => !scanned.properties.includes(property));
    return { file: file.path, slot: slot.id, ...scanned, findings: [
      ...(missing.length ? [{ code: "missing-declared-reads", reads: missing }] : []),
      ...(unknown.length ? [{ code: "unknown-read", reads: sorted(unknown) }] : []),
      ...scanned.assets.filter(id => !(slot.allowedReads.assets ?? []).includes(id)).map(id => ({ code: "missing-declared-reads", reads: [id] })),
    ] };
  });
}
