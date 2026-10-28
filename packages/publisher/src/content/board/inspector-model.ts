import { writerLabel, type PublisherBoardCopyResolver } from "./copy.js";
import { resolveCopy, type CopyField } from "../composition.js";
import type { ContentRegistry } from "../model.js";
import type { ReviewReport } from "../review/types.js";
import type { PublisherBoardNeed } from "./types.js";

/** PB-9 adapter seam: supply verified manifests; absence is not an empty release history. */
export interface InspectorRelease {
  readonly targetId: string;
  readonly n: number;
  readonly at: string;
  readonly entries: readonly { readonly slotId: string; readonly candidateId: string; readonly revision: string; readonly digest: string; readonly route?: string }[];
}
export interface PublisherInspectorInput {
  readonly registry: ContentRegistry;
  readonly slotId: string;
  readonly locale: string;
  readonly copy: readonly CopyField[];
  readonly copyResolver?: PublisherBoardCopyResolver;
  readonly reviews?: readonly ReviewReport[];
  readonly releases?: readonly InspectorRelease[];
}
export interface InspectorSection {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
}
export interface PublisherInspectorModel {
  readonly ready: boolean;
  readonly needs: readonly PublisherBoardNeed[];
  readonly slotId: string;
  readonly title: string;
  readonly candidates: readonly { readonly id: string; readonly title: string; readonly sections: readonly InspectorSection[] }[];
}

/** Pure explanation of supplied snapshots, never approval/release authorization. */
export function buildPublisherInspector(input: PublisherInspectorInput): PublisherInspectorModel {
  const needs: PublisherBoardNeed[] = [];
  const need = (target: PublisherBoardNeed["target"], ref: string, detail: string): void => { needs.push({ target, ref, detail }); };
  const text = (key: string): string => {
    const matches = input.copy.filter(field => field.key === key && field.locale === input.locale);
    const field = matches[0];
    const value = matches.length === 1 ? writerLabel(field, input.locale, input.copyResolver) : undefined;
    if (value === undefined) {
      need("writer", key, `Supply one nonempty Writer label in ${input.locale}`); return "";
    }
    return value;
  };
  const title = text("inspector.title");
  const slot = input.registry.slots.find(row => row.id === input.slotId);
  if (!slot) need("publisher", input.slotId, "Supply the selected slot");
  if (input.releases === undefined) need("publisher", "releases", "PB-9 must supply verified release manifests, or an explicit empty list");
  const candidates = input.registry.candidates.filter(candidate => candidate.slotId === slot?.id).map(candidate => {
    const sections: InspectorSection[] = [];
    const section = (id: string, fields: InspectorSection["fields"], suffix = ""): void => {
      sections.push({ id: `${candidate.id}.${id}.${suffix}`, title: text(`inspector.${id}`) + (suffix ? ` ${suffix}` : ""), fields: fields.length ? fields : [{ label: text("inspector.empty"), value: "" }] });
    };
    const field = (key: string, value: string) => ({ label: text(`inspector.${key}`), value });
    section("detail", [field("id", candidate.id), field("state", text(`inspector.states.${candidate.state}`)), field("origin", text(`inspector.origins.${candidate.origin}`)), field("revision", candidate.revision)]);
    section("revisions", candidate.history.flatMap(row => [field("revision", row.revision), field("digest", row.digest), field("at", row.createdAt)]));
    const snapshot = candidate.history.find(row => row.revision === candidate.revision);
    if (!snapshot) need("publisher", `revision.${candidate.id}`, "Supply the selected candidate's current immutable revision");
    const reports = input.reviews?.filter(row => row.candidateId === candidate.id && row.revision === candidate.revision && row.digest === snapshot?.digest) ?? [];
    if (reports.length !== 1) need("publisher", `review.${candidate.id}`, "Supply one PB-3 report pinned to current revision and digest");
    section("findings", reports.length === 1 ? [
      ...reports[0]!.findings.map(row => ({ label: `${row.check}: ${row.path} (${row.rule})`, value: row.message })),
      ...reports[0]!.needs.map(row => ({ label: row.ref ?? row.id, value: row.detail })),
    ] : []);
    for (const locale of slot?.locales ?? []) {
      try {
        const report = resolveCopy(snapshot?.content ?? candidate, locale, { resolver: input.copyResolver });
        const copy = report.copy;
        for (const finding of report.findings) if (finding.severity === "error") {
          need("writer", `copy.${candidate.id}.${locale}.${finding.path}`, finding.message);
        }
        if (report.findings.length) section("findings", report.findings.map(finding => ({
          label: `${finding.path} (${finding.rule})`, value: finding.message,
        })), locale);
        section("copy", Object.entries(copy).flatMap(([section, fields]) => Object.entries(fields).map(([key, value]) => ({ label: `${section}.${key}`, value }))), locale);
      } catch (error) { need("publisher", `copy.${candidate.id}.${locale}`, error instanceof Error ? error.message : "Supply valid locale copy"); }
    }
    const approval = candidate.approval;
    const status = !approval ? "missing" : approval.revision === candidate.revision && approval.digest === snapshot?.digest ? "recorded" : "stale";
    section("approval", [field("state", text(`inspector.${status}`)), ...(approval ? [field("by", approval.by), field("source", approval.source), field("at", approval.at), field("revision", approval.revision), field("digest", approval.digest)] : [])]);
    const releases = input.releases?.flatMap(release => release.entries.filter(entry => entry.slotId === slot?.id && entry.candidateId === candidate.id).flatMap(entry => {
      if (!candidate.history.some(row => row.revision === entry.revision && row.digest === entry.digest)) {
        need("publisher", `release.${candidate.id}.${release.n}`, "Release entry must name an existing revision and digest"); return [];
      }
      return [field("target", release.targetId), field("id", String(release.n)), field("at", release.at), field("revision", entry.revision), field("digest", entry.digest), ...(entry.route ? [field("route", entry.route)] : [])];
    })) ?? [];
    section("releases", releases);
    return { id: candidate.id, title: text(`candidate.${candidate.id}.name`), sections };
  });
  return { ready: needs.length === 0, needs, slotId: input.slotId, title, candidates };
}
