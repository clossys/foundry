/**
 * The data-bound section contract (foundry-build-0048 U20). A data-bound record section declares a required `records`
 * slot and pairs no Writer passage (section-copy.ts `dataBoundRecordSection` with no `passageSchema`, the same
 * passageless test the copy schema check makes): it renders the consumer's own clossys records and binds no Writer
 * copy, its words are record values. A records section that pairs a passage (a data table, a feed) is filled from the
 * page's own data and Writer copy, and is not data-bound. Its slot contract states the binding in its limits, and each rule here is
 * one finding of `slotContractFindings` on the sections layer:
 *
 * - `reads.access` is `read-only`: a record section never writes a record;
 * - `reads.port` is the name of its required `records` slot, the one port the host fills;
 * - `reads.records` lists record schemas from the closed set the admin workspace reads (`clossys.ia/1`, ...), each once,
 *   one entry optionally qualified in parentheses (`clossys.queue-entry/1 (queue.pick, ...)`);
 * - `reads.scope` is the route scope the records are read under: `workspace`, `agent`, or `agent, slot`; a page that
 *   places the section supplies these as route parameters (producer `publisher.admin-seated`);
 * - `binding` is `host-injected`: the host reads the records and passes them to the `reads.port` slot at render; the
 *   section imports no record reader;
 * - it declares no copy field (the page header and empty-state sections carry its Writer copy).
 *
 * A section that is not data-bound declares no `reads.*` or `binding` limit. Pure.
 */
export const DATA_BOUND_RECORD_SCHEMAS: readonly string[] = ["clossys.ia/1", "clossys.slot/2", "clossys.pin/2", "clossys.candidate/1", "clossys.queue-entry/1", "clossys.queue-entry/2"];
export const DATA_BOUND_SCOPES: readonly string[] = ["workspace", "agent", "agent, slot"];
export const DATA_BOUND_BINDING = "host-injected";

type Limits = Readonly<Record<string, number | string | boolean>>;
interface SectionShape {
    readonly slots?: readonly { readonly name?: string; readonly id?: string; readonly type?: string; readonly required?: boolean }[];
    readonly copy?: { readonly fields?: readonly unknown[] };
    readonly passageSchema?: unknown;
}

const ENTRY = /^(clossys\.[a-z][a-z-]*\/[1-9][0-9]*)(?: \(([a-z0-9][a-z0-9., -]*)\))?$/;

/** The record schemas a `reads.records` limit names, or a reason it does not parse. */
export function readRecords(value: unknown): { ok: true; schemas: string[] } | { ok: false; reason: string } {
    if (typeof value !== "string" || !value.trim()) return { ok: false, reason: "reads.records must name the record schemas the section reads" };
    // Split on the commas outside a parenthesised qualifier.
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let index = 0; index < value.length; index++) {
        const char = value[index];
        if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (char === "," && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1; }
    }
    parts.push(value.slice(start).trim());
    const schemas: string[] = [];
    for (const part of parts) {
        const match = ENTRY.exec(part);
        if (!match) return { ok: false, reason: `reads.records entry ${JSON.stringify(part)} is not a clossys record schema` };
        if (!DATA_BOUND_RECORD_SCHEMAS.includes(match[1]!)) return { ok: false, reason: `reads.records names ${match[1]}, which is no record the admin workspace reads (${DATA_BOUND_RECORD_SCHEMAS.join(", ")})` };
        if (schemas.includes(match[1]!)) return { ok: false, reason: `reads.records names ${match[1]} twice` };
        schemas.push(match[1]!);
    }
    return { ok: true, schemas };
}

/** Every data-binding finding for one section's contract record (its limits) against its catalog contract. */
export function dataBindingFindings(limits: Limits, section: SectionShape): string[] {
    const ports = section.slots ?? [];
    const bound = ports.filter(port => port.type === "records" && port.required === true);
    const keys = Object.keys(limits).filter(key => key.startsWith("reads.") || key === "binding");
    if (!bound.length) return keys.length ? [`declares ${keys.sort().join(", ")} but is no data-bound record section (no required records slot)`] : [];
    if (section.passageSchema !== undefined) return keys.length ? [`declares ${keys.sort().join(", ")} but is no data-bound record section (it pairs the Writer passage ${String(section.passageSchema)})`] : [];
    const findings: string[] = [];
    if (bound.length > 1) findings.push(`declares ${bound.length} required records slots; a data-bound section reads through one`);
    const port = bound[0]!.name ?? bound[0]!.id;
    if (limits["reads.access"] !== "read-only") findings.push(`reads.access is ${JSON.stringify(limits["reads.access"] ?? null)}, not "read-only": a record section never writes a record`);
    if (limits["reads.port"] !== port) findings.push(`reads.port is ${JSON.stringify(limits["reads.port"] ?? null)}, not its required records slot ${JSON.stringify(port)}`);
    const records = readRecords(limits["reads.records"]);
    if (!records.ok) findings.push(records.reason);
    if (typeof limits["reads.scope"] !== "string" || !DATA_BOUND_SCOPES.includes(limits["reads.scope"])) findings.push(`reads.scope is ${JSON.stringify(limits["reads.scope"] ?? null)}, not one of ${DATA_BOUND_SCOPES.map(scope => JSON.stringify(scope)).join(", ")}`);
    if (limits.binding !== DATA_BOUND_BINDING) findings.push(`binding is ${JSON.stringify(limits.binding ?? null)}, not "${DATA_BOUND_BINDING}": the host reads the records and fills the ${JSON.stringify(port)} slot`);
    const extra = keys.filter(key => !["reads.access", "reads.port", "reads.records", "reads.scope", "binding"].includes(key));
    if (extra.length) findings.push(`declares ${extra.sort().join(", ")}, outside the data-bound section contract`);
    if ((section.copy?.fields ?? []).length) findings.push("declares copy fields: a data-bound record section renders record values and binds no Writer copy");
    return findings;
}
