import { TOKENS } from "../tokens/tokens.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";
import { resolveTokenValue } from "../tokens/internal/resolve-token-value.js";
import type { TokenDefinition } from "../tokens/tokens.js";
import { contrastRatio } from "../tokens/color.js";
import { parseFill } from "./cell.js";
import { idFinding, isValidId, LAYERS } from "./ids.js";
import { aliasOf, assetReferences, compare, flatten, leafOf, malformed, metaOf, modeValue, references, relativeOf, unsafeText } from "./model.js";
import { gradientColorAlias, gradientStops } from "../tokens/expressive.js";
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
  const add = (code: CheckCode, rule: string, subject: string, diagnostic: { message: string; copy: NonNullable<Finding["copy"]> }, severity: Finding["severity"] = "error"): void => { findings.push({ code, rule, subject, severity, ...diagnostic }); };
  const slots = new Map(input.catalog.slots.map(slot => [slot.id, slot]));
  const sources = new Map([input.library.source].map(source => [source.id, source]));
  const clauses = new Set(input.catalog.standards.flatMap(standard => standard.clauses.map(clause => `${standard.id}#${clause.id}`)));
  const bound = new Map<string, string[]>(); const shipped = new Map(Object.values(TOKENS).map(token => [token.property, token]));
  const rank = (slot: Slot): string => slot.contract.kind === "token" ? slot.contract.tier === "scale" ? "0.0" : "0.1" : String(LAYERS.indexOf(slot.layer));
  const status = (subject: string, data: { status: string; signoff?: { by: string; date: string; ref: string } }): void => {
    if (data.status === "stable" && (!data.signoff || data.signoff.by !== "owner" || !/^\d{4}-\d{2}-\d{2}$/.test(data.signoff.date) || typeof data.signoff.ref !== "string" || !data.signoff.ref.trim())) add("C8", "status", subject, { message: `status: ${subject} is stable without an owner sign-off`, copy: { id: "st.q61fvrqvf9", values: { item: (subject ?? "") } } });
  };
  for (const slot of input.catalog.slots) {
    if (!isValidId("slot", slot.id)) findings.push(idFinding("slot", slot.id, slot.id));
    status(slot.id, slot);
    if (slot.contract.kind === "asset" && slot.contract.optional?.some(name => slot.contract.members.mode !== "closed" || !slot.contract.members.names.includes(name))) add("C1", "contract", slot.id, { message: `contract: ${slot.id} optional members must be declared closed members`, copy: { id: "st.9z67w1pg64", values: { item: (slot.id ?? "") } } });
    for (const clause of slot.requires) if (!clauses.has(clause)) add("C3", "standards", slot.id, { message: `standards: unknown clause ${clause} in ${slot.id}`, copy: { id: "st.3chprq1k2v", values: { item: (slot.id ?? ""), clause: (clause ?? "") } } });
    const hasFill = filledSlots.has(slot.id);
    if (slot.contract.kind === "token") for (const [relative, css] of Object.entries(slot.contract.emit ?? {})) {
      const id = `${slot.id}.${relative}`; bound.set(css, [...(bound.get(css) ?? []), id]);
      if (!shipped.has(css)) add("C4", "binding", css, { message: `binding: ${css} is not a shipped token`, copy: { id: "st.y89003hb02", values: { property: (css ?? "") } } });
      if (!fresh.members[id] && (input.library.complete || hasFill)) add("C4", "coverage", id, { message: `coverage: ${id} (emits ${css}) has no value in profile ${input.library.source.id}`, copy: { id: "st.rhhgjm5eg2", values: { item: (id ?? ""), source: (input.library.source.id ?? "") } } });
    }
    if (!hasFill) add("C4", "coverage", slot.id, { message: `coverage: slot ${slot.id} has no consumer fill`, copy: { id: "st.q4xjgfd4fz", values: { item: (slot.id ?? "") } } }, input.library.complete ? "error" : "notice");
    const requiredMembers = slot.contract.members.mode === "closed" ? slot.contract.members.names : slot.contract.members.required ?? [];
    for (const relative of requiredMembers) {
      if (slot.contract.kind === "asset" && slot.contract.optional?.includes(relative)) continue;
      if (slot.contract.kind === "token" && slot.contract.emit?.[relative]) continue;
      const member = `${slot.id}.${relative}`;
      if (!fresh.members[member] && (input.library.complete || hasFill)) add("C4", "coverage", member, { message: `coverage: ${member} has no value in profile ${input.library.source.id}`, copy: { id: "st.fnhr7mxb8y", values: { option: (member ?? ""), source: (input.library.source.id ?? "") } } });
    }
  }
  for (const [css, members] of bound) if (members.length > 1) {
    const ordered = members.sort(compare); add("C4", "binding", css, { message: `binding: ${css} is bound to ${ordered[0]} and ${ordered[1]}`, copy: { id: "st.rqeyv00dt6", values: { property: (css ?? ""), first: (ordered[0] ?? ""), second: (ordered[1] ?? "") } } });
  }
  for (const token of Object.values(TOKENS)) if (!bound.has(token.property)) add("C4", "binding", token.property, { message: `binding: shipped token ${token.property} is not bound`, copy: { id: "st.2vpfv868dy", values: { property: (token.property ?? "") } } });
  const grouped = new Map<string, number>();
  for (const fill of fills) {
    const meta = metaOf(fill); const slot = slots.get(meta.slot); const source = sources.get(meta.source); const tokens = tokensOf(fill);
    findings.push(...parseFill(fill).findings);
    const key = `${meta.source}/${meta.slot}`; grouped.set(key, (grouped.get(key) ?? 0) + 1);
    status(meta.id, meta);
    if (meta.source !== input.library.source.id) add("C7", "selection", meta.id, { message: `selection: consumer fill ${meta.id} names source ${meta.source}, expected ${input.library.source.id}`, copy: { id: "st.1tes15ky9s", values: { item: (meta.id ?? ""), actual: (meta.source ?? ""), expected: (input.library.source.id ?? "") } } });
    if (meta.mode !== "implementation") add("C7", "selection", meta.id, { message: `selection: consumer fill ${meta.id} has mode ${meta.mode}, expected implementation`, copy: { id: "st.4wsy0z51f6", values: { item: (meta.id ?? ""), mode: (meta.mode ?? "") } } });
    if (!slot) { add("C4", "orphan", meta.id, { message: `orphan: ${meta.id} names slot ${meta.slot}, which is not registered`, copy: { id: "st.04q01pqy32", values: { item: (meta.id ?? ""), target: (meta.slot ?? "") } } }); continue; }
    for (const clause of slot.requires) if (!meta.conforms.includes(clause)) add("C3", "standards", meta.id, { message: `standards: slot ${slot.id} requires ${clause}; ${meta.id} does not claim it`, copy: { id: "st.9zgrs0gdx5", values: { item: (meta.id ?? ""), clause: (clause ?? "") } } });
    for (const clause of meta.conforms) {
      if (!clauses.has(clause)) add("C3", "standards", meta.id, { message: `standards: unknown clause ${clause} in ${meta.id}`, copy: { id: "st.bamf1wtwq5", values: { item: (meta.id ?? ""), clause: (clause ?? "") } } });
      if (!meta.evidence.some(evidence => evidence.clause === clause)) add("C3", "standards", meta.id, { message: `standards: ${meta.id} claims ${clause} with no evidence`, copy: { id: "st.2nv2nqs2zs", values: { item: (meta.id ?? ""), clause: (clause ?? "") } } });
    }
    for (const evidence of meta.evidence) {
      if (!clauses.has(evidence.clause)) add("C3", "standards", meta.id, { message: `standards: unknown clause ${evidence.clause} in ${meta.id}`, copy: { id: "st.02zx2x1xv0", values: { item: (meta.id ?? ""), clause: (evidence.clause ?? "") } } });
      if ("path" in evidence && input.fileExists && !input.fileExists(evidence.path)) add("C3", "standards", meta.id, { message: `standards: ${meta.id} evidence for ${evidence.clause} not found at ${evidence.path}`, copy: { id: "st.6nrpvkkmpc", values: { clause: (evidence.clause ?? ""), path: (evidence.path ?? "") } } });
    }
    if (!input.fileExists && meta.evidence.some(evidence => "path" in evidence)) add("C3", "standards", meta.id, { message: `standards: ${meta.id} evidence paths not verified in this environment`, copy: { id: "st.91abshqn3f", values: { item: (meta.id ?? "") } } }, "notice");
    if (source?.kind === "external") {
      if (!source.pin || Object.keys(source.pin).length === 0) add("C6", "pin", source.id, { message: `pin: external source ${source.id} has no pin`, copy: { id: "st.r39xxtj0m7", values: { source: (source.id ?? "") } } });
      for (const [field, want] of Object.entries(source.pin ?? {})) {
        const got = meta.pin?.[field as keyof NonNullable<typeof meta.pin>];
        if (got !== want) add("C6", "pin", meta.id, { message: `pin: ${meta.id} pin ${field}=${got} differs from source ${source.id} (${want})`, copy: { id: "st.yzykbaqxz8", values: { item: (meta.id ?? ""), field: (field ?? ""), source: (source.id ?? "") } } });
      }
      if (!LICENSES.has(meta.license)) add("C6", "licence", meta.id, { message: `licence: ${meta.id} licence ${meta.license} is not on the allow list`, copy: { id: "st.eba4axrcet", values: { item: (meta.id ?? ""), license: (meta.license ?? "") } } });
    }
    if (source?.kind === "external" && meta.license !== source.license) add("C6", "licence", meta.id, { message: `licence: ${meta.id} licence ${meta.license} differs from source ${source.id} licence ${source.license}`, copy: { id: "st.egfd1mhzhm", values: { item: (meta.id ?? ""), source: (source.id ?? "") } } });
    const originKinds = [...new Set(Object.values(tokens).map(originOf).filter(Boolean).map(origin => origin!.kind))].sort(compare);
    if (stableStringify(meta.originKinds ?? []) !== stableStringify(originKinds)) add("C10", "provenance", meta.id, { message: `provenance: ${meta.id} originKinds does not summarize its members`, copy: { id: "st.x1we8bkk3z", values: { item: (meta.id ?? "") } } });
    if (slot.contract.kind === "asset" && (!meta.reads || !Array.isArray(meta.reads.tokens) || !Array.isArray(meta.reads.assets))) add("C2", "reads", meta.id, { message: `reads: ${meta.id} must declare token and asset leaf reads`, copy: { id: "st.w4szzgnvem", values: { item: (meta.id ?? "") } } });
    for (const [member, token] of Object.entries(tokens)) {
      const relative = relativeOf(member);
      const origin = originOf(token);
      const valid = origin && (
        origin.kind === "adopted" ? isValidId("source",origin.source) && isValidId("fill",origin.fill) && isValidId("member",origin.member) && typeof origin.license === "string" && /^[a-f0-9]{64}$/.test(origin.sha256) && /^\d{4}-\d{2}-\d{2}$/.test(origin.adoptedAt) && (origin.aliasOf === undefined || isValidId("member",origin.aliasOf)) :
        origin.kind === "authored" ? typeof origin.license === "string" && (origin.note === undefined || typeof origin.note === "string") :
        origin.kind === "derived" ? typeof origin.rule === "string" && Array.isArray(origin.inputs) && origin.inputs.every(input => typeof input === "string" && isValidId("member",input)) && /^[a-f0-9]{64}$/.test(origin.inputsHash) :
        origin.kind === "composed" ? Array.isArray(origin.reads) && origin.reads.every(read => typeof read === "string" && isValidId("slot",read)) : false);
      if (!valid) add("C10", "provenance", member, { message: `provenance: ${member} has invalid origin`, copy: { id: "st.nd87zh6ckx", values: { option: (member ?? "") } } });
      else if (origin.kind === "adopted") {
        const materializedHash = token.$extensions?.["com.clossys.materializedSha256"];
        const validMaterialization = !!origin.aliasOf && typeof materializedHash === "string" && /^[a-f0-9]{64}$/.test(materializedHash) && materializedHash !== origin.sha256;
        if (origin.aliasOf !== undefined && !validMaterialization || materializedHash !== undefined && !validMaterialization) add("C10", "provenance", member, { message: `provenance: ${member} has inconsistent alias materialization metadata`, copy: { id: "st.384btm24fn", values: { option: (member ?? "") } } });
        const ownHash = validMaterialization ? materializedHash : origin.sha256;
        if (sha256(stableStringify(tokenContent(token))) !== ownHash) add("C10", "provenance", member, { message: `provenance: ${member} adopted content differs from its recorded sha256; re-kind as authored`, copy: { id: "st.rrmgcc1f85", values: { option: (member ?? "") } } });
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
          if (!origin.pin || Object.keys(origin.pin).length === 0 || Object.values(origin.pin).some(value => typeof value !== "string" || !value.trim())) add("C6", "pin", member, { message: `pin: ${member} adopted external source ${origin.source} has no valid pinned receipt`, copy: { id: "st.5qkfrpakkf", values: { option: (member ?? ""), source: (origin.source ?? "") } } });
          if (stableStringify(origin.pin ?? null) === stableStringify(originSource.pin ?? null) && origin.license !== originSource.license) add("C6", "licence", member, { message: `licence: ${member} origin licence ${origin.license} differs from source ${origin.source} licence ${originSource.license}`, copy: { id: "st.m30zv89k2g", values: { option: (member ?? ""), source: (origin.source ?? "") } } });
          if (candidate && stableStringify(origin.pin ?? null) === stableStringify(metaOf(candidate).pin ?? null) && origin.license !== metaOf(candidate).license) add("C6", "licence", member, { message: `licence: ${member} origin licence ${origin.license} differs from pinned fill ${origin.fill} licence ${metaOf(candidate).license}`, copy: { id: "st.n9sq2p0tyq", values: { option: (member ?? ""), version: (origin.fill ?? "") } } });
        }
        if (validMaterialization && upstream && sha256(stableStringify(tokenContent(upstream))) === origin.sha256 && !readsOf(upstream).includes(origin.aliasOf!)) add("C10", "provenance", member, { message: `provenance: ${member} aliasOf is not an upstream read`, copy: { id: "st.n7v4h3rat1", values: { option: (member ?? "") } } });
        if (!upstream || sha256(stableStringify(tokenContent(upstream))) !== origin.sha256 || candidate && stableStringify(metaOf(candidate).pin ?? null) !== stableStringify(origin.pin ?? null) || sourcePinDrift) add("C10", "provenance", member, { message: `provenance: ${member} has upstream drift from source ${origin.source} (${origin.fill})`, copy: { id: "st.17f0v9fqrk", values: { option: (member ?? ""), source: (origin.source ?? ""), version: (origin.fill ?? "") } } }, "notice");
        if (!LICENSES.has(origin.license)) add("C6", "licence", member, { message: `licence: ${member} origin licence ${origin.license} is not on the allow list`, copy: { id: "st.f4cngs43d3", values: { option: (member ?? ""), license: (origin.license ?? "") } } });
      } else if (origin.kind === "authored") {
        if (origin.license !== "UNLICENSED" && !LICENSES.has(origin.license)) add("C6", "licence", member, { message: `licence: ${member} origin licence ${origin.license} is not on the allow list`, copy: { id: "st.0bbtzshjnf", values: { option: (member ?? ""), license: (origin.license ?? "") } } });
      } else if (origin.kind === "derived") {
        if (!input.catalog.rules?.some(rule => rule.id === origin.rule && rule.slot === slot?.id)) add("C10", "provenance", member, { message: `provenance: ${member} uses unknown rule ${origin.rule}`, copy: { id: "st.42m43xmmrw", values: { option: (member ?? ""), rule: (origin.rule ?? "") } } });
        else {
          try { const rule=registeredRule(input.catalog,origin.rule,slot!.id); if(!matchesRuleInputs(rule,origin.inputs)) add("C10", "provenance", member, { message: `provenance: ${member} differs from declared inputs for ${origin.rule}`, copy: { id: "st.gxkkcqybhb", values: { option: (member ?? ""), rule: (origin.rule ?? "") } } }); }
          catch(error) { add("C10", "provenance", member, { message: `provenance: ${member} ${String(error)}`, copy: { id: "st.5vdaaz903c", values: { option: (member ?? "") } } }); }
        }
        try { if (hashInputs(origin.inputs) !== origin.inputsHash) add("C10", "provenance", member, { message: `provenance: ${member} has stale inputsHash for ${origin.rule}; re-derive explicitly`, copy: { id: "st.k1tfr1pjww", values: { option: (member ?? ""), rule: (origin.rule ?? "") } } }); }
        catch { add("C10", "provenance", member, { message: `provenance: ${member} has unresolved inputs for ${origin.rule}`, copy: { id: "st.j95ydhvgtp", values: { option: (member ?? ""), rule: (origin.rule ?? "") } } }); }
      }

      if (typeof token.$type !== "string") continue;
      for (const ref of readsOf(token)) if (!isValidId("member", ref)) findings.push(idFinding("member", ref, meta.id));
      const want = slot.contract.kind === "token" ? slot.contract.memberTypes?.[relative] ?? slot.contract.$type : slot.contract.memberKinds?.[relative] ?? slot.contract.valueKind;
      if (token.$type !== want) add("C1", "contract", meta.id, { message: `contract: ${meta.id} member ${member} has $type ${token.$type}, slot ${slot.id} requires ${want}`, copy: { id: "st.h0wfqmrzm8", values: { option: (member ?? ""), actual: (token.$type ?? ""), item: (slot.id ?? ""), expected: (want ?? "") } } });
      const members = slot.contract.members;
      if (members.mode === "closed" && !members.names.includes(relative)) add("C1", "contract", meta.id, { message: `contract: ${meta.id} provides unknown member ${member} (slot ${slot.id} is closed)`, copy: { id: "st.7zteyxjwt4", values: { item: (meta.id ?? ""), option: (member ?? "") } } });
      if (members.mode === "open") {
        let matches = false; try { matches = new RegExp(members.pattern).test(relative); } catch { /* Invalid contract patterns never accept values. */ }
        if (!matches) add("C1", "contract", meta.id, { message: `contract: ${meta.id} member ${member} does not match pattern ${members.pattern}`, copy: { id: "st.t4z8h3han3", values: { option: (member ?? "") } } });
      }
      const dark = token.$extensions?.["com.clossys.modes"]?.dark;
      if (dark !== undefined && !(slot.contract.modes as readonly string[]).includes("dark")) add("C1", "contract", meta.id, { message: `contract: ${meta.id} sets mode dark but slot ${slot.id} allows only light`, copy: { id: "st.srvepc6d87", values: { item: (meta.id ?? "") } } });
      for (const mode of dark === undefined ? ["light"] as const : ["light", "dark"] as const) {
        const value = modeValue(token, mode); const raw = token.$extensions?.["com.clossys.css"]?.raw;
        const templated = false;
        if (assetReferences(value).length > 0) add("C10", "provenance", member, { message: `provenance: ${member} contains an unmaterialized template`, copy: { id: "st.r9p0vy33c2", values: { option: (member ?? "") } } });
        if (!templated && malformed(token.$type, value, raw)) add("C1", "contract", meta.id, { message: `contract: ${meta.id} member ${member} has a malformed ${token.$type} value`, copy: { id: "st.5q540w8na4", values: { option: (member ?? ""), type: (token.$type ?? "") } } });
        if (slot.contract.kind === "token" && !aliasOf(value)) {
          const strings = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v !== null && typeof v === "object" ? Object.values(v).flatMap(strings) : [];
          const inspected = token.$type === "gradient" && gradientStops(value) ? value.map(stop => gradientColorAlias(stop.color) ? { ...stop, color: null } : stop) : value;
          const unsafe = [typeof value === "string" && mode === "dark" ? value : raw ?? "", ...strings(inspected)].map(unsafeText).find(Boolean);
          if (unsafe) add("C1", "contract", meta.id, { message: `contract: ${meta.id} member ${member} has unsafe CSS text (${unsafe})`, copy: { id: "st.p660j51er5", values: { option: (member ?? "") } } });
        }
      }
      const font = token.$extensions?.["com.clossys.font"];
      if (font?.kind === "fontsource" && !LICENSES.has(font.license)) add("C6", "licence", meta.id, { message: `licence: ${meta.id} licence ${font.license} is not on the allow list`, copy: { id: "st.4rycwd4m8p", values: { item: (meta.id ?? ""), license: (font.license ?? "") } } });
      if (slot.contract.kind === "asset") for (const ref of readsOf(token)) {
        const layer = leafOf(ref).split(".")[0]; const declared = layer === "tokens" ? meta.reads?.tokens : meta.reads?.assets;
        if (!declared?.includes(leafOf(ref))) add("C2", "reads", member, { message: `reads: ${member} in ${meta.id} reads undeclared leaf ${leafOf(ref)}`, copy: { id: "st.gk574ngpg2", values: { option: (member ?? ""), target: (leafOf(ref) ?? "") } } });
      }
    }
  }
  for (const source of sources.values()) {
    if (!isValidId("source", source.id)) findings.push(idFinding("source", source.id, source.id));
    if (source.kind === "external" && !LICENSES.has(source.license)) add("C6", "licence", source.id, { message: `licence: ${source.id} licence ${source.license} is not on the allow list`, copy: { id: "st.s77v3qs6s9", values: { source: (source.id ?? ""), license: (source.license ?? "") } } });
    if (source.kind === "external" && (!source.pin || Object.keys(source.pin).length === 0)) add("C6", "pin", source.id, { message: `pin: external source ${source.id} has no pin`, copy: { id: "st.t578r688wz", values: { source: (source.id ?? "") } } });
  }
  for (const [key, count] of grouped) if (count > 1) { const [source, slot] = key.split("/"); add("C5", "uniqueness", key, { message: `uniqueness: source ${source} has ${count} fills for slot ${slot}`, copy: { id: "st.yzfg6d7a3p", values: { source: (source ?? ""), count: (count ?? ""), item: (slot ?? "") } } }); }
  if (input.library.selection && stableStringify(input.library.selection) !== stableStringify(generateSelection(input.library))) add("C10", "provenance", input.library.source.id, { message: "provenance: generated selection differs from consumer fills and rationale", copy: { id: "st.mwtyf6mxz8" } });
  const graph = new Map<string, string[]>();
  for (const [member, entry] of Object.entries(chosen)) {
    const targets = new Set(readsOf(entry.token)); const meta = metaOf(entry.fill);
    const origin = originOf(entry.token);
    const composedReads = origin?.kind === "composed" && Array.isArray(origin.reads) ? origin.reads.filter((read): read is string => typeof read === "string") : [];
    let preciseLeaves = preciseLeavesByFill.get(entry.fill);
    if (!preciseLeaves) { preciseLeaves = new Set(Object.values(tokensOf(entry.fill)).flatMap(token => readsOf(token).map(leafOf))); preciseLeavesByFill.set(entry.fill, preciseLeaves); }
    for (const leaf of [...(meta.reads?.tokens ?? []), ...(meta.reads?.assets ?? []), ...composedReads]) {
      const targetSlot = slots.get(leaf);
      if (!targetSlot || !membersByLeaf.has(leaf)) add("C2", "reads", member, { message: `reads: ${member} in ${meta.id} reads ${leaf}, which does not resolve in profile ${input.library.source.id}`, copy: { id: "st.wv477682as", values: { option: (member ?? ""), target: (leaf ?? ""), source: (input.library.source.id ?? "") } } });
      else {
        if (Number(rank(entry.slot)) < Number(rank(targetSlot))) add("C2", "reads", member, { message: `reads: ${member} in ${meta.id} reads upward to ${leaf} (${rank(entry.slot)} may not read ${rank(targetSlot)})`, copy: { id: "st.q4a4j5xq1e", values: { option: (member ?? ""), target: (leaf ?? "") } } });
        // Fill reads are a summary. Explicit member inputs retain the finer graph,
        // including a derived variant reading its authored seed in the same leaf.
        if (composedReads.includes(leaf) || !preciseLeaves.has(leaf)) membersByLeaf.get(leaf)!.forEach(id => targets.add(id));
      }
    }
    for (const target of readsOf(entry.token)) {
      const targetSlot = slots.get(leafOf(target));
      if (!fresh.members[target]) add("C2", "reads", member, { message: `reads: ${member} in ${meta.id} reads ${target}, which does not resolve in profile ${input.library.source.id}`, copy: { id: "st.b1hx0wf7y4", values: { option: (member ?? ""), target: (target ?? "") } } });
      if (targetSlot && Number(rank(entry.slot)) < Number(rank(targetSlot))) add("C2", "reads", member, { message: `reads: ${member} in ${meta.id} reads upward to ${target} (${rank(entry.slot)} may not read ${rank(targetSlot)})`, copy: { id: "st.jt3xndjtmr", values: { option: (member ?? ""), target: (target ?? "") } } });
    }
    graph.set(member, [...targets].sort(compare));
    for (const mode of ["light", "dark"] as const) {
      let cursor: string | undefined = member; let hops = 0; const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor); const token: import("./types.js").DtcgToken | undefined = chosen[cursor]?.token; cursor = token ? aliasOf(modeValue(token, mode)) : undefined;
        if (cursor && ++hops > 16) { add("C2", "reads", member, { message: `reads: ${member} alias chain exceeds 16 hops`, copy: { id: "st.wc7c54fqnx", values: { option: (member ?? "") } } }); break; }
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
  for (const cycle of cycles) add("C2", "reads", cycle.split(" -> ")[0]!, { message: `reads: cycle ${cycle}`, copy: { id: "st.qh14qmdb2a", values: { cycle: (cycle ?? "") } } });
  if (input.resolved) for (const id of new Set([...Object.keys(fresh.members), ...Object.keys(input.resolved.members)])) if (stableStringify(fresh.members[id] ?? null) !== stableStringify(input.resolved.members[id] ?? null)) add("C5", "uniqueness", id, { message: `uniqueness: resolved member ${id} does not match a single implementation`, copy: { id: "st.qvyksbygzr", values: { option: (id ?? "") } } });
  const byCss = new Map<string, import("./types.js").ResolvedMember>(Object.values(fresh.members).filter(m => m.emit).map(m => [m.emit!, m]));
  for (const [id, member] of Object.entries(fresh.members)) if (member.emit && shipped.get(member.emit)?.brandable === false && input.library.baseline?.[member.emit] && input.library.baseline[member.emit]!.light !== member.css.light) add("C3", "standards", id, { message: `standards: ${id} overrides fixed Foundry scale ${member.emit}; emitted to scales.css`, copy: { id: "st.vp83q9wnjs", values: { item: (id ?? ""), property: (member.emit ?? "") } } }, "notice");
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
      if (ratio < pair.minimumRatio) add("C9", "contrast", pair.foreground, { message: `contrast: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1 in ${mode}, needs ${pair.minimumRatio}:1`, copy: { id: "st.rqg47qwhvg", values: { foreground: (pair.foreground ?? ""), background: (pair.background ?? ""), ratio: (ratio ?? ""), minimum: (pair.minimumRatio ?? ""), mode: (mode ?? "") } } });
    } catch {
      add("C9", "contrast", pair.foreground, { message: `contrast: ${pair.foreground} on ${pair.background} cannot be measured in ${mode}`, copy: { id: "st.73wzm8xe3s", values: { foreground: (pair.foreground ?? ""), background: (pair.background ?? ""), mode: (mode ?? "") } } });
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
