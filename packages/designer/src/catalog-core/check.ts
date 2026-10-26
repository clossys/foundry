import { TOKENS } from "../tokens/tokens.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";
import { resolveTokenValue } from "../tokens/internal/resolve-token-value.js";
import type { TokenDefinition } from "../tokens/tokens.js";
import { contrastRatio } from "../tokens/color.js";
import { parseFill } from "./cell.js";
import { idFinding, isValidId, LAYERS } from "./ids.js";
import { aliasOf, assetReferences, compare, flatten, leafOf, malformed, metaOf, modeValue, references, relativeOf, unsafeText } from "./model.js";
import { resolveForCheck, type EngineInput } from "./resolve.js";
import { createDerivationInputsHasher, generateSelection, originOf, tokenContent } from "./library.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { registeredRule, matchesRuleInputs } from "./rules.js";
import { checkAssetProfileWithContext } from "../catalog-assets/check.js";
import { checkIdentityDerivationsWithContext } from "../catalog-assets/identity.js";
import type { CheckResult } from "./api.js";
import type { CheckCode, DtcgToken, FillDoc, Finding, Resolved, Slot } from "./types.js";

const LICENSES = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1", "CC0-1.0"]);
export function check(input: EngineInput & { resolved?: Resolved; fileExists?: (path: string) => boolean }): CheckResult {
  const { resolved: fresh, chosen, fills, flattened } = resolveForCheck(input);
  const tokensOf = (fill: FillDoc): Record<string, DtcgToken> => {
    let tokens = flattened.get(fill);
    if (!tokens) { tokens = flatten(fill); flattened.set(fill, tokens); }
    return tokens;
  };
  const referenceCache = new Map<DtcgToken, string[]>();
  const readsOf = (token: DtcgToken): string[] => {
    let reads = referenceCache.get(token);
    if (!reads) { reads = references(token); referenceCache.set(token, reads); }
    return reads;
  };
  const hashInputs = createDerivationInputsHasher(() => fresh);
  const candidates = new Map<string, FillDoc | undefined>();
  const candidateFor = (id: string, source: string): FillDoc | undefined => {
    const key = JSON.stringify([id, source]);
    if (!candidates.has(key)) candidates.set(key, input.catalog.fills.find(fill => metaOf(fill).id === id && metaOf(fill).source === source));
    return candidates.get(key);
  };
  const originSources = new Map<string, (typeof input.catalog.sources)[number] | undefined>();
  const originSourceFor = (id: string) => {
    if (!originSources.has(id)) originSources.set(id, input.catalog.sources.find(source => source.id === id));
    return originSources.get(id);
  };
  const filledSlots = new Set(fills.filter(fill => metaOf(fill).mode !== "reference").map(fill => metaOf(fill).slot));
  const membersByLeaf = new Map<string, string[]>();
  for (const id of Object.keys(chosen)) { const leaf = leafOf(id); const members = membersByLeaf.get(leaf) ?? []; members.push(id); membersByLeaf.set(leaf, members); }
  const preciseLeavesByFill = new Map<FillDoc, Set<string>>();
  const findings: Finding[] = [...fresh.notices];
  const add = (code: CheckCode, rule: string, subject: string, message: string, severity: Finding["severity"] = "error"): void => { findings.push({ code, rule, subject, severity, message }); };
  const slots = new Map(input.catalog.slots.map(slot => [slot.id, slot]));
  const sources = new Map([input.library.source].map(source => [source.id, source]));
  const clauses = new Set(input.catalog.standards.flatMap(standard => standard.clauses.map(clause => `${standard.id}#${clause.id}`)));
  const bound = new Map<string, string[]>(); const shipped = new Map(Object.values(TOKENS).map(token => [token.property, token]));
  const rank = (slot: Slot): string => slot.contract.kind === "token" ? slot.contract.tier === "scale" ? "0.0" : "0.1" : String(LAYERS.indexOf(slot.layer));
  const status = (subject: string, data: { status: string; signoff?: { by: string; date: string; ref: string } }): void => {
    if (data.status === "stable" && (!data.signoff || data.signoff.by !== "owner" || !/^\d{4}-\d{2}-\d{2}$/.test(data.signoff.date) || typeof data.signoff.ref !== "string" || !data.signoff.ref.trim())) add("C8", "status", subject, `status: ${subject} is stable without an owner sign-off`);
  };
  for (const slot of input.catalog.slots) {
    if (!isValidId("slot", slot.id)) findings.push(idFinding("slot", slot.id, slot.id));
    status(slot.id, slot);
    if (slot.contract.kind === "asset" && slot.contract.optional?.some(name => slot.contract.members.mode !== "closed" || !slot.contract.members.names.includes(name))) add("C1", "contract", slot.id, `contract: ${slot.id} optional members must be declared closed members`);
    for (const clause of slot.requires) if (!clauses.has(clause)) add("C3", "standards", slot.id, `standards: unknown clause ${clause} in ${slot.id}`);
    const hasFill = filledSlots.has(slot.id);
    if (slot.contract.kind === "token") for (const [relative, css] of Object.entries(slot.contract.emit ?? {})) {
      const id = `${slot.id}.${relative}`; bound.set(css, [...(bound.get(css) ?? []), id]);
      if (!shipped.has(css)) add("C4", "binding", css, `binding: ${css} is not a shipped token`);
      if (!fresh.members[id] && (input.library.complete || hasFill)) add("C4", "coverage", id, `coverage: ${id} (emits ${css}) has no value in profile ${input.library.source.id}`);
    }
    if (!hasFill) add("C4", "coverage", slot.id, `coverage: slot ${slot.id} has no consumer fill`, input.library.complete ? "error" : "notice");
    const requiredMembers = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
    for (const relative of requiredMembers) {
      if (slot.contract.kind === "asset" && slot.contract.optional?.includes(relative)) continue;
      if (slot.contract.kind === "token" && slot.contract.emit?.[relative]) continue;
      const member = `${slot.id}.${relative}`;
      if (!fresh.members[member] && (input.library.complete || hasFill)) add("C4", "coverage", member, `coverage: ${member} has no value in profile ${input.library.source.id}`);
    }
  }
  for (const [css, members] of bound) if (members.length > 1) {
    const ordered = members.sort(compare); add("C4", "binding", css, `binding: ${css} is bound to ${ordered[0]} and ${ordered[1]}`);
  }
  for (const token of Object.values(TOKENS)) if (!bound.has(token.property)) add("C4", "binding", token.property, `binding: shipped token ${token.property} is not bound`);
  const grouped = new Map<string, number>();
  for (const fill of fills) {
    const meta = metaOf(fill); const slot = slots.get(meta.slot); const source = sources.get(meta.source); const tokens = tokensOf(fill);
    findings.push(...parseFill(fill).findings);
    const key = `${meta.source}/${meta.slot}`; grouped.set(key, (grouped.get(key) ?? 0) + 1);
    status(meta.id, meta);
    if (meta.source !== input.library.source.id) add("C7", "selection", meta.id, `selection: consumer fill ${meta.id} names source ${meta.source}, expected ${input.library.source.id}`);
    if (meta.mode !== "implementation") add("C7", "selection", meta.id, `selection: consumer fill ${meta.id} has mode ${meta.mode}, expected implementation`);
    if (!slot) { add("C4", "orphan", meta.id, `orphan: ${meta.id} names slot ${meta.slot}, which is not registered`); continue; }
    for (const clause of slot.requires) if (!meta.conforms.includes(clause)) add("C3", "standards", meta.id, `standards: slot ${slot.id} requires ${clause}; ${meta.id} does not claim it`);
    for (const clause of meta.conforms) {
      if (!clauses.has(clause)) add("C3", "standards", meta.id, `standards: unknown clause ${clause} in ${meta.id}`);
      if (!meta.evidence.some(evidence => evidence.clause === clause)) add("C3", "standards", meta.id, `standards: ${meta.id} claims ${clause} with no evidence`);
    }
    for (const evidence of meta.evidence) {
      if (!clauses.has(evidence.clause)) add("C3", "standards", meta.id, `standards: unknown clause ${evidence.clause} in ${meta.id}`);
      if ("path" in evidence && input.fileExists && !input.fileExists(evidence.path)) add("C3", "standards", meta.id, `standards: ${meta.id} evidence for ${evidence.clause} not found at ${evidence.path}`);
    }
    if (!input.fileExists && meta.evidence.some(evidence => "path" in evidence)) add("C3", "standards", meta.id, `standards: ${meta.id} evidence paths not verified in this environment`, "notice");
    if (source?.kind === "external") {
      if (!source.pin || Object.keys(source.pin).length === 0) add("C6", "pin", source.id, `pin: external source ${source.id} has no pin`);
      for (const [field, want] of Object.entries(source.pin ?? {})) {
        const got = meta.pin?.[field as keyof NonNullable<typeof meta.pin>];
        if (got !== want) add("C6", "pin", meta.id, `pin: ${meta.id} pin ${field}=${got} differs from source ${source.id} (${want})`);
      }
      if (!LICENSES.has(meta.license)) add("C6", "licence", meta.id, `licence: ${meta.id} licence ${meta.license} is not on the allow list`);
    }
    if (source?.kind === "external" && meta.license !== source.license) add("C6", "licence", meta.id, `licence: ${meta.id} licence ${meta.license} differs from source ${source.id} licence ${source.license}`);
    const originKinds = [...new Set(Object.values(tokens).map(originOf).filter(Boolean).map(origin => origin!.kind))].sort(compare);
    if (stableStringify(meta.originKinds ?? []) !== stableStringify(originKinds)) add("C10", "provenance", meta.id, `provenance: ${meta.id} originKinds does not summarize its members`);
    if (slot.contract.kind === "asset" && (!meta.reads || !Array.isArray(meta.reads.tokens) || !Array.isArray(meta.reads.assets))) add("C2", "reads", meta.id, `reads: ${meta.id} must declare token and asset leaf reads`);
    for (const [member, token] of Object.entries(tokens)) {
      const relative = relativeOf(member);
      const origin = originOf(token);
      const valid = origin && (
        origin.kind === "adopted" ? isValidId("source",origin.source) && isValidId("fill",origin.fill) && isValidId("member",origin.member) && typeof origin.license === "string" && /^[a-f0-9]{64}$/.test(origin.sha256) && /^\d{4}-\d{2}-\d{2}$/.test(origin.adoptedAt) && (origin.aliasOf === undefined || isValidId("member",origin.aliasOf)) :
        origin.kind === "authored" ? typeof origin.license === "string" && (origin.note === undefined || typeof origin.note === "string") :
        origin.kind === "derived" ? typeof origin.rule === "string" && Array.isArray(origin.inputs) && origin.inputs.every(input => typeof input === "string" && isValidId("member",input)) && /^[a-f0-9]{64}$/.test(origin.inputsHash) :
        origin.kind === "composed" ? Array.isArray(origin.reads) && origin.reads.every(read => typeof read === "string" && isValidId("slot",read)) : false);
      if (!valid) add("C10", "provenance", member, `provenance: ${member} has invalid origin`);
      else if (origin.kind === "adopted") {
        const materializedHash = token.$extensions?.["com.clossys.materializedSha256"];
        const validMaterialization = !!origin.aliasOf && typeof materializedHash === "string" && /^[a-f0-9]{64}$/.test(materializedHash) && materializedHash !== origin.sha256;
        if (origin.aliasOf !== undefined && !validMaterialization || materializedHash !== undefined && !validMaterialization) add("C10", "provenance", member, `provenance: ${member} has inconsistent alias materialization metadata`);
        const ownHash = validMaterialization ? materializedHash : origin.sha256;
        if (sha256(stableStringify(tokenContent(token))) !== ownHash) add("C10", "provenance", member, `provenance: ${member} adopted content differs from its recorded sha256; re-kind as authored`);
        const candidate = candidateFor(origin.fill, origin.source);
        const upstream = candidate && tokensOf(candidate)[origin.member];
        const originSource = originSourceFor(origin.source);
        // A source may pin a roster while each fill pins its own file. Compare
        // only common release coordinates, or content hashes of the same file.
        const sourcePin = originSource?.pin;
        const sourcePinDrift = originSource?.kind === "external" && !!sourcePin && (
          (["package", "version", "url", "commit"] as const).some(field => sourcePin[field] !== undefined && origin.pin?.[field] !== undefined && sourcePin[field] !== origin.pin[field]) ||
          sourcePin.file === origin.pin?.file && sourcePin.sha256 !== undefined && sourcePin.sha256 !== origin.pin?.sha256
        );
        if (originSource?.kind === "external") {
          if (!origin.pin || Object.keys(origin.pin).length === 0 || Object.values(origin.pin).some(value => typeof value !== "string" || !value.trim())) add("C6", "pin", member, `pin: ${member} adopted external source ${origin.source} has no valid pinned receipt`);
          if (stableStringify(origin.pin ?? null) === stableStringify(originSource.pin ?? null) && origin.license !== originSource.license) add("C6", "licence", member, `licence: ${member} origin licence ${origin.license} differs from source ${origin.source} licence ${originSource.license}`);
          if (candidate && stableStringify(origin.pin ?? null) === stableStringify(metaOf(candidate).pin ?? null) && origin.license !== metaOf(candidate).license) add("C6", "licence", member, `licence: ${member} origin licence ${origin.license} differs from pinned fill ${origin.fill} licence ${metaOf(candidate).license}`);
        }
        if (validMaterialization && upstream && sha256(stableStringify(tokenContent(upstream))) === origin.sha256 && !readsOf(upstream).includes(origin.aliasOf!)) add("C10", "provenance", member, `provenance: ${member} aliasOf is not an upstream read`);
        if (!upstream || sha256(stableStringify(tokenContent(upstream))) !== origin.sha256 || candidate && stableStringify(metaOf(candidate).pin ?? null) !== stableStringify(origin.pin ?? null) || sourcePinDrift) add("C10", "provenance", member, `provenance: ${member} has upstream drift from source ${origin.source} (${origin.fill})`, "notice");
        if (!LICENSES.has(origin.license)) add("C6", "licence", member, `licence: ${member} origin licence ${origin.license} is not on the allow list`);
      } else if (origin.kind === "authored") {
        if (origin.license !== "UNLICENSED" && !LICENSES.has(origin.license)) add("C6", "licence", member, `licence: ${member} origin licence ${origin.license} is not on the allow list`);
      } else if (origin.kind === "derived") {
        if (!input.catalog.rules?.some(rule => rule.id === origin.rule && rule.slot === slot?.id)) add("C10", "provenance", member, `provenance: ${member} uses unknown rule ${origin.rule}`);
        else {
          try { const rule=registeredRule(input.catalog,origin.rule,slot!.id); if(!matchesRuleInputs(rule,origin.inputs)) add("C10", "provenance", member, `provenance: ${member} differs from declared inputs for ${origin.rule}`); }
          catch(error) { add("C10", "provenance", member, `provenance: ${member} ${String(error)}`); }
        }
        try { if (hashInputs(origin.inputs) !== origin.inputsHash) add("C10", "provenance", member, `provenance: ${member} has stale inputsHash for ${origin.rule}; re-derive explicitly`); }
        catch { add("C10", "provenance", member, `provenance: ${member} has unresolved inputs for ${origin.rule}`); }
      }

      if (typeof token.$type !== "string") continue;
      for (const ref of readsOf(token)) if (!isValidId("member", ref)) findings.push(idFinding("member", ref, meta.id));
      const want = slot.contract.kind === "token" ? slot.contract.memberTypes?.[relative] ?? slot.contract.$type : slot.contract.memberKinds?.[relative] ?? slot.contract.valueKind;
      if (token.$type !== want) add("C1", "contract", meta.id, `contract: ${meta.id} member ${member} has $type ${token.$type}, slot ${slot.id} requires ${want}`);
      const members = slot.contract.members;
      if (members.mode === "closed" && !members.names.includes(relative)) add("C1", "contract", meta.id, `contract: ${meta.id} provides unknown member ${member} (slot ${slot.id} is closed)`);
      if (members.mode === "open") {
        let matches = false; try { matches = new RegExp(members.pattern).test(relative); } catch { /* Invalid contract patterns never accept values. */ }
        if (!matches) add("C1", "contract", meta.id, `contract: ${meta.id} member ${member} does not match pattern ${members.pattern}`);
      }
      const dark = token.$extensions?.["com.clossys.modes"]?.dark;
      if (dark !== undefined && !(slot.contract.modes as readonly string[]).includes("dark")) add("C1", "contract", meta.id, `contract: ${meta.id} sets mode dark but slot ${slot.id} allows only light`);
      for (const mode of dark === undefined ? ["light"] as const : ["light", "dark"] as const) {
        const value = modeValue(token, mode); const raw = token.$extensions?.["com.clossys.css"]?.raw;
        const templated = false;
        if (assetReferences(value).length > 0) add("C10", "provenance", member, `provenance: ${member} contains an unmaterialized template`);
        if (!templated && malformed(token.$type, value, raw)) add("C1", "contract", meta.id, `contract: ${meta.id} member ${member} has a malformed ${token.$type} value`);
        if (slot.contract.kind === "token" && !aliasOf(value)) {
          const strings = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v !== null && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
          const unsafe = [typeof value === "string" && mode === "dark" ? value : raw ?? "", ...strings(value)].map(unsafeText).find(Boolean);
          if (unsafe) add("C1", "contract", meta.id, `contract: ${meta.id} member ${member} has unsafe CSS text (${unsafe})`);
        }
      }
      const font = token.$extensions?.["com.clossys.font"];
      if (font?.kind === "fontsource" && !LICENSES.has(font.license)) add("C6", "licence", meta.id, `licence: ${meta.id} licence ${font.license} is not on the allow list`);
      if (slot.contract.kind === "asset") for (const ref of readsOf(token)) {
        const layer = leafOf(ref).split(".")[0]; const declared = layer === "tokens" ? meta.reads?.tokens : meta.reads?.assets;
        if (!declared?.includes(leafOf(ref))) add("C2", "reads", member, `reads: ${member} in ${meta.id} reads undeclared leaf ${leafOf(ref)}`);
      }
    }
  }
  for (const source of sources.values()) {
    if (!isValidId("source", source.id)) findings.push(idFinding("source", source.id, source.id));
    if (source.kind === "external" && !LICENSES.has(source.license)) add("C6", "licence", source.id, `licence: ${source.id} licence ${source.license} is not on the allow list`);
    if (source.kind === "external" && (!source.pin || Object.keys(source.pin).length === 0)) add("C6", "pin", source.id, `pin: external source ${source.id} has no pin`);
  }
  for (const [key, count] of grouped) if (count > 1) { const [source, slot] = key.split("/"); add("C5", "uniqueness", key, `uniqueness: source ${source} has ${count} fills for slot ${slot}`); }
  if (input.library.selection && stableStringify(input.library.selection) !== stableStringify(generateSelection(input.library))) add("C10", "provenance", input.library.source.id, "provenance: generated selection differs from consumer fills and rationale");
  const graph = new Map<string, string[]>();
  for (const [member, entry] of Object.entries(chosen)) {
    const targets = new Set(readsOf(entry.token)); const meta = metaOf(entry.fill);
    const origin = originOf(entry.token);
    const composedReads = origin?.kind === "composed" && Array.isArray(origin.reads) ? origin.reads.filter((read): read is string => typeof read === "string") : [];
    let preciseLeaves = preciseLeavesByFill.get(entry.fill);
    if (!preciseLeaves) { preciseLeaves = new Set(Object.values(tokensOf(entry.fill)).flatMap(token => readsOf(token).map(leafOf))); preciseLeavesByFill.set(entry.fill, preciseLeaves); }
    for (const leaf of [...(meta.reads?.tokens ?? []), ...(meta.reads?.assets ?? []), ...composedReads]) {
      const targetSlot = slots.get(leaf);
      if (!targetSlot || !membersByLeaf.has(leaf)) add("C2", "reads", member, `reads: ${member} in ${meta.id} reads ${leaf}, which does not resolve in profile ${input.library.source.id}`);
      else {
        if (Number(rank(entry.slot)) < Number(rank(targetSlot))) add("C2", "reads", member, `reads: ${member} in ${meta.id} reads upward to ${leaf} (${rank(entry.slot)} may not read ${rank(targetSlot)})`);
        // Fill reads are a summary. Explicit member inputs retain the finer graph,
        // including a derived variant reading its authored seed in the same leaf.
        if (composedReads.includes(leaf) || !preciseLeaves.has(leaf)) membersByLeaf.get(leaf)!.forEach(id => targets.add(id));
      }
    }
    for (const target of readsOf(entry.token)) {
      const targetSlot = slots.get(leafOf(target));
      if (!fresh.members[target]) add("C2", "reads", member, `reads: ${member} in ${meta.id} reads ${target}, which does not resolve in profile ${input.library.source.id}`);
      if (targetSlot && Number(rank(entry.slot)) < Number(rank(targetSlot))) add("C2", "reads", member, `reads: ${member} in ${meta.id} reads upward to ${target} (${rank(entry.slot)} may not read ${rank(targetSlot)})`);
    }
    graph.set(member, [...targets].sort(compare));
    for (const mode of ["light", "dark"] as const) {
      let cursor: string | undefined = member; let hops = 0; const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor); const token: import("./types.js").DtcgToken | undefined = chosen[cursor]?.token; cursor = token ? aliasOf(modeValue(token, mode)) : undefined;
        if (cursor && ++hops > 16) { add("C2", "reads", member, `reads: ${member} alias chain exceeds 16 hops`); break; }
      }
    }
  }
  const cycles = new Set<string>(); const completed = new Set<string>();
  const walk = (id: string, stack: string[]): void => {
    const at = stack.indexOf(id);
    if (at >= 0) {
      const cycle = stack.slice(at); const smallest = [...cycle].sort(compare)[0]!; const pivot = cycle.indexOf(smallest);
      cycles.add([...cycle.slice(pivot), ...cycle.slice(0, pivot), smallest].join(" -> ")); return;
    }
    if (completed.has(id)) return;
    for (const target of graph.get(id) ?? []) walk(target, [...stack, id]);
    completed.add(id);
  };
  for (const id of [...graph.keys()].sort(compare)) walk(id, []);
  for (const cycle of cycles) add("C2", "reads", cycle.split(" -> ")[0]!, `reads: cycle ${cycle}`);
  if (input.resolved) for (const id of new Set([...Object.keys(fresh.members), ...Object.keys(input.resolved.members)])) if (stableStringify(fresh.members[id] ?? null) !== stableStringify(input.resolved.members[id] ?? null)) add("C5", "uniqueness", id, `uniqueness: resolved member ${id} does not match a single implementation`);
  const byCss = new Map<string, import("./types.js").ResolvedMember>(Object.values(fresh.members).filter(m => m.emit).map(m => [m.emit!, m]));
  for (const [id, member] of Object.entries(fresh.members)) if (member.emit && shipped.get(member.emit)?.brandable === false && input.library.baseline?.[member.emit] && input.library.baseline[member.emit]!.light !== member.css.light) add("C3", "standards", id, `standards: ${id} overrides fixed Foundry scale ${member.emit}; emitted to scales.css`, "notice");
  const contrastRegistries = new Map<string, Record<string, TokenDefinition>>();
  for (const pair of CONTRAST_PAIRS) for (const mode of ["light", "dark"] as const) {
    const fg = byCss.get(pair.foreground); const bg = byCss.get(pair.background);
    if (!fg || !bg) continue;
    let registry = contrastRegistries.get(mode);
    if (!registry) { registry = Object.fromEntries([...byCss].map(([css, member]) => [css, { ...(TOKENS[css] ?? { property: css, family: "surface", brandable: false, themeDependent: false }), value: member.css[mode] ?? member.css.light } as TokenDefinition])); contrastRegistries.set(mode, registry); }
    const text = (css: string): string | undefined => resolveTokenValue(css, registry).value;
    try {
      const composite = pair.compositeOver ? pair.compositeOver.startsWith("--") ? text(pair.compositeOver) : pair.compositeOver : undefined;
      const foreground = text(pair.foreground); const background = text(pair.background);
      if (!foreground || !background) throw new Error("unresolved color");
      const ratio = contrastRatio(foreground, background, composite);
      if (ratio < pair.minimumRatio) add("C9", "contrast", pair.foreground, `contrast: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1 in ${mode}, needs ${pair.minimumRatio}:1`);
    } catch {
      add("C9", "contrast", pair.foreground, `contrast: ${pair.foreground} on ${pair.background} cannot be measured in ${mode}`);
    }
  }
  if (input.catalog.slots.some(slot => slot.layer === "assets" && slot.contract.kind === "asset") && (input.library.complete || fills.some(fill => !!fill.assets))) {
    for (const finding of checkAssetProfileWithContext(input.catalog, input.library, { resolved: fresh }, () => checkIdentityDerivationsWithContext(input.library, () => fresh, hashInputs, tokensOf))) {
      if (finding.verdict === "satisfied") continue;
      if (finding.verdict === "exempt") {
        findings.push({ code: finding.code, rule: "asset", subject: finding.subject, severity: finding.code === "A5" ? "notice" : "error", message: finding.code === "A5" ? finding.message : "Invalid asset exemption: only A5 contrast can be exempt" });
        continue;
      }
      findings.push({ code: finding.code, rule: "asset", subject: finding.subject, severity: finding.verdict === "violated" ? "error" : "notice", message: finding.message });
    }
  }
  const unique = new Map(findings.map(finding => [stableStringify(finding), finding]));
  const sorted = [...unique.values()].sort((a, b) => compare(a.code, b.code) || compare(a.subject, b.subject) || compare(a.message, b.message));
  return { ok: !sorted.some(finding => finding.severity === "error"), findings: sorted };
}
