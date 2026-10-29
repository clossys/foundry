import { describe, expect, it } from "vitest";
import { createOutputManifest, validateStrategyProvenance } from "./output-manifest.js";

const provenance = () => ({ contract: "publisher.launch", refs: [{ cell: "focus.reach.channel", version: 1 }], fingerprint: "sha256:fictional" });
describe("cell brief provenance", () => {
  it("validates and deep-copies the contract, cell refs and fingerprint", () => {
    const input = provenance();
    expect(validateStrategyProvenance(input)).toEqual({ ok: true, value: input });
    const manifest = createOutputManifest("fictional.page", "web", [], input);
    input.refs[0]!.version = 2;
    expect(manifest.provenance?.refs[0]?.version).toBe(1);
  });
  it("rejects legacy provenance with a migration diagnostic even when new fields are present", () => {
    const legacy = { strategyId: "fictional", revision: "1", records: [], fingerprint: "fictional" };
    for (const value of [legacy, { ...provenance(), ...legacy }]) {
      expect(validateStrategyProvenance(value)).toMatchObject({ ok: false, issues: [expect.objectContaining({ message: expect.stringMatching(/migrate.*contract.*refs/i) })] });
      expect(() => createOutputManifest("fictional.page", "web", [], value as never)).toThrow(/migrate.*contract.*refs/i);
    }
  });
  it.each([
    { ...provenance(), contract: "" }, { ...provenance(), fingerprint: "" },
    { ...provenance(), refs: [{ cell: "bad", version: 1 }] },
    ...[0, -1, 1.5, "1", Number.NaN].map(version => ({ ...provenance(), refs: [{ cell: "focus.reach.channel", version }] })),
    { ...provenance(), refs: [{ cell: "focus.reach.channel", version: 1, text: "content" }] },
    { ...provenance(), refs: [provenance().refs[0], provenance().refs[0]] },
    { ...provenance(), extra: true }, { ...provenance(), refs: null }, null,
  ])("refuses malformed metadata %#", value => expect(validateStrategyProvenance(value).ok).toBe(false));
});
