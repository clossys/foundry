import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as components from "../components/index.js";
import * as serverComponents from "../components/server.js";
import * as blocks from "../blocks/index.js";
import * as shell from "../shell/index.js";
import * as theme from "../theme/index.js";
import * as client from "./index.js";
import { APP_FRAME_CONTRACT, APP_FRAME_CONFIG_SCHEMA } from "./app-frame-contract.js";
import { APP_FRAME_WIDE_QUERY } from "./app-frame-layout.js";

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
  it("describes reserved frame regions and host header ports without granting qualification", () => {
    expect(APP_FRAME_CONTRACT.revision).toBe(2);
    expect(APP_FRAME_CONFIG_SCHEMA).not.toHaveProperty("page.width");
    expect(APP_FRAME_CONFIG_SCHEMA).not.toHaveProperty("width");
    expect(APP_FRAME_CONTRACT.behavior.responsiveQuery).toBe(APP_FRAME_WIDE_QUERY);
    expect(APP_FRAME_CONTRACT.hostInputs).toEqual(expect.arrayContaining(["header", "onNavigate", "notices", "dock", "context", "page.title", "page.breadcrumb", "page.actions", "page.scope", "workspaces"]));
    expect(APP_FRAME_CONTRACT.statePorts).toEqual(expect.arrayContaining(["rightPanel.value", "rightPanel.onChange"]));
    expect(APP_FRAME_CONTRACT.statePorts).not.toContain("onWidthChange");
    expect(APP_FRAME_CONTRACT.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "bar", content: "title, centered navigation and actions" }),
      expect.objectContaining({ key: "page-info", required: false, content: "page.status, description, updatedAt, meta and scope" }),
    ]));
  });
  it("describes the real browser export without granting role qualification", () => {
    expect(client.APP_FRAME_CONTRACT).toBe(APP_FRAME_CONTRACT);
    expect(client.APP_FRAME_CONFIG_SCHEMA).toBe(APP_FRAME_CONFIG_SCHEMA);
    expect(client.AppFrame).toBeTypeOf("function");
    expect(APP_FRAME_CONTRACT).toMatchObject({
      identity: "app-frame", role: "frame", medium: "web", revision: 2,
      adapter: { owner: "@clossys/designer", subpath: "frames", export: "AppFrame" },
      qualification: { status: "unverified", reasons: ["measurement-required"] },
    });
    expect(APP_FRAME_CONTRACT).not.toHaveProperty("evidence");
    expect(APP_FRAME_CONTRACT).not.toHaveProperty("sourceRevision");
    const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"));
    expect(packageJson.exports["./frames"].import).toBe("./dist/frames/index.js");
    expect(readFileSync(resolve(import.meta.dirname, "../../../publisher/src/web/client.ts"), "utf8")).not.toMatch(/export[^;]*\b(?:AppFrame|AppFrameProps|APP_FRAME_CONTRACT)\b/);
    for (const path of ["../components/index.ts", "../blocks/index.ts", "../shell/index.ts"]) {
      expect(readFileSync(resolve(import.meta.dirname, path), "utf8")).not.toMatch(/export(?: type)?\s*\{[^}]*\b(?:AppFrame|AppFrameProps|APP_FRAME_CONTRACT)\b/);
    }
  });

  it("is deeply frozen plain serializable data with finite, truthful configuration", () => {
    assertFrozenData(APP_FRAME_CONTRACT);
    expect(JSON.parse(JSON.stringify(APP_FRAME_CONTRACT))).toEqual(APP_FRAME_CONTRACT);
    expect(APP_FRAME_CONTRACT.config).toBe(APP_FRAME_CONFIG_SCHEMA);
    expect(APP_FRAME_CONFIG_SCHEMA).toEqual({
      headerPosition: { values: ["sticky", "static"], default: null, omission: "legacy floating sticky bar" },
      headerSurface: { values: ["solid", "transparent", "glass"], default: null, omission: "legacy adaptive bar paint" },
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

  it("records the actual Avatar and slot provider used by the frame", () => {
    const source = readFileSync(resolve(import.meta.dirname, "./AppFrame.tsx"), "utf8");
    expect(source).toContain("<Avatar");
    expect(source).toContain("<FrameSlotProvider>");
    expect(APP_FRAME_CONTRACT.constituents).toContainEqual({ owner: "@clossys/designer", subpath: "components", export: "Avatar" });
    expect(APP_FRAME_CONTRACT.constituents).toContainEqual({ owner: "@clossys/designer", subpath: "shell", export: "FrameSlotProvider" });
  });

  it("names actual Designer public exports used by the composition", () => {
    const exportsBySubpath: Record<string, Record<string, unknown>> = { components, "components/server": serverComponents, blocks, shell, theme };
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
    expect(APP_FRAME_CONTRACT.regions.map(region => region.key)).toEqual(["bar", "page-info", "navigation", "account", "main", "right-panel", "dock"]);
    expect(APP_FRAME_CONTRACT.regions.find(region => region.key === "main")).toMatchObject({ required: true, content: "children" });
    expect(APP_FRAME_CONTRACT.regions.find(region => region.key === "right-panel")).toMatchObject({ required: false, content: "rightPanel.children" });
    expect(APP_FRAME_CONTRACT.hostInputs).toEqual(expect.arrayContaining(["brand", "navigation.tree", "account.sections", "account.signedOutLabel", "commands.groups", "children"]));
    expect(APP_FRAME_CONTRACT.required).toEqual(expect.arrayContaining([
      "sole-main", "skip-target", "bottom-account-menu", "signed-out-without-actor", "host-command-index", "command-shortcut", "persisted-three-state-theme", "mobile-navigation-drawer", "resizable-right-panel", "collapsible-right-panel", "narrow-right-panel-drawer", "rtl", "forced-colors", "profile-avatar-mark", "host-rooted-breadcrumb", "page-owned-heading", "positioned-isolated-stage", "page-header-slots",
    ]));
    expect(APP_FRAME_CONTRACT.specimen).toEqual({ owner: "@clossys/designer", subpath: "frames", export: "AppFrameSpecimen", source: "src/frames/AppFrame.specimen.tsx" });
    expect(client.AppFrameSpecimen).toBeTypeOf("function");
    const specimenSource = readFileSync(resolve(import.meta.dirname, "./AppFrame.specimen.tsx"), "utf8");
    expect(specimenSource).toMatch(/export function AppFrameSpecimen/);
    expect(specimenSource).toMatch(/<AppFrame\b/);
  });
});
