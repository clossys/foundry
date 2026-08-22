import { describe, expect, it } from "vitest";
import { probeReachability, resolveReachability, type ProbeOutcome, type Transport } from "./reachability.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("probeReachability", () => {
  it("resolves a known package from dist-tags.latest", async () => {
    const transport: Transport = async () => jsonResponse(200, { "dist-tags": { latest: "2.4.0" } });
    const outcomes = await probeReachability(["@example-scope/one"], { transport, registryBaseUrl: "https://registry.example/" });
    expect(outcomes.get("@example-scope/one")).toEqual({ kind: "known", latestVersion: "2.4.0" });
  });

  it("requests the npm-style scoped path with the slash percent-encoded and the @ literal", async () => {
    const requested: (string | URL)[] = [];
    const transport: Transport = async (input) => {
      requested.push(input);
      return jsonResponse(200, { "dist-tags": { latest: "1.0.0" } });
    };
    await probeReachability(["@example-scope/one"], { transport, registryBaseUrl: "https://registry.example" });
    expect(String(requested[0])).toBe("https://registry.example/@example-scope%2Fone");
  });

  it("reports not-found for a 404", async () => {
    const transport: Transport = async () => new Response(null, { status: 404 });
    const outcomes = await probeReachability(["@example-scope/one"], { transport, registryBaseUrl: "https://registry.example/" });
    expect(outcomes.get("@example-scope/one")).toEqual({ kind: "not-found" });
  });

  it("reports denied for a 401 or a 403", async () => {
    const transport401: Transport = async () => new Response(null, { status: 401 });
    const transport403: Transport = async () => new Response(null, { status: 403 });
    expect((await probeReachability(["a"], { transport: transport401, registryBaseUrl: "https://registry.example/" })).get("a")).toEqual({ kind: "denied" });
    expect((await probeReachability(["a"], { transport: transport403, registryBaseUrl: "https://registry.example/" })).get("a")).toEqual({ kind: "denied" });
  });

  it("reports unreachable for a server error, a malformed body, or a thrown transport failure", async () => {
    const serverError: Transport = async () => new Response(null, { status: 503 });
    const malformed: Transport = async () => new Response("not json", { status: 200 });
    const noLatest: Transport = async () => jsonResponse(200, { "dist-tags": {} });
    const throws: Transport = async () => {
      throw new Error("network down");
    };
    for (const transport of [serverError, malformed, noLatest, throws]) {
      const outcomes = await probeReachability(["a"], { transport, registryBaseUrl: "https://registry.example/" });
      expect(outcomes.get("a")).toEqual({ kind: "unreachable" });
    }
  });

  it("probes every name independently, even when one throws", async () => {
    const transport: Transport = async (input) => {
      if (String(input).includes("bad")) throw new Error("boom");
      return jsonResponse(200, { "dist-tags": { latest: "1.0.0" } });
    };
    const outcomes = await probeReachability(["good", "bad"], { transport, registryBaseUrl: "https://registry.example/" });
    expect(outcomes.get("good")).toEqual({ kind: "known", latestVersion: "1.0.0" });
    expect(outcomes.get("bad")).toEqual({ kind: "unreachable" });
  });
});

describe("resolveReachability", () => {
  function outcomes(entries: Record<string, ProbeOutcome>): ReadonlyMap<string, ProbeOutcome> {
    return new Map(Object.entries(entries));
  }

  it("passes known and denied through unchanged", () => {
    const resolved = resolveReachability(outcomes({ a: { kind: "known", latestVersion: "1.0.0" }, b: { kind: "denied" } }));
    expect(resolved.get("a")).toEqual({ kind: "known", latestVersion: "1.0.0" });
    expect(resolved.get("b")).toEqual({ kind: "unauthenticated" });
  });

  it("never reclassifies a transport-level unreachable as an auth problem", () => {
    const resolved = resolveReachability(outcomes({ a: { kind: "unreachable" }, b: { kind: "known", latestVersion: "1.0.0" } }));
    expect(resolved.get("a")).toEqual({ kind: "unreachable" });
  });

  it("resolves every not-found as unauthenticated when NOTHING in the batch came back known -- the aggregate signal", () => {
    const resolved = resolveReachability(outcomes({ a: { kind: "not-found" }, b: { kind: "not-found" } }));
    expect(resolved.get("a")).toEqual({ kind: "unauthenticated" });
    expect(resolved.get("b")).toEqual({ kind: "unauthenticated" });
  });

  // This test's previous name said it all: "leaves a lone not-found genuinely
  // undecided -- unreachable". It called the case undecided and then asserted
  // a transport failure, because the vocabulary had no word for undecided and
  // the nearest neighbour was borrowed. A caller could not tell "the registry
  // could not be reached" from "the registry was reached and said no".
  it("says INDETERMINATE for a lone not-found once the batch proves the credential works -- never unreachable, which asserts a failure that did not happen", () => {
    const resolved = resolveReachability(outcomes({ a: { kind: "known", latestVersion: "1.0.0" }, b: { kind: "not-found" } }));
    expect(resolved.get("a")).toEqual({ kind: "known", latestVersion: "1.0.0" });
    expect(resolved.get("b")).toEqual({ kind: "indeterminate", reason: "not-found-with-working-credential" });
  });

  it("keeps a real transport failure distinct from a definitive 404 in the same batch", () => {
    // The whole point of the fourth verdict: these two must not collapse.
    // `unreachable` means retry later and it will work; `indeterminate` means
    // the answer arrived and cannot be acted on without knowing whether the
    // name is gone or merely invisible to this credential.
    const resolved = resolveReachability(
      outcomes({ a: { kind: "known", latestVersion: "1.0.0" }, b: { kind: "not-found" }, c: { kind: "unreachable" } }),
    );
    expect(resolved.get("b")).toEqual({ kind: "indeterminate", reason: "not-found-with-working-credential" });
    expect(resolved.get("c")).toEqual({ kind: "unreachable" });
    expect(resolved.get("b")).not.toEqual(resolved.get("c"));
  });

  it("resolves an empty batch to an empty map", () => {
    expect(resolveReachability(outcomes({})).size).toBe(0);
  });
});
