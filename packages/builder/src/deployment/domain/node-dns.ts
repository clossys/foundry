/**
 * The real `DnsResolver` (`dns-check.ts`) a caller wires in outside a test.
 * `port` defaults to `node:dns/promises` but stays an explicit parameter so
 * a caller -- or this file's own tests -- can substitute a fake without
 * touching a real resolver, matching every other adapter in this package.
 */
import * as nodeDnsPromises from "node:dns/promises";
import type { DnsResolver } from "./dns-check.js";
import type { DnsRecordType } from "./types.js";

export type NodeDnsPort = {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
  resolveCname(hostname: string): Promise<string[]>;
  resolveNs(hostname: string): Promise<string[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
};

export function createNodeDnsResolver(port: NodeDnsPort = nodeDnsPromises): DnsResolver {
  return async (type: DnsRecordType, name: string, signal?: AbortSignal): Promise<readonly string[]> => {
    if (signal?.aborted) throw new Error("DNS resolution was aborted.");
    switch (type) {
      case "A":
        return port.resolve4(name);
      case "AAAA":
        return port.resolve6(name);
      case "CNAME":
        return port.resolveCname(name);
      case "NS":
        return port.resolveNs(name);
      case "TXT":
        return (await port.resolveTxt(name)).map((chunks) => chunks.join(""));
      case "MX":
        return (await port.resolveMx(name)).map((entry) => `${entry.priority} ${entry.exchange.toLowerCase().replace(/\.$/, "")}`);
      default: {
        const unhandled: never = type;
        throw new Error(`createNodeDnsResolver: unsupported record type ${String(unhandled)}`);
      }
    }
  };
}
