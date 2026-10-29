// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import legacy from "./__fixtures__/rail-legacy-inventory.test.json" with { type: "json" };
import { sha256 } from "./digest.js";
import { loadBuildCatalog } from "./index.js";
import { importShadcnAriaRail } from "../importers/shadcn-aria-rail.js";

const contractChanges = {
  "components.grid-list": {
    "addedTokens": [
      "tokens.action-color",
      "tokens.border-width",
      "tokens.control-radius",
      "tokens.duration",
      "tokens.easing",
      "tokens.focus-color",
      "tokens.focus-outline",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.line-height"
    ]
  },
  "components.link": {
    "addedTokens": [
      "tokens.border-width",
      "tokens.caption-size",
      "tokens.control-size",
      "tokens.duration",
      "tokens.font-size",
      "tokens.font-weight"
    ]
  },
  "components.native-action": {
    "addedTokens": [
      "tokens.accent-color",
      "tokens.border-color",
      "tokens.border-width",
      "tokens.control-color",
      "tokens.control-size",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.status-color",
      "tokens.surface-color",
      "tokens.caption-size"
    ]
  },
  "components.search-field": {
    "addedTokens": [
      "tokens.action-color",
      "tokens.border-width",
      "tokens.control-color",
      "tokens.duration",
      "tokens.easing",
      "tokens.elevation",
      "tokens.focus-color",
      "tokens.focus-outline",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.radius",
      "tokens.line-height"
    ],
    "originalMembers": {
      "mode": "closed",
      "names": [
        "part.clear",
        "part.submit",
        "state.empty",
        "state.filled"
      ]
    }
  },
  "components.status-mark": {
    "addedTokens": [
      "tokens.accent-color",
      "tokens.action-color",
      "tokens.border-color",
      "tokens.border-width",
      "tokens.control-color",
      "tokens.duration",
      "tokens.easing",
      "tokens.focus-color",
      "tokens.focus-outline",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.surface-color"
    ]
  },
  "components.tag-group": {
    "addedTokens": [
      "tokens.action-color",
      "tokens.border-color",
      "tokens.border-width",
      "tokens.control-color",
      "tokens.control-radius",
      "tokens.duration",
      "tokens.easing",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.status-color"
    ]
  },
  "components.text-field": {
    "addedTokens": [
      "tokens.border-width",
      "tokens.duration",
      "tokens.easing",
      "tokens.focus-color",
      "tokens.focus-outline",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.line-height"
    ],
    "originalMembers": {
      "mode": "closed",
      "names": [
        "line.single-line",
        "line.multiline",
        "state.invalid",
        "state.disabled",
        "state.read-only",
        "size.sm",
        "size.md",
        "size.lg"
      ]
    }
  },
  "components.toast": {
    "addedTokens": [
      "tokens.z-index",
      "tokens.border-color",
      "tokens.border-width",
      "tokens.control-radius",
      "tokens.font-size",
      "tokens.spacing",
      "tokens.surface-color",
      "tokens.text-color",
      "tokens.typeface"
    ]
  },
  "components.toolbar": {
    "addedTokens": [
      "tokens.border-width",
      "tokens.control-radius",
      "tokens.font-size",
      "tokens.font-weight",
      "tokens.surface-color",
      "tokens.z-index"
    ]
  }
} as const;
const consumedComponents = ["text-field", "search-field", "tag-group", "toolbar", "link", "native-action", "toast", "status-mark", "grid-list"];
const addedComponents = ["command", "dropdown-menu", "empty", "item", "scroll-area", "sheet", "sidebar"];
const addedIds = ["assets.icon-panel-left", ...addedComponents.map(leaf => `components.${leaf}`)];
const directory = join(import.meta.dirname, "../catalog/fills/shadcn@aria");

it("joins exactly eight rail registrations to the byte-equivalent ordered original slot rows", () => {
  const current = loadBuildCatalog().slots;
  expect(current.filter(slot => addedIds.includes(slot.id)).map(slot => slot.id).sort()).toEqual([...addedIds].sort());
  for (const row of legacy.slots) {
    const rows = JSON.parse(readFileSync(join(import.meta.dirname, `../catalog/slots/${row.layer}.json`), "utf8")) as { id: string }[];
    const previous = rows.filter(slot => !addedIds.includes(slot.id));
    expect(previous.map(slot => slot.id), row.layer).toEqual(row.ids);
    if (row.layer === "components") {
      const reconstructed = previous.map(slot => {
        const change = contractChanges[slot.id as keyof typeof contractChanges];
        if (!change) return slot;
        const contract = slot.contract;
        return { ...slot, contract: { ...contract,
          members: "originalMembers" in change ? change.originalMembers : contract.members,
          allowedReads: { ...contract.allowedReads, tokens: contract.allowedReads.tokens.filter(token => !change.addedTokens.includes(token as never)) },
        } };
      });
      // Reversing only the enumerated A148/A149 reads and two authorized member narrowings recovers every original byte/order.
      expect(sha256(JSON.stringify(reconstructed)), row.layer).toBe(row.rowsSha256);
    } else expect(sha256(JSON.stringify(previous)), row.layer).toBe(row.rowsSha256);
    expect(rows.map(slot => slot.id)).toEqual(current.filter(slot => slot.layer === row.layer).map(slot => slot.id));
  }
  expect(current).toHaveLength(legacy.slots.reduce((count, row) => count + row.ids.length, 0) + addedIds.length);
  expect(new Set(current.map(slot => slot.id)).size).toBe(current.length);
});

it("authenticates the full current descriptor inventory with unchanged original bytes plus seven generated offers", () => {
  const offerIds = [...addedComponents, ...consumedComponents].map(leaf => `components.${leaf}`);
  const generated = importShadcnAriaRail().fills.filter(doc => offerIds.includes(doc.$extensions["com.clossys.fill"].slot));
  expect(generated.map(doc => doc.$extensions["com.clossys.fill"].slot).sort()).toEqual([...addedComponents, ...consumedComponents].map(leaf => `components.${leaf}`).sort());
  const additions = generated.map(doc => {
    const name = `${doc.$extensions["com.clossys.fill"].slot}.json`;
    const bytes = JSON.stringify(doc, null, 2) + "\n";
    expect(readFileSync(join(directory, name), "utf8")).toBe(bytes);
    return { name, sha256: sha256(bytes) };
  });
  for (const row of legacy.descriptors) expect(sha256(readFileSync(join(directory, row.name), "utf8")), row.name).toBe(row.sha256);
  const current = readdirSync(directory).filter(name => /^components\..*\.json$/.test(name)).sort();
  // Nine retained offers extend the inventory; parked proposals contribute no descriptor.
  const combined = [...legacy.descriptors, ...additions].sort((a, b) => a.name.localeCompare(b.name));
  expect(current).toEqual(combined.map(row => row.name));
  const currentHash = sha256(current.map(name => `${name}\n${sha256(readFileSync(join(directory, name), "utf8"))}\n`).join(""));
  expect(currentHash).toBe(sha256(combined.map(row => `${row.name}\n${row.sha256}\n`).join("")));
});
