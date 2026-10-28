// @vitest-environment node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Designer's existing Vitest globalSetup compiles dist once before test files.
// Probe that build through real package resolution, including the public export.
it.each(["default", "react-server"])("resolves the actual %s navigation binding and imports the public frame", condition => {
  const probe = spawnSync(process.execPath, [
    ...(condition === "react-server" ? ["--conditions=react-server"] : []),
    "--input-type=module", "--eval",
    'const target = import.meta.resolve("#designer-frame-navigation"); const web = await import("@clossys/designer/frames"); console.log(JSON.stringify({ target, frame: typeof web.SiteFrame }));',
  ], { cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8" });
  expect(probe.status, probe.stderr).toBe(0);
  const observed = JSON.parse(probe.stdout);
  expect(observed.target).toMatch(condition === "react-server" ? /NavDisclosure\.server\.js$/ : /NavDisclosure\.client\.js$/);
  expect(observed.frame).toBe("function");
});
