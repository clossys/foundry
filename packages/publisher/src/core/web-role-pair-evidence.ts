import { validateBlockRoleBinding } from "./block-role-binding.js";
import type { BlockRoleBindingIdentity, InstanceBlockBinding } from "./block-role-binding.js";

export type WebRolePairStatus = "measured" | "violated" | "unmeasured";
export type WebRolePairCheck = "standaloneMain" | "standaloneChrome" | "composedMain" | "frameMain" |
  "skipLinks" | "skipTargets" | "viewMain" | "viewContent" | "chromeOutsideMain" | "chromeInsideMain";
export interface WebRolePairEvidence {
  identity: BlockRoleBindingIdentity;
  medium: "web";
  measuredAt: string;
  sourceRevision: string;
  sourceDigests: Readonly<Record<string, `sha256:${string}`>>;
  measurer: { name: "react-ssr-structural"; version: "1" };
  fixtureDigest: `sha256:${string}`;
  checks: Readonly<Record<WebRolePairCheck, { count: number; selector: string; status: WebRolePairStatus }>>;
  limits: readonly string[];
}
export interface WebRolePairEvidenceResult {
  status: WebRolePairStatus;
  reasons: readonly string[];
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const revision = "4b82b3dc4aed6df66b0a8640ec69e8702eb4cc2d";
const measuredAt = "2026-10-18";
const frame: InstanceBlockBinding["frameBlockRef"] = {
  blockId: "site-frame", role: "frame", medium: "web",
  adapter: { owner: "@clossys/publisher", subpath: "web", export: "SiteFrame", config: {} },
  regions: [{ key: "main", required: true, childRoles: ["view"], content: ["document"] }],
  content: ["document"], runtime: ["server"], lifecycle: { requires: [], provides: ["skip-focus"] },
  layout: "flow", web: { main: "sole", skipTarget: "main" }, evidence: { sourceRevision: revision, measuredAt },
};
const candidates = [
  { name: "LandingView", config: { landmark: "none" } },
  { name: "LegalView", config: { framed: true } },
  { name: "CaptureView", config: {} },
] as const;
export const WEB_ROLE_PAIR_BINDINGS: readonly InstanceBlockBinding[] = freeze(candidates.map(({ name, config }) => ({
  context: { consumer: "example", brand: "standard", medium: "web" }, frameBlockRef: frame,
  viewBlockRef: { ...frame, blockId: name, role: "view", adapter: { ...frame.adapter, export: name, config },
    regions: [{ key: "body", required: true, childRoles: [], content: ["document"] }],
    lifecycle: { requires: [], provides: [] }, web: { main: "none" } },
})));
const known = WEB_ROLE_PAIR_BINDINGS.flatMap(binding => [binding.frameBlockRef, binding.viewBlockRef]);
const sources = {
  "src/web/index.ts": "sha256:913ca54a21cb633a1d1f526c9667c9ab8562b0acc89ed3ae6a10b90c6a148ad5",
  "src/web/frame/index.ts": "sha256:d4ba0de90018598bbf3ba3e75ef304da0fdf2b26a6d12e29e1301f0732f43ae3",
  "src/web/frame/SiteFrame.tsx": "sha256:62e7003296009b57ec48c427e715a5249344fac7e2efb8756d45f849ce8ca23c",
  "src/web/frame/types.ts": "sha256:fcd8f8b9a2d51fab3f473c1317321dcec30b3da55fa0507fbba28f6cc9958bee",
  "src/web/frame/SkipLink.client.tsx": "sha256:6eda961d6d7071cc7083b1db8b674bd38fe2c4d48d7bfd8cc82745344883d585",
  "src/web/frame/internal/resolveShell.ts": "sha256:5097f9dea4159e99b62aba87c775b65902e8f3cf9bcadc5e57a60af87a019635",
  "src/web/views/index.ts": "sha256:17d52454224b53eb2b2807995eef9ea16b6cbf7d5d92358d4faef9cb612261b7",
  "src/web/views/LandingView.tsx": "sha256:ad06fd2fd0e76e087c104a67c45630bcd6c02fa310222fae2c4e6d85c3526de7",
  "src/web/views/LandingViewContent.tsx": "sha256:510a846a5e470efaec2415219afa0b5820f79642c5e7bac08a648971e4100324",
  "src/web/views/SectionedViewContent.tsx": "sha256:81dc4a515f3d60db852799aef67208da4c607ac6b98e11bbeb38737ba4dd5a94",
  "src/web/views/SectionedViewBlocks.tsx": "sha256:deffac32eea7e4af4cada6b39a92504ddc511859aa82f508ea40630f662d1f1a",
  "src/web/views/LegalView.tsx": "sha256:02bf1ff80c1248bf2a8c0fb4318344b3edb20882a7aeca274008d8263ceb4519",
  "src/web/views/CaptureView.tsx": "sha256:eab856f18aae8023450bdbd718086dfaaaf49b9ad9c653c8061bcda676ecfdc1",
  "src/web/internal/viewContentRoot.ts": "sha256:30d3259d5514a5b7dda0f51c4fb7735ecaee4eda7242174df4e996a7e5c4059e",
  "src/web/internal/PageLayout.tsx": "sha256:d4422311a8b6f0435f52d1cfc5c5ea9f0946e892dbc8e08fa8903a99cd8653cb",
  "src/document/legal.ts": "sha256:3b9b19cb843964875b1f5fd89be78ea9b851a059d2f8a9d904ca84adf9a74ee3",
  "src/document/render.ts": "sha256:2564a403881a2c43f70e9aaffb679878d2351413a556af4c57e0f433016737e0",
} as const;
const selectors: Record<WebRolePairCheck, string> = {
  standaloneMain: "main, [role~='main']", standaloneChrome: "header, footer, [role~='banner'], [role~='contentinfo']",
  composedMain: "main, [role~='main']", frameMain: ":scope > div > main#publisher-main-content",
  skipLinks: "a[href='#publisher-main-content']", skipTargets: "[id='publisher-main-content']",
  viewMain: "main#publisher-main-content main, main#publisher-main-content [role~='main']", viewContent: "main#publisher-main-content h1",
  chromeOutsideMain: "header, footer, [role~='banner'], [role~='contentinfo']", chromeInsideMain: "header, footer, [role~='banner'], [role~='contentinfo']",
};
const expected: Record<WebRolePairCheck, number> = {
  standaloneMain: 0, standaloneChrome: 0, composedMain: 1, frameMain: 1, skipLinks: 1,
  skipTargets: 1, viewMain: 0, viewContent: 1, chromeOutsideMain: 2, chromeInsideMain: 0,
};
export const WEB_ROLE_PAIR_EVIDENCE: readonly WebRolePairEvidence[] = freeze(WEB_ROLE_PAIR_BINDINGS.map(binding => {
  const result = validateBlockRoleBinding(binding, known);
  if (!("identity" in result) || !result.identity) throw new Error("Missing measured pair identity.");
  return {
    identity: result.identity, medium: "web", measuredAt, sourceRevision: revision, sourceDigests: sources,
    measurer: { name: "react-ssr-structural", version: "1" }, fixtureDigest: "sha256:a691bf716d31825236e4c08484a1373ebf1cfe2b64504458bc4f5e8cbd563cee",
    checks: Object.fromEntries(Object.entries(expected).map(([key, count]) => [key,
      { count, selector: selectors[key as WebRolePairCheck], status: "measured" }])) as WebRolePairEvidence["checks"],
    limits: ["Structural server-render evidence only; page chrome: header/footer without article, aside, nav or section ancestor, plus explicit banner/contentinfo roles.",
      "No browser, accessibility-tree, focus-order, packed-install or consumer runtime claim.",
      "Each pair measures only itself; Landing does not qualify Legal or Capture.",
      "A record is data, never qualification; the test re-measures and the validator compares fresh observations.",
      "Digests cover only the listed source files; dependency behavior and arbitrary fixture configurations are outside this evidence."],
  };
}));
function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("Invalid evidence depth.");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("Invalid evidence value.");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) throw new Error("Invalid evidence object.");
  const fields = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(fields).filter(key => !(array && key === "length"));
  if (keys.some(key => typeof key !== "string" || !fields[key]!.enumerable || !("value" in fields[key]!))) throw new Error("Invalid evidence field.");
  if (array && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new Error("Invalid evidence array.");
  return array ? "[" + keys.map(key => canonical(fields[key as string]!.value, depth + 1)).join(",") + "]"
    : "{" + (keys as string[]).sort().map(key => JSON.stringify(key) + ":" + canonical(fields[key]!.value, depth + 1)).join(",") + "}";
}
/** Compares retained data with externally re-measured data; cannot authenticate a renderer or confer qualification. */
export function validateWebRolePairEvidence(record: unknown, binding: unknown, fresh?: WebRolePairEvidence): WebRolePairEvidenceResult {
  try {
    const result = validateBlockRoleBinding(binding, known);
    if (result.status !== "unverified" || !result.identity || result.reasons.some(reason => reason.code !== "measurement-required")) {
      return { status: "violated", reasons: ["binding"] };
    }
    const index = WEB_ROLE_PAIR_EVIDENCE.findIndex(candidate => canonical(candidate.identity) === canonical(result.identity));
    const retained = WEB_ROLE_PAIR_EVIDENCE[index];
    if (!retained || canonical(record) !== canonical(retained)) return { status: "violated", reasons: ["record"] };
    if (canonical(binding) !== canonical(WEB_ROLE_PAIR_BINDINGS[index])) return { status: "violated", reasons: ["binding"] };
    if (fresh === undefined) return { status: "unmeasured", reasons: ["fresh-measurement-required"] };
    return canonical(fresh) === canonical(retained)
      ? { status: "measured", reasons: [] } : { status: "violated", reasons: ["fresh-measurement"] };
  } catch {
    return { status: "violated", reasons: ["invalid-data"] };
  }
}
