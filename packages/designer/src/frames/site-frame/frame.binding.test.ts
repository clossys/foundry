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
    'const target = import.meta.resolve("#designer-frame-navigation"); const web = await import("@clossys/designer/frames"); const errors = await import("@clossys/designer/frames/error"); console.log(JSON.stringify({ target, frame: typeof web.SiteFrame, auth: typeof web.AuthFrame, app: "AppFrame" in web, sameError: web.RenderError === errors.RenderError, errorInstance: new web.RenderError("resolution-failed", "fixture") instanceof errors.RenderError }));',
  ], { cwd: resolve(import.meta.dirname, "../../.."), encoding: "utf8" });
  expect(probe.status, probe.stderr).toBe(0);
  const observed = JSON.parse(probe.stdout);
  expect(observed.target).toMatch(condition === "react-server" ? /NavDisclosure\.server\.js$/ : /NavDisclosure\.client\.js$/);
  expect(observed.frame).toBe("function");
  expect(observed.auth).toBe("function");
  expect(observed.app).toBe(true);
  expect(observed.sameError).toBe(true);
  expect(observed.errorInstance).toBe(true);
});
