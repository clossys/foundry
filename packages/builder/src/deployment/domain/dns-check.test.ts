import { describe, expect, it } from "vitest";
import { checkDnsRecords } from "./dns-check.js";
import type { DnsResolver } from "./dns-check.js";
import type { DnsRecord } from "./types.js";

const domain = "example.com";

function resolverFrom(table: Record<string, readonly string[]>): DnsResolver {
  return async (type, name) => {
    const values = table[`${type} ${name}`];
    if (values === undefined) throw new Error(`no such record: ${type} ${name}`);
    return values;
  };
}

describe("checkDnsRecords", () => {
  it("is satisfied when every non-proxied record resolves to its declared value", async () => {
    const records: readonly DnsRecord[] = [
      { type: "A", name: "@", value: "192.0.2.1", proxied: false },
      { type: "CNAME", name: "docs", value: "example.com", proxied: false },
      { type: "TXT", name: "@", value: "v=spf1 -all", proxied: false },
      { type: "MX", name: "@", value: "mail.example.com", priority: 10, proxied: false },
    ];
    const resolve = resolverFrom({
      "A example.com": ["192.0.2.1"],
      "CNAME docs.example.com": ["example.com."],
      "TXT example.com": ["v=spf1 -all"],
      "MX example.com": ["10 mail.example.com"],
    });
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 4 });
  });

  it("compares AAAA values after canonicalizing both sides", async () => {
    const records: readonly DnsRecord[] = [{ type: "AAAA", name: "@", value: "2606:4700:0000:0000:0000:0000:0000:0001", proxied: false }];
    const resolve = resolverFrom({ "AAAA example.com": ["2606:4700::1"] });
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result.verdict).toBe("satisfied");
  });

  it("accepts a proxied record resolving to anything, without matching the declared value", async () => {
    const records: readonly DnsRecord[] = [{ type: "A", name: "@", value: "192.0.2.1", proxied: true }];
    const resolve = resolverFrom({ "A example.com": ["198.51.100.9"] });
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result).toEqual({ verdict: "satisfied", evaluated: 1 });
  });

  it("reports a mismatch as violated, never indeterminate", async () => {
    const records: readonly DnsRecord[] = [{ type: "A", name: "@", value: "192.0.2.1", proxied: false }];
    const resolve = resolverFrom({ "A example.com": ["203.0.113.5"] });
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result.verdict).toBe("violated");
    if (result.verdict === "violated") expect(result.findings[0]?.rule).toBe("dns-record-mismatch");
  });

  it("reports an unresolvable name as indeterminate, never violated", async () => {
    const records: readonly DnsRecord[] = [{ type: "A", name: "@", value: "192.0.2.1", proxied: false }];
    const resolve: DnsResolver = async () => { throw new Error("ENOTFOUND"); };
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict === "indeterminate") expect(result.reason).toBe("dns-lookup-failed");
  });

  it("prefers indeterminate over violated when both occur across records", async () => {
    const records: readonly DnsRecord[] = [
      { type: "A", name: "@", value: "192.0.2.1", proxied: false },
      { type: "A", name: "www", value: "192.0.2.2", proxied: false },
    ];
    const resolve: DnsResolver = async (_type, name) => {
      if (name === "example.com") return ["203.0.113.5"];
      throw new Error("timeout");
    };
    const result = await checkDnsRecords({ domain, records }, { resolve });
    expect(result.verdict).toBe("indeterminate");
  });

  it("is never satisfied for a declaration with no records", async () => {
    const result = await checkDnsRecords({ domain, records: [] }, { resolve: async () => [] });
    expect(result.verdict).not.toBe("satisfied");
    expect(result).toEqual({ verdict: "indeterminate", reason: "no-records", detail: "No DNS records were declared." });
  });
});
