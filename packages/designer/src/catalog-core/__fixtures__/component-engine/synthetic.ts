/** SYNTHETIC code-generation corpus. Never real component conformance evidence. */
import { componentProfile } from "../components/profile.js";
import { sha256 } from "../../digest.js";
import { stableStringify } from "../../stable.js";
import { componentSourceHash } from "../../check-components.js";
import type { ComponentCandidateDocument, ComponentCatalog, ComponentLibrary } from "../../resolve-components.js";

export function synthetic() {
  const check = componentProfile();
  const candidate = structuredClone(check.fills[0]!);
  candidate.reads.assets = [];
  candidate.propMap = Object.fromEntries(candidate.members.map(member => [member, `./components#Button.${member.replace(".", "=")}`]));
  const doc: ComponentCandidateDocument = { $extensions: { "com.clossys.fill": {
    id: "test-kit/components.button", slot: candidate.slot, source: candidate.source, mode: "implementation", sourceAddress: "./components#Button", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", pin: candidate.pin, status: "draft",
  } }, components: { button: candidate } };
  const catalog: ComponentCatalog = { slots: check.slots, fills: [doc] };
  const library: ComponentLibrary = { source: { id: "example", kind: "consumer", author: "consumer", license: "MIT" }, adoptedAt: "2026-10-23", fills: [], files: [] };
  return { check, doc, candidate, catalog, library };
}

export function syntheticSource() {
  const input = synthetic();
  const upstream = { path: "registry/button.tsx", content: "synthetic upstream input" };
  const file = { path: "components/button/button.tsx", content: 'import { Button } from "react-aria-components"; export { Button };\n' };
  const notice = { path: "notices/THIRD-PARTY.md", content: "SYNTHETIC MIT notice\n" };
  const candidate = input.doc.components.button!;
  candidate.impl = { kind: "source", entry: file.path, export: "Button" };
  candidate.pin = { url: "https://example.org/registry", commit: "a".repeat(40), files: [{ path: upstream.path, sha256: sha256(upstream.content) }] };
  candidate.notice = notice.path; candidate.transform = "synthetic@1"; candidate.blockers = [];
  candidate.propMap = Object.fromEntries(candidate.members.map(member => [member, `Button.${member.replace(".", "=")}`]));
  candidate.outputSha256 = [file, notice].map(file => ({ path: file.path, sha256: sha256(file.content) }));
  candidate.deps = [{ name: "react-aria-components", version: "1.21.1", license: "Apache-2.0" }];
  input.check.observations[candidate.slot]!.rac.dependency = "source";
  const observation = input.check.observations[candidate.slot]!;
  observation.files = [file, notice]; observation.sourceHash = componentSourceHash(observation.files);
  observation.upstreamFiles = [upstream]; observation.outputSha256 = candidate.outputSha256;
  const descriptorHash = sha256(stableStringify(candidate));
  return { ...input, upstream, file, notice, descriptorHash };
}
