import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as atoms from "@clossys/designer/atoms";
import * as serverAtoms from "@clossys/designer/atoms/server";
import * as blocks from "@clossys/designer/blocks";
import * as shell from "@clossys/designer/shell";
import * as theme from "@clossys/designer/theme";
import * as client from "../client.js";
import { APP_FRAME_CONTRACT, APP_FRAME_CONFIG_SCHEMA } from "./app-frame-contract.js";

function assertFrozenData(value: unknown): void {
  if (value === null || typeof value !== "object") {
    expect(["string", "boolean", "number"].includes(typeof value) || value === null).toBe(true);
    if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Array.isArray(value) ? Array.prototype : Object.prototype);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    expect(descriptor).toHaveProperty("value");
    assertFrozenData(descriptor.value);
  }
}

describe("data-readable AppFrame contract", () => {
  it("describes the floating stage and page-owned header without granting qualification", () => {
    expect(APP_FRAME_CONTRACT.revision).toBe(2);
    expect(APP_FRAME_CONFIG_SCHEMA).toHaveProperty(["page.width"], { values: ["contained", "full"], default: "contained" });
    expect(APP_FRAME_CONFIG_SCHEMA).toHaveProperty("width", { values: ["contained", "full"], default: null });
    expect(APP_FRAME_CONTRACT.behavior.responsiveQuery).toBe("(min-width: 56.25rem)");
    expect(APP_FRAME_CONTRACT.hostInputs).toEqual(expect.arrayContaining(["page.title", "page.breadcrumb", "page.actions", "page.scope", "workspaces"]));
    expect(APP_FRAME_CONTRACT.statePorts).toEqual(expect.arrayContaining(["width", "onWidthChange"]));
    expect(APP_FRAME_CONTRACT.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "bar", content: "brand, page and width control" }),
      expect.objectContaining({ key: "page-info", required: false, content: "page.status, description, updatedAt, meta and scope" }),
    ]));
  });
  it("describes the real browser export without granting role qualification", () => {
    expect(client.APP_FRAME_CONTRACT).toBe(APP_FRAME_CONTRACT);
    expect(client.APP_FRAME_CONFIG_SCHEMA).toBe(APP_FRAME_CONFIG_SCHEMA);
    expect(client.AppFrame).toBeTypeOf("function");
    expect(APP_FRAME_CONTRACT).toMatchObject({
      identity: "app-frame", role: "frame", medium: "web", revision: 2,
      adapter: { owner: "@clossys/publisher", subpath: "web/client", export: "AppFrame" },
      qualification: { status: "unverified", reasons: ["measurement-required"] },
    });
    expect(APP_FRAME_CONTRACT).not.toHaveProperty("evidence");
    expect(APP_FRAME_CONTRACT).not.toHaveProperty("sourceRevision");
    const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(packageJson.exports["./web/client"].import).toBe("./dist/web/client.js");
    for (const path of ["./index.ts", "../index.ts", "../server.ts"]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8")).not.toMatch(/AppFrame|app-frame/);
    }
  });

  it("is deeply frozen plain serializable data with finite, truthful configuration", () => {
    assertFrozenData(APP_FRAME_CONTRACT);
    expect(JSON.parse(JSON.stringify(APP_FRAME_CONTRACT))).toEqual(APP_FRAME_CONTRACT);
    expect(APP_FRAME_CONTRACT.config).toBe(APP_FRAME_CONFIG_SCHEMA);
    expect(APP_FRAME_CONFIG_SCHEMA).toEqual({
      "page.width": { values: ["contained", "full"], default: "contained" },
      width: { values: ["contained", "full"], default: null },
      contentLayout: { values: ["standard", "immersive"], default: "standard" },
      "brand.markInk": { values: ["accent", "image"], default: "accent" },
      "commands.shortcutEnabled": { values: [false, true], default: true },
      "navigation.defaultCollapsed": { values: [false, true], default: false },
      "rightPanel.defaultCollapsed": { values: [false, true], default: false },
      "theme.defaultPreference": { values: ["system", "light", "dark"], default: "system" },
      dir: { values: ["ltr", "rtl"], default: null, omission: "inherit document direction" },
    });
    expect(APP_FRAME_CONTRACT.defaults).toMatchObject({ skipLabel: "Skip to content", themeStorageKey: "ui-theme", rightPanelOpenLabel: "Open panel", rightPanelCloseLabel: "Close panel" });
    expect(APP_FRAME_CONTRACT).not.toHaveProperty("normalization");
    expect(APP_FRAME_CONFIG_SCHEMA).not.toHaveProperty("main");
    expect(APP_FRAME_CONFIG_SCHEMA).not.toHaveProperty("skipLink");
  });

  it("records the actual server Logomark import used by the home mark", () => {
    const source = readFileSync(new URL("./AppFrameBrand.tsx", import.meta.url), "utf8");
    expect(source).toContain('import { Logomark } from "@clossys/designer/atoms/server"');
    expect(APP_FRAME_CONTRACT.constituents).toContainEqual({ owner: "@clossys/designer", subpath: "atoms/server", export: "Logomark" });
  });

  it("names actual Designer public exports used by the composition", () => {
    const exportsBySubpath: Record<string, Record<string, unknown>> = { atoms, "atoms/server": serverAtoms, blocks, shell, theme };
    expect(APP_FRAME_CONTRACT.constituents.map(part => part.export)).toEqual(expect.arrayContaining([
      "AppNavigation", "AccountMenu", "Menu", "CommandMenu", "useCommandMenuShortcut", "ResizablePane", "Drawer", "ThemeProvider", "ThemeToggle", "SkipLink",
    ]));
    for (const part of APP_FRAME_CONTRACT.constituents) {
      expect(part.owner).toBe("@clossys/designer");
      expect(exportsBySubpath[part.subpath]?.[part.export]).toBeDefined();
      expect(part).not.toHaveProperty("qualified");
    }
  });

  it("inventories named regions, host ports, required behavior and its source-backed specimen", () => {
    expect(APP_FRAME_CONTRACT.regions.map(region => region.key)).toEqual(["bar", "page-info", "navigation", "account", "main", "right-panel"]);
    expect(APP_FRAME_CONTRACT.regions.find(region => region.key === "main")).toMatchObject({ required: true, content: "children" });
    expect(APP_FRAME_CONTRACT.regions.find(region => region.key === "right-panel")).toMatchObject({ required: false, content: "rightPanel.children" });
    expect(APP_FRAME_CONTRACT.hostInputs).toEqual(expect.arrayContaining(["brand", "navigation.tree", "account.sections", "account.signedOutLabel", "commands.groups", "children"]));
    expect(APP_FRAME_CONTRACT.required).toEqual(expect.arrayContaining([
      "sole-main", "skip-target", "bottom-account-menu", "signed-out-without-actor", "host-command-index", "command-shortcut", "persisted-three-state-theme", "mobile-navigation-drawer", "resizable-right-panel", "collapsible-right-panel", "narrow-right-panel-drawer", "rtl", "forced-colors", "small-accent-home-mark", "brand-rooted-breadcrumb", "page-owned-heading", "original-image-opt-out",
    ]));
    expect(APP_FRAME_CONTRACT.specimen).toEqual({ owner: "@clossys/publisher", subpath: "web/client", export: "AppFrameSpecimen", source: "src/web/frame/AppFrame.specimen.tsx" });
    expect(client.AppFrameSpecimen).toBeTypeOf("function");
    const specimenSource = readFileSync(new URL("./AppFrame.specimen.tsx", import.meta.url), "utf8");
    expect(specimenSource).toMatch(/export function AppFrameSpecimen/);
    expect(specimenSource).toMatch(/<AppFrame\b/);
  });
});
