import { resolve } from "node:path";
import { resolveAgent } from "../agents.js";
import { join } from "node:path";
import { designerPins, installFailed, installSummary, pageRecordFromCell, publishInstall, writerCopy } from "../publish/install.js";
import { readPublisher } from "../publish/site-source.js";
import { readPinned } from "../records/pinned.js";
import { publishSite, siteFailed, siteSummary } from "../publish/install-site.js";
import { nextFailed, nextSummary, publishNext } from "../publish/install-next.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";

/** `publish --install --page <id>`: install the page's pinned items, bind its copy and render it; `--site <pack id>`: one routed app. */
export async function runPublish(args: CliArgs, root: string, cwd = process.cwd()): Promise<CliResult> {
  resolveAgent("publisher");
  // `--selection <module>[#export]`: the consumer's component selection every page mounts inside.
  const hash = args.selection?.lastIndexOf("#") ?? -1;
  const selection = args.selection === undefined ? {} : { selection: hash > 0 ? { module: args.selection.slice(0, hash), export: args.selection.slice(hash + 1) } : { module: args.selection } };
  if (args.site !== undefined && args.next !== undefined) {
    const install = args.bind ? { bind: { selection: selection.selection!, cwd } } : { assembly: args.assembly!, ...(args.states !== undefined ? { states: args.states } : {}), live: args.live };
    const next = await publishNext({ root, publication: args.site, app: resolve(cwd, args.next), ...install, check: args.check, ...(args.out ? { out: resolve(cwd, args.out) } : {}) });
    return { exitCode: nextFailed(next) ? 1 : 0, verb: "publish", root, check: args.check, message: nextSummary(next) };
  }
  if (args.site !== undefined) {
    const site = await publishSite({ root, site: args.site, build: args.build, cwd, ...selection, ...(args.origin !== undefined ? { origin: args.origin } : {}), ...(args.out ? { out: resolve(cwd, args.out) } : {}), ...(args.records.length ? { records: args.records.map(dir => resolve(cwd, dir)) } : {}) });
    return { exitCode: siteFailed(site) ? 1 : 0, verb: "publish", root, check: args.check, message: siteSummary(site) };
  }
  const result = await publishInstall({ root, page: args.page!, cwd, ...selection, ...(args.out ? { out: resolve(cwd, args.out) } : {}), ...(args.records.length ? { records: args.records.map(dir => resolve(cwd, dir)) } : {}) });
  return { exitCode: installFailed(result) ? 1 : 0, verb: "publish", root, check: args.check, message: installSummary(result) };
}

interface PublishFinding { code: string; page?: string; message: string }

/**
 * Bare `publish`: a dry run over the pinned slot model. Every pinned page slot is compiled to
 * its install record exactly as `publish --install` would, then checked: its frame and sections
 * are pinned Designer slots and every copy ref resolves to pinned Writer copy. Nothing is
 * installed, rendered or written.
 */
export async function runPublishCheck(args: CliArgs, root: string): Promise<CliResult> {
  const base = { verb: "publish" as const, root, check: args.check };
  try {
    resolveAgent("publisher");
    const consumer = join(root, "clossys");
    const publisher = readPinned(consumer, "publisher");
    const findings: PublishFinding[] = publisher.issues.map(issue => ({ code: issue.reason, page: issue.slot, message: issue.message }));
    const publication = await readPublisher(root);
    const pins = designerPins(root);
    const copy = await writerCopy(root);
    const writerSlots = new Set(readPinned(consumer, "writer").pinned.map(candidate => candidate.id));
    const pages = publisher.pinned.filter(candidate => candidate.doc.kind === "page");
    const rows: { page: string; frame: string; sections: number; copy: number }[] = [];
    for (const candidate of pages) {
      let record;
      try { record = await pageRecordFromCell(root, candidate.id, pins, copy); }
      catch (error) { findings.push({ code: "page-unreadable", page: candidate.id, message: error instanceof Error ? error.message : String(error) }); continue; }
      for (const slot of [record.frame, ...record.sections]) {
        if (!Object.hasOwn(pins, slot)) findings.push({ code: "designer-slot-unpinned", page: candidate.id, message: `${slot} is not a pinned Designer slot` });
      }
      const page = JSON.parse(candidate.bytes) as { copy?: Record<string, unknown>; bindings?: Record<string, { copy?: Record<string, unknown> }> };
      const refs = [...Object.values(page.copy ?? {}), ...Object.values(page.bindings ?? {}).flatMap(binding => Object.values(binding.copy ?? {}))];
      for (const ref of refs) {
        const text = String(ref), hash = text.indexOf("#");
        if (hash < 1) { findings.push({ code: "copy-ref-invalid", page: candidate.id, message: `Copy ref ${text} is not <writer slot>#<key>` }); continue; }
        if (!writerSlots.has(text.slice(0, hash))) findings.push({ code: "writer-slot-unpinned", page: candidate.id, message: `${text.slice(0, hash)} is not a pinned Writer slot` });
      }
      const keys = [...Object.values(record.copy ?? {}), ...Object.values(record.bindings ?? {}).flatMap(binding => Object.values(binding.copy ?? {}))];
      for (const key of keys) if (!Object.hasOwn(copy, key)) findings.push({ code: "copy-unresolved", page: candidate.id, message: `Copy key ${key} has no pinned Writer text` });
      rows.push({ page: candidate.id, frame: record.frame, sections: record.sections.length, copy: keys.length });
    }
    if (!pages.length) findings.push({ code: "no-pages", message: "The Publisher has no pinned page slot" });
    const routes = publication.routes.length;
    const exitCode = findings.length ? 1 : 0;
    return { ...base, exitCode, checks: { publication: publication.publicationId, routes, pages: rows, findings }, message: [
      `publish: dry run of ${publication.publicationId}: ${rows.length} pinned page(s), ${routes} route(s), ${publication.entries.length} entr${publication.entries.length === 1 ? "y" : "ies"}; ${findings.length} finding(s); nothing installed or written`,
      ...rows.map(row => `  ${row.page}: ${row.frame} + ${row.sections} section(s), ${row.copy} copy binding(s)`),
      ...findings.map(finding => `${finding.code}${finding.page ? ` (${finding.page})` : ""}: ${finding.message}`),
    ].join("\n") };
  } catch (error) {
    return { ...base, exitCode: 2, message: `publish: could not run: ${error instanceof Error ? error.message : String(error)}` };
  }
}
