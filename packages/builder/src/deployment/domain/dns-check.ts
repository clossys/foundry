/**
 * Live DNS resolution, checked against a `WebSurfaceDeclaration`'s own
 * declared records. Read-only and credential-free by construction: DNS
 * resolution is public data, so unlike the Vercel/Render inspectors next
 * door, this check needs no `getBearerToken` at all -- see this package's
 * README for why that is exactly the shape #1211 asks a live DNS check to
 * have ("Builder never reads or stores a token").
 *
 * `resolve` is injected (never `node:dns` imported directly here) so this
 * function stays pure of any real network access and testable offline --
 * `node-dns.ts` supplies the real implementation a caller wires in.
 *
 * A resolver that throws (NXDOMAIN, timeout, no network) reports
 * `indeterminate`, never `violated`: an unresolvable name is NOT evidence
 * the record is wrong, it is evidence nothing could be examined. See #914.
 */
import { createGateReasons, gateSatisfied, gateViolated } from "@clossys/controller/gates";
import type { GateResult } from "@clossys/controller/gates";
import type { DnsRecord, DnsRecordType, WebSurfaceFinding } from "./types.js";

/**
 * Resolves one declared record's live value(s). For every type except `MX`
 * each returned string is the record's plain value (a dotted IPv4 address,
 * an IPv6 address in any valid textual form, a hostname with no trailing
 * dot, or an exact TXT string). For `MX`, each returned string is
 * `"<priority> <exchange>"` (exchange with no trailing dot) -- the one
 * record type whose live value is a pair, not a scalar. `node-dns.ts`'s
 * `createNodeDnsResolver` produces exactly this shape from `node:dns`.
 */
export type DnsResolver = (type: DnsRecordType, name: string, signal?: AbortSignal) => Promise<readonly string[]>;

export const DNS_CHECK_REASONS = createGateReasons(["dns-lookup-failed", "no-records"] as const);
export type DnsCheckIndeterminateReason = (typeof DNS_CHECK_REASONS.reasons)[number];

function qualifiedName(domain: string, name: string): string {
  return name === "@" ? domain : `${name}.${domain}`;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/** Expands "::" compression and strips leading zeros so two textually different but equal IPv6 addresses compare equal. Returns `undefined` for anything this cannot parse -- callers then fall back to a literal-string comparison, which only ever makes a match MORE conservative, never less. */
function canonicalIpv6(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f:]+$/i.test(trimmed)) return undefined;
  const halves = trimmed.split("::");
  if (halves.length > 2) return undefined;
  const left = (halves[0] ?? "").split(":").filter((part) => part.length > 0);
  const right = halves.length === 2 ? (halves[1] ?? "").split(":").filter((part) => part.length > 0) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return undefined;
  if (halves.length === 2 && missing < 0) return undefined;
  const groups = [...left, ...(halves.length === 2 ? Array.from({ length: missing }, () => "0") : []), ...right];
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.map((group) => group.replace(/^0+(?=[0-9a-f])/, "")).join(":");
}

function matchesDeclaredValue(record: DnsRecord, resolved: readonly string[]): boolean {
  switch (record.type) {
    case "A":
    case "TXT":
      return resolved.includes(record.value);
    case "AAAA": {
      const declared = canonicalIpv6(record.value);
      return resolved.some((value) => (declared === undefined ? value === record.value : canonicalIpv6(value) === declared));
    }
    case "CNAME":
    case "NS":
      return resolved.some((value) => normalizeHostname(value) === normalizeHostname(record.value));
    case "MX": {
      const expected = `${record.priority ?? 0} ${normalizeHostname(record.value)}`;
      return resolved.some((value) => {
        const [priority, ...rest] = value.split(" ");
        return `${priority} ${normalizeHostname(rest.join(" "))}` === expected;
      });
    }
    default:
      return false;
  }
}

/**
 * Checks every declared record against live resolution. A `proxied` record
 * (Cloudflare's orange-cloud, or any DNS provider that terminates traffic at
 * its own edge -- see `types.ts`'s header) can only be checked for the fact
 * that it resolves at all; its live value is the PROVIDER'S edge address,
 * never the declared origin, so this never asserts an exact match for one.
 *
 * `evaluated` (on a `satisfied` result) counts records this actually
 * resolved and compared -- never zero, because `gateSatisfied` itself
 * refuses that.
 */
export async function checkDnsRecords(
  declaration: { readonly domain: string; readonly records: readonly DnsRecord[] },
  ports: { readonly resolve: DnsResolver; readonly signal?: AbortSignal },
): Promise<GateResult<WebSurfaceFinding, DnsCheckIndeterminateReason>> {
  if (declaration.records.length === 0) return DNS_CHECK_REASONS.indeterminate("no-records", "No DNS records were declared.");

  const findings: WebSurfaceFinding[] = [];
  const failures: string[] = [];
  let evaluated = 0;

  for (const [index, entry] of declaration.records.entries()) {
    const name = qualifiedName(declaration.domain, entry.name);
    let resolved: readonly string[];
    try {
      resolved = await ports.resolve(entry.type, name, ports.signal);
    } catch (error) {
      failures.push(`${entry.type} ${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    evaluated += 1;
    const ok = entry.proxied ? resolved.length > 0 : matchesDeclaredValue(entry, resolved);
    if (!ok) {
      findings.push({
        rule: "dns-record-mismatch",
        severity: "error",
        message: entry.proxied
          ? `${name} (${entry.type}, proxied) did not resolve to anything live.`
          : `Live DNS for ${name} (${entry.type}) does not match the declared record.`,
        path: `records[${index}]`,
      });
    }
  }

  if (failures.length > 0) return DNS_CHECK_REASONS.indeterminate("dns-lookup-failed", failures.join("; "));
  if (findings.length > 0) return gateViolated(findings);
  return gateSatisfied(evaluated);
}
