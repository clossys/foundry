import { describe, expect, it, vi } from "vitest";
import type { ProducerConfig, ProducerTarget } from "./config.js";
import { publishTarget, type AppLocalEmitter, type PublishFinding } from "./publish.js";

const site: ProducerTarget = { app: "apps/site", format: "web.page.responsive", publication: "site" };
const preview = "/example/clossys/.producer/preview/site/src/clossys";
function fixture(targets: ProducerConfig["targets"] = { site }, findings: PublishFinding[] = []) {
  const config: ProducerConfig = {
    id: "example", archetype: "product", locales: { default: "en", supported: ["en"] }, targets,
  };
  const expected = {
    outDir: preview, appDir: "/example/apps/site", dependencies: {},
    files: { "routes.ts": "export const routes = [];\n" },
  };
  const emitter: AppLocalEmitter = {
    emitAppLocal: vi.fn(async () => expected),
    writeAppLocal: vi.fn(async () => undefined),
    verifyAppLocal: vi.fn(async () => findings),
  };
  return { expected, emitter, dependencies: { config: async () => config, emitter: vi.fn(async () => emitter) } };
}

describe("Producer preview publishing", () => {
  it("uses the sole configured web target while preserving its original app for native emission", async () => {
    const f = fixture();
    const result = await publishTarget({ root: "/example", target: "preview" }, f.dependencies);
    expect(result).toMatchObject({ target: "preview", output: preview, exitCode: 0 });
    expect(f.emitter.emitAppLocal).toHaveBeenCalledExactlyOnceWith({
      root: "/example", target: site, destination: "producer-preview", outDir: preview,
    });
    expect(f.emitter.writeAppLocal).toHaveBeenCalledExactlyOnceWith(preview, f.expected);
    expect(f.emitter.verifyAppLocal).toHaveBeenCalledExactlyOnceWith(preview, f.expected);
  });

  it("uses an explicit preview target even when other web targets exist", async () => {
    const selected = { ...site, app: "apps/specimen" };
    const f = fixture({ site, preview: selected, other: { ...site, app: "apps/other", publication: "other" } });
    await publishTarget({ root: "/example", target: "preview" }, f.dependencies);
    expect(f.emitter.emitAppLocal).toHaveBeenCalledWith(expect.objectContaining({ target: selected }));
  });

  it("does not mistake the internal Studio or non-web targets for a publication preview", async () => {
    const f = fixture({ site, studio: { ...site, app: "packages/producer/studio", publication: "studio" }, slides: { ...site, format: "deck.16x9" } });
    await publishTarget({ root: "/example", target: "preview" }, f.dependencies);
    expect(f.emitter.emitAppLocal).toHaveBeenCalledWith(expect.objectContaining({ target: site }));
  });

  it("refuses ambiguous web targets before loading or calling the emitter", async () => {
    const f = fixture({ site, other: { ...site, app: "apps/other", publication: "other" } });
    await expect(publishTarget({ root: "/example", target: "preview" }, f.dependencies)).rejects.toThrow(/preview|target/i);
    expect(f.dependencies.emitter).not.toHaveBeenCalled();
  });

  it("refuses preview when no web publication target is configured", async () => {
    const f = fixture({ studio: { ...site, app: "packages/producer/studio" }, slides: { ...site, format: "deck.16x9" } });
    await expect(publishTarget({ root: "/example", target: "preview" }, f.dependencies)).rejects.toThrow(/preview|target/i);
    expect(f.dependencies.emitter).not.toHaveBeenCalled();
  });

  it("does not fall back when an explicit preview target has an unsupported format", async () => {
    const f = fixture({ site, preview: { ...site, format: "deck.16x9" } });
    await expect(publishTarget({ root: "/example", target: "preview" }, f.dependencies)).rejects.toThrow(/web|format/i);
    expect(f.dependencies.emitter).not.toHaveBeenCalled();
  });

  it("checks the isolated output without invoking the writer", async () => {
    const f = fixture();
    expect(await publishTarget({ root: "/example", target: "preview", check: true }, f.dependencies)).toMatchObject({ exitCode: 0, output: preview });
    expect(f.emitter.verifyAppLocal).toHaveBeenCalledExactlyOnceWith(preview, f.expected);
    expect(f.emitter.writeAppLocal).not.toHaveBeenCalled();
  });

  it.each(["missing", "stale", "hand-edit", "extra"])("reports a preview %s finding without repairing output during check", async kind => {
    const finding = { kind, path: "routes.ts", message: "Preview output requires publication" };
    const f = fixture({ site }, [finding]);
    expect(await publishTarget({ root: "/example", target: "preview", check: true }, f.dependencies)).toMatchObject({ exitCode: 1, findings: [finding] });
    expect(f.emitter.writeAppLocal).not.toHaveBeenCalled();
  });

  it("continues to confine ordinary publish targets to their selected app", async () => {
    const f = fixture();
    const output = "/example/apps/site/src/clossys";
    const result = await publishTarget({ root: "/example", target: "site" }, f.dependencies);
    expect(result.output).toBe(output);
    expect(f.emitter.emitAppLocal).toHaveBeenCalledExactlyOnceWith({ root: "/example", target: site, outDir: output });
    expect(f.emitter.writeAppLocal).toHaveBeenCalledWith(output, f.expected);
  });
});
