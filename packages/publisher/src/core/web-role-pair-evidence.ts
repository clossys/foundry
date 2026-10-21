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
const revision = "804f242d6d2937031d4f0ee53460a40c7d77f975";
const measuredAt = "2026-10-21";
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
  "src/web/index.ts": "sha256:1fad5e9ba87d829074e33e4070a3e3fdd9b1c67e4e23ac2310e9687e1621807d",
  "src/web/frame/index.ts": "sha256:51c265d1680485b457299374b1df944c60f45f19d9c8be6eb0abb0e6c91ed6ef",
  "src/web/server.ts": "sha256:e69b0df86f3408425b1c9d2f46eb5cb046ef6ced3dbfebd1f52e65c84ffe3bb5",
  "src/web/frame/site-frame-contract.ts": "sha256:678940dd5021909c68b638c6a8c15dab2f7d5273efc4dfe6f156e62edc28196d",
  "src/web/frame/NavLinks.tsx": "sha256:01288ed59dfcd0f0d8abda463dbc6df9c5a60359d3b0fe8f60ba631d70024ca7",
  "src/web/frame/NavDisclosure.client.tsx": "sha256:d08037c12988a01a10faff0e81e6120aa6c6b61a911705fe5017642e117770f2",
  "src/web/frame/NavDisclosure.server.tsx": "sha256:ded40ebac8e5d0bc633672fb1214376c5e529c17663cb23631184098683bbed1",
  "src/web/frame/NavDisclosure.boundary.client.tsx": "sha256:7534aa2ae3394632a66ad871b4c298cd4467420b55d74af54ccf23422540655f",
  "src/web/frame/SiteFrame.tsx": "sha256:56f89776295138a921fb42ce955032d89dda9fcac08973ce1467f6e698668093",
  "src/web/frame/types.ts": "sha256:f6a27f2c396e80a2dbfa96b2c665f73f8dfc3b2e2e97dab4051a392a124b61f5",
  "src/web/frame/SkipLink.client.tsx": "sha256:4cd4ff41cd290b09f10d6c1079f7fe3ad788c25722c9d023bb740b659148aa01",
  "src/web/frame/internal/resolveShell.ts": "sha256:be6e184ba938aa57cc4f30c729cb46ff8b693e8a40f7ef4cbdfefc3fa336cf32",
  "src/web/views/index.ts": "sha256:d1fe427dd29b49f67df327b5589bc48eaf98beb5e80c0a1d92fbe837a81a49ff",
  "src/web/views/LandingView.tsx": "sha256:ad06fd2fd0e76e087c104a67c45630bcd6c02fa310222fae2c4e6d85c3526de7",
  "src/web/views/LandingViewContent.tsx": "sha256:510a846a5e470efaec2415219afa0b5820f79642c5e7bac08a648971e4100324",
  "src/web/views/SectionedViewContent.tsx": "sha256:81dc4a515f3d60db852799aef67208da4c607ac6b98e11bbeb38737ba4dd5a94",
  "src/web/views/SectionedViewBlocks.tsx": "sha256:deffac32eea7e4af4cada6b39a92504ddc511859aa82f508ea40630f662d1f1a",
  "src/web/views/LegalView.tsx": "sha256:bd8fadd0ddf3d0ea9ab7fc01f9697d8c74fb5f60a9c76b7ff74a513406fa8f68",
  "src/web/views/CaptureView.tsx": "sha256:9a8c2eb3fc260d121c24f62c025d5caf2017b84669ad0718ac131fb8b0d2724c",
  "src/web/internal/viewContentRoot.ts": "sha256:30d3259d5514a5b7dda0f51c4fb7735ecaee4eda7242174df4e996a7e5c4059e",
  "src/web/internal/PageLayout.tsx": "sha256:d4422311a8b6f0435f52d1cfc5c5ea9f0946e892dbc8e08fa8903a99cd8653cb",
  "src/document/legal.ts": "sha256:3b9b19cb843964875b1f5fd89be78ea9b851a059d2f8a9d904ca84adf9a74ee3",
  "src/document/render.ts": "sha256:2564a403881a2c43f70e9aaffb679878d2351413a556af4c57e0f433016737e0"
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
