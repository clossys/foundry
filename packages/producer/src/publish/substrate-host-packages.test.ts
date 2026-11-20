import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSubstrateDependencies } from "./install.js";

// Host packages (`@clossys/*`) are vendored tarballs, not on npm. Declaring one in the specimen
// substrate made every `npm install` there 404, so every layer failed and was rebuilt on each start.
let substrate: string;
const installed = (name: string) => { mkdirSync(join(substrate, "node_modules", ...name.split("/")), { recursive: true }); writeFileSync(join(substrate, "node_modules", ...name.split("/"), "package.json"), "{}"); };
const manifest = () => JSON.parse(readFileSync(join(substrate, "package.json"), "utf8"));
beforeEach(() => {
  substrate = mkdtempSync(join(tmpdir(), "substrate-host-"));
  mkdirSync(join(substrate, "src"), { recursive: true });
  writeFileSync(join(substrate, "src", "flow.tsx"), 'import { Badge } from "@clossys/designer-ui/badge";\nimport * as React from "react";\nexport default () => React.createElement(Badge);\n');
  installed("react");
});
afterEach(() => rmSync(substrate, { recursive: true, force: true }));

describe("substrate dependencies and host packages", () => {
  it("never declares a host package an installed file imports, and runs no install for it", async () => {
    writeFileSync(join(substrate, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    const calls: (readonly string[])[] = [];
    const finding = await ensureSubstrateDependencies(substrate, { "@clossys/designer-ui": "latest" }, async args => { calls.push(args); return { code: 1, stdout: "", stderr: "404 Not Found" }; });
    expect(finding).toBeUndefined();
    expect(calls).toEqual([]);
    expect(manifest().dependencies).toEqual({ react: "^19.0.0" });
  });

  it("drops a host package an earlier scan declared as latest, so the substrate installs again", async () => {
    writeFileSync(join(substrate, "package.json"), JSON.stringify({ dependencies: { "@clossys/designer-ui": "latest", react: "^19.0.0" } }));
    const finding = await ensureSubstrateDependencies(substrate, {}, async () => ({ code: 1, stdout: "", stderr: "404 Not Found" }));
    expect(finding).toBeUndefined();
    expect(manifest().dependencies).toEqual({ react: "^19.0.0" });
  });

  it("reads no package name out of the substrate's own build output, so a rebuild of the same pins installs nothing", async () => {
    writeFileSync(join(substrate, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    // vite's minified output under dist/: an import scan over it reads fragments such as `:[{from:j()}],` as packages.
    mkdirSync(join(substrate, "dist", "assets"), { recursive: true });
    writeFileSync(join(substrate, "dist", "assets", "index-x.js"), 'const a={o:[{from:j()}],};import"./b.js";const c=require(":[{from:j()}],");import d from "left-pad";\n');
    const calls: (readonly string[])[] = [];
    const finding = await ensureSubstrateDependencies(substrate, {}, async args => { calls.push(args); return { code: 1, stdout: "", stderr: "EINVALIDPACKAGENAME" }; });
    expect(finding).toBeUndefined();
    expect(calls).toEqual([]);
    expect(manifest().dependencies).toEqual({ react: "^19.0.0" });
  });
});
