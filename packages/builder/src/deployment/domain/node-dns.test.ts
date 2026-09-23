import { describe, expect, it } from "vitest";
import { createNodeDnsResolver } from "./node-dns.js";
import type { NodeDnsPort } from "./node-dns.js";

function fakePort(overrides: Partial<NodeDnsPort> = {}): NodeDnsPort {
  return {
    resolve4: async () => ["192.0.2.1"],
    resolve6: async () => ["2606:4700::1"],
    resolveCname: async () => ["target.example.com."],
    resolveNs: async () => ["ns1.example.com."],
    resolveTxt: async () => [["v=spf1", " -all"]],
    resolveMx: async () => [{ exchange: "MAIL.EXAMPLE.COM.", priority: 10 }],
    ...overrides,
  };
}

describe("createNodeDnsResolver", () => {
  it("dispatches every record type to its matching node:dns method", async () => {
    const resolve = createNodeDnsResolver(fakePort());
    expect(await resolve("A", "example.com")).toEqual(["192.0.2.1"]);
    expect(await resolve("AAAA", "example.com")).toEqual(["2606:4700::1"]);
    expect(await resolve("CNAME", "example.com")).toEqual(["target.example.com."]);
    expect(await resolve("NS", "example.com")).toEqual(["ns1.example.com."]);
  });

  it("joins TXT chunks into one string per record", async () => {
    const resolve = createNodeDnsResolver(fakePort());
    expect(await resolve("TXT", "example.com")).toEqual(["v=spf1 -all"]);
  });

  it("formats MX entries as \"<priority> <exchange>\" with a lowercase, dot-stripped exchange", async () => {
    const resolve = createNodeDnsResolver(fakePort());
    expect(await resolve("MX", "example.com")).toEqual(["10 mail.example.com"]);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const resolve = createNodeDnsResolver(fakePort());
    const controller = new AbortController();
    controller.abort();
    await expect(resolve("A", "example.com", controller.signal)).rejects.toThrow("aborted");
  });

  it("propagates a resolver rejection unchanged", async () => {
    const resolve = createNodeDnsResolver(fakePort({ resolve4: async () => { throw new Error("ENOTFOUND"); } }));
    await expect(resolve("A", "example.com")).rejects.toThrow("ENOTFOUND");
  });
});
