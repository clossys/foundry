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
const revision = "8bd1db89f8f2d0a195e0e87412dec4bb2d7f9075";
const measuredAt = "2026-10-29";
const frame: InstanceBlockBinding["frameBlockRef"] = {
  blockId: "site-frame", role: "frame", medium: "web",
  adapter: { owner: "@clossys/designer", subpath: "frames", export: "SiteFrame", config: {} },
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
  viewBlockRef: { ...frame, blockId: name, role: "view", adapter: { owner: name === "LandingView" ? "@clossys/designer" : "@clossys/publisher", subpath: name === "LandingView" ? "frames" : "web", export: name, config },
    regions: [{ key: "body", required: true, childRoles: [], content: ["document"] }],
    lifecycle: { requires: [], provides: [] }, web: { main: "none" } },
})));
const known = WEB_ROLE_PAIR_BINDINGS.flatMap(binding => [binding.frameBlockRef, binding.viewBlockRef]);
const sources = {
  "src/web/index.ts": "sha256:29f32f3eb6414c9477e543600d42d458a26c4af274e287655b00e2bb601f6efc",
  "src/web/frame/index.ts": "sha256:433ec11ad4135d0c9a827921d751e5fdde03fcf75b248a86e5e92d1207e9b9d8",
  "src/web/server.ts": "sha256:a6b51fbc58205b8dca29235f81806c58866f4588a40fdb679caf4cbe34cbfabb",
  "../designer/src/frames/site-frame/site-frame-contract.ts": "sha256:44f7a4f9b6ea8ba04abd355313921a16d2d0c285c0bafc91a10473cec6134416",
  "../designer/src/frames/site-frame/NavLinks.tsx": "sha256:f08cb4cfe847ee67cfb7031422df5e9aa8f963b514de8180a44f935013bd00ae",
  "../designer/src/frames/site-frame/NavDisclosure.client.tsx": "sha256:e62dd1650d0b9a4964bc72f6ce48ee7c1a41b07c6b1656c4c43ab57d7241e311",
  "../designer/src/frames/site-frame/NavDisclosure.server.tsx": "sha256:a67e16466fdd82b7ddd154e743b7a4af0614a21991d39d206e2a4a74462ba4cc",
  "../designer/src/frames/site-frame/NavDisclosure.boundary.client.tsx": "sha256:32e1550ce3d62a04d33874e677b5b32e32684d1561ceb994c6020cc57930c05a",
  "../designer/src/frames/site-frame/SiteFrame.tsx": "sha256:3d67ddfa17aa29c1fcdf01d11b4289448fe3483ba276235a9e9542ce62ff413a",
  "../designer/src/frames/site-frame/types.ts": "sha256:5082a75480ef118eda6c17d091d966bceb23e0b42555fe20930cd5c24437359b",
  "../designer/src/frames/site-frame/SkipLink.client.tsx": "sha256:4cd4ff41cd290b09f10d6c1079f7fe3ad788c25722c9d023bb740b659148aa01",
  "../designer/src/frames/site-frame/internal/resolveShell.ts": "sha256:3ede6936935916b747b8cf8e1271e11a1f36caa94360a57f98064c924bdcdd29",
  "src/web/views/index.ts": "sha256:48aaf88a5efc78ea7274fe4f309c8cf4f3a6d53a7e68ae9255fe381c96e24aab",
  "src/web/views/SectionedViewContent.tsx": "sha256:fc040d165b0b5fc6f00d850e554c736152434b94cbfd04649b21b30b615a7dab",
  "src/web/views/SectionedViewBlocks.tsx": "sha256:29e9280b60b2bb082f3a9a0321557ba69b6771da5c4b9be2d4d93edfc1af1282",
  "src/web/views/LegalView.tsx": "sha256:8c1d7ae576511f93a73390bbd3efd2e56bcd3944854d06637e6d299e84bb50ac",
  "src/web/views/CaptureView.tsx": "sha256:c74d71e24f6f7aa985d281524101004f759271a81bb3f123c4667e8cb78ac949",
  "src/web/internal/viewContentRoot.ts": "sha256:b8f15f55bd4a34991f83f1e060f1d33791c300a02112ac58202690448750833e",
  "src/web/internal/PageLayout.tsx": "sha256:a9969b13774fb0227f08c1554c5df86fd15db5e3657a4c52d030075a180784e6",
  "src/document/legal.ts": "sha256:3b9b19cb843964875b1f5fd89be78ea9b851a059d2f8a9d904ca84adf9a74ee3",
  "src/document/render.ts": "sha256:2564a403881a2c43f70e9aaffb679878d2351413a556af4c57e0f433016737e0",
  "../designer/src/frames/index.ts": "sha256:9b64226701237b59c28bc01165bd233b68923d7f7ebdf3fdf1845e6b468c1f0f",
  "../designer/src/frames/server.ts": "sha256:07c7b46ee590a56b8087b8515d9cedec1e5ebca57b45bf7025be59a95cb56883",
  "../designer/src/frames/site-frame/copy-contract.ts": "sha256:d25eeb44e89f6cd94cca46cf1b5fcaa03ffeee31389b2190f1e44a5099256f75",
  "../designer/src/frames/site-frame/landing/core/content-asset.ts": "sha256:3cac86a74516e1427500dc9bccb85b80b56d213cb6dedd44072e31ef38acb4f3",
  "../designer/src/frames/site-frame/landing/core/content-contract.ts": "sha256:d6c0eb90d4734fcd961fe6438b1114d0686bc42fb7cf4cdbfe87ac625db7b44c",
  "../designer/src/frames/site-frame/landing/core/content-ground.ts": "sha256:188f61cf5c113d5e10131e36d674127ff0890a1a3c5a2240a5b8c294c371b48b",
  "../designer/src/frames/site-frame/landing/core/page-flow.ts": "sha256:62296b40af038bf92c4712903c38ce3132b8dd8bdafbce24fb63718b4ca952d8",
  "../designer/src/frames/site-frame/landing/core/sectioned-view.ts": "sha256:d13d399b8cc4ac171a16bea82ee0a66d7de9f45fd04673ec409914bc1f5c7755",
  "../designer/src/frames/site-frame/landing/core/status-list-catalog.ts": "sha256:4ccbf551c74b16104476d703aa0e94060699ebf77dc836622df388cd04177896",
  "../designer/src/frames/site-frame/landing/core/types.ts": "sha256:9308206e5a674e77619c194036879591aaa784403feb12923cdb4bf7616cd38a",
  "../designer/src/frames/site-frame/landing/internal/assets.ts": "sha256:54cc0184672dfc74981225929705b024611926fd305a88374c1040605cffa3f8",
  "../designer/src/frames/site-frame/landing/internal/errors.ts": "sha256:19a0d6e258427849321149d4fb3cefe1d4122f8cbb82c224ba3349859783eaa4",
  "../designer/src/frames/site-frame/landing/internal/href.ts": "sha256:36c0690b4f606166f36ae1dd7a042674977126be921223e058d3df7346c096cc",
  "../designer/src/frames/site-frame/landing/internal/prose-text.ts": "sha256:2b608bac5f11fdfdf991ca27f89dc96a57a917066a81248c46d4ae0c98c71d85",
  "../designer/src/frames/site-frame/landing/web/types.ts": "sha256:bac4afa406c522c5ea14f663a90471130601006e625cd3479634c459d5f7aa47",
  "../designer/src/frames/site-frame/viewChromeGround.ts": "sha256:d5c430d26e272474f954f3fd42ed0f7175e0e483afaeb8352c131d46e6f50aa2"
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
