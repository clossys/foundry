import { describe, expect, it, vi } from "vitest";
import { publishTarget, type AppLocalEmitter, type PublishFinding } from "./publish.js";
import type { ProducerConfig } from "./config.js";

const config: ProducerConfig = {
  id: "example", archetype: "product", locales: { default: "en", supported: ["en"] },
  targets: { site: { app: "apps/site", format: "web.page.responsive", publication: "site" } },
};
function fixture(findings: PublishFinding[] = []) {
  const expected = { outDir: "/example/apps/site/src/clossys", appDir: "/example/apps/site", dependencies: {}, files: { "routes.ts": "export const routes = [];\n" } };
  const emitter: AppLocalEmitter = {
    emitAppLocal: vi.fn(async () => expected),
    writeAppLocal: vi.fn(async () => undefined),
    verifyAppLocal: vi.fn(async () => findings),
  };
  return { expected, emitter, dependencies: { config: async () => config, emitter: async () => emitter } };
}
describe("publish dispatch with an explicit mock app-local protocol", () => {
  it("dispatches only the selected resolved target and its confined generated folder", async () => {
    const f = fixture();
    const result = await publishTarget({ root: "/example", target: "site" }, f.dependencies);
    expect(result.exitCode).toBe(0);
    expect(f.emitter.emitAppLocal).toHaveBeenCalledExactlyOnceWith({ root: "/example", target: config.targets.site, outDir: "/example/apps/site/src/clossys" });
    expect(f.emitter.writeAppLocal).toHaveBeenCalledExactlyOnceWith("/example/apps/site/src/clossys", f.expected);
    expect(f.emitter.verifyAppLocal).not.toHaveBeenCalled();
  });
  it("checks in memory and never calls the writer", async () => {
    const f = fixture();
    expect(await publishTarget({ root: "/example", target: "site", check: true }, f.dependencies)).toMatchObject({ exitCode: 0, findings: [] });
    expect(f.emitter.verifyAppLocal).toHaveBeenCalledExactlyOnceWith("/example/apps/site/src/clossys", f.expected);
    expect(f.emitter.writeAppLocal).not.toHaveBeenCalled();
  });
  it.each(["missing", "stale", "hand-edit", "extra", "clossys-import"])("preserves the emitter's %s finding and returns verdict exit1", async kind => {
    const finding = { kind, path: "routes.ts", message: "Generated output does not match" };
    const f = fixture([finding]);
    expect(await publishTarget({ root: "/example", target: "site", check: true }, f.dependencies)).toMatchObject({ exitCode: 1, findings: [finding] });
    expect(f.emitter.writeAppLocal).not.toHaveBeenCalled();
  });
  it("refuses an unknown target before resolving or invoking an emitter", async () => {
    const f = fixture();
    const resolveEmitter = vi.fn(f.dependencies.emitter);
    await expect(publishTarget({ root: "/example", target: "other" }, { ...f.dependencies, emitter: resolveEmitter })).rejects.toThrow("Unknown publish target");
    expect(resolveEmitter).not.toHaveBeenCalled();
  });
  it("does not report successful checks from a malformed emitter protocol", async () => {
    const f = fixture();
    f.emitter.verifyAppLocal = vi.fn(async () => undefined as never);
    await expect(publishTarget({ root: "/example", target: "site", check: true }, f.dependencies)).rejects.toThrow("did not return findings");
  });
});
