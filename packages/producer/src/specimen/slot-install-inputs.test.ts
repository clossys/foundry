import { mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../records/hash.js";
import { candidatesDir, iaPath, jsonBytes, pinFile, slotDir, slotFile, slotPositions, type IaDoc } from "../records/slot-model/index.js";
import { slotInstallInputs } from "./slot-install-inputs.js";

let root: string;
const ia: IaDoc = { schema: "clossys.ia/1", source: "consumer#fixture", extensions: [], nodes: [{ id: "components.content", label: "Content", children: [{ id: "cards", label: "Cards", slots: ["components.card", "components.button", "components.empty"] }] }] };
const dir = (slot = "components.card") => slotDir(root, "designer", slot);
const put = (path: string, bytes: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
function candidate(element = "card", version = 1, slot = "components.card", content = "export default function Card() { return null; }") {
  const bytes = jsonBytes({ name: element, type: "registry:component", files: [{ path: `${element}.tsx`, type: "registry:component", content }], meta: { source: { kind: "original", ref: [] }, element: { id: element, slot } } });
  put(join(candidatesDir(dir(slot)), `${element}-v${version}.json`), bytes);
  return bytes;
}
function pin(name = "card-v1.json", bytes = readFileSync(join(candidatesDir(dir()), name), "utf8")) {
  put(pinFile(dir()), jsonBytes({ candidate: name, sha256: sha256Hex(bytes), decidedBy: "migrated", basis: "bulk", at: "2026-10-31T00:00:00Z" }));
}
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-inputs-")));
  put(iaPath(root, "designer"), jsonBytes(ia));
  for (const [id, position] of slotPositions("designer", ia)) put(slotFile(dir(id)), jsonBytes({ schema: "clossys.slot/1", id, agent: "designer", kind: "element", ia: position, contract: {}, inputs: [], uses: [] }));
  candidate(); pin(); candidate("card", 2);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installed specimen input projection", () => {
  it("uses exact native current pins and offers every other valid candidate as a preview option", () => {
    const inputs = slotInstallInputs(root)!;
    expect(inputs.pins).toEqual({ "components.card": { element: "card", version: 1 } });
    expect([...inputs.options]).toEqual([["components.card", [{ element: "card", version: 2 }]]]);
    expect(inputs.unpinned).toEqual({});
    expect(slotInstallInputs(root)).toEqual(inputs);
    // Older, newer and other-element candidates all preview; only the pin is installed.
    candidate("card", 3); candidate("variant", 4); pin("card-v2.json");
    const repinned = slotInstallInputs(root)!;
    expect(repinned.pins).toEqual({ "components.card": { element: "card", version: 2 } });
    expect(repinned.options.get("components.card")).toEqual(expect.arrayContaining([{ element: "card", version: 1 }, { element: "card", version: 3 }, { element: "variant", version: 4 }]));
    expect(repinned.options.get("components.card")).toHaveLength(3);
  });

  it("marks candidates whose code imports a host package as host-only, keyed by slot, element and version", () => {
    candidate("card", 3, "components.card", 'import { Badge } from "@clossys/designer-ui/badge";\nimport x from "react";\nexport default function Card() { return Badge; }');
    const inputs = slotInstallInputs(root)!;
    expect([...inputs.hostOnly]).toEqual([["components.card/card@v3", ["@clossys/designer-ui"]]]);
  });

  it("fingerprints actual candidate bytes stably even when versions do not change", () => {
    const first = slotInstallInputs(root)!;
    expect(slotInstallInputs(root)!.fingerprint).toBe(first.fingerprint);
    candidate("card", 2, "components.card", "export default function Card() { return 'new draft'; }");
    const changed = slotInstallInputs(root)!;
    expect(changed.pins).toEqual(first.pins);
    expect(changed.options).toEqual(first.options);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it.each(["malformed", "missing-candidate", "hash-drift", "invalid-candidate", "identity", "position"])("rejects %s native pins without selecting a newer draft", kind => {
    if (kind === "malformed") put(pinFile(dir()), "{}");
    if (kind === "missing-candidate") rmSync(join(candidatesDir(dir()), "card-v1.json"));
    if (kind === "hash-drift") candidate("card", 1, "components.card", "changed bytes");
    if (kind === "invalid-candidate") { put(join(candidatesDir(dir()), "card-v1.json"), "{}"); pin(); }
    if (kind === "identity") { const item = JSON.parse(readFileSync(join(candidatesDir(dir()), "card-v1.json"), "utf8")); item.name = "other"; put(join(candidatesDir(dir()), "card-v1.json"), jsonBytes(item)); pin(); }
    if (kind === "position") { const doc = JSON.parse(readFileSync(slotFile(dir()), "utf8")); doc.ia.order += 1; put(slotFile(dir()), jsonBytes(doc)); }
    expect(() => slotInstallInputs(root)).toThrow(/Specimen slot/);
  });

  it("keeps absent pins out of current selection, previews every valid candidate and only supplies singleton unpinned elements as stand-ins", () => {
    rmSync(pinFile(dir()));
    candidate("button", 1, "components.button"); candidate("alternative", 3, "components.button");
    put(join(candidatesDir(dir()), "card-v3.json"), "{}");
    put(join(candidatesDir(dir("components.empty")), "invalid-v1.json"), "{}");
    const inputs = slotInstallInputs(root)!;
    expect(inputs.pins).toEqual({});
    expect(inputs.options.get("components.card")).toEqual([{ element: "card", version: 1 }, { element: "card", version: 2 }]);
    expect(inputs.options.get("components.button")).toEqual(expect.arrayContaining([{ element: "alternative", version: 3 }, { element: "button", version: 1 }]));
    expect([...inputs.options.keys()].sort()).toEqual(["components.button", "components.card"]);
    expect(inputs.unpinned).toEqual({ "components.card": { element: "card", version: 2 } });
  });

  it("only offers valid candidates in IA with matching element identity", () => {
    candidate("other", 3);
    const item = JSON.parse(candidate("card", 4)); item.meta.element.slot = "components.button";
    put(join(candidatesDir(dir()), "card-v4.json"), jsonBytes(item));
    put(join(candidatesDir(dir()), "card-v5.json"), "{}");
    mkdirSync(join(root, "agents/designer/orphan/candidates"), { recursive: true });
    put(join(root, "agents/designer/orphan/candidates/card-v1.json"), readFileSync(join(candidatesDir(dir()), "card-v1.json"), "utf8"));
    expect(slotInstallInputs(root)!.options.get("components.card")).toEqual([{ element: "card", version: 2 }, { element: "other", version: 3 }]);
    expect(slotInstallInputs(root)!.unpinned).toEqual({});
  });

  it("has no inputs when no IA exists", () => {
    rmSync(join(root, "agents"), { recursive: true });
    expect(slotInstallInputs(root)).toBeUndefined();
  });
});
