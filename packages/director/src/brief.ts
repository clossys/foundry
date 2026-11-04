import { createHash } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import { readBriefRootFile, validateBriefContract, type BriefContract } from "./brief-contracts.js";
import { formatRef } from "./format/ref.js";
import type { Bullet, Cell, CellId, CellRef, Ref, StrategyModel } from "./format/types.js";

export interface BriefCell extends CellRef {
  direction: Bullet[]; watch: Bullet[];
  /** Direct cell, message and finding refs supporting the carried cell. */
  sources: Ref[];
}
export interface Brief {
  contract: string; state: "ready" | "missing" | "stale"; cells: BriefCell[];
  missing: CellId[]; stale: CellRef[]; fingerprint: string; compiledAt: string;
}

/** The pointer and file status must agree before a cell can supply a brief. */
function active(model: StrategyModel, id: CellId): Cell | undefined {
  const version = model.tree?.active[id];
  return model.cells.find(cell => cell.id === id && cell.version === version && cell.status === "active");
}

/**
 * Compiles synchronously without writing. Fingerprints cover the sorted version
 * refs and exact UTF-8 source bytes of selected cells and recursively cited files.
 * Missing C1 citations mark the downstream ref stale; superseded citations list
 * the cited ref. Required dependency cycles terminate without dropping evidence.
 */
export function compileBrief(model: StrategyModel, contract: BriefContract): Brief {
  const validated = validateBriefContract(contract, model.catalog);
  if (!validated.ok) throw new Error("Invalid brief contract");
  const required = new Set(contract.requires);
  const selected = [...new Set([...contract.requires, ...contract.optional])].sort();
  const missing = contract.requires.filter(id => !active(model, id)).sort();
  const refs = new Map<string, CellRef>(); const paths = new Set<string>(); const stale = new Map<string, CellRef>();
  const visited = new Set<string>(); const checked = new Set<string>();
  const addStale = (ref: CellRef) => stale.set(`${ref.cell}@${ref.version}`, ref);
  function pathFor(cell: Cell): string {
    return isAbsolute(cell.path) ? relative(model.root, cell.path).split("\\").join("/") : cell.path;
  }
  function visit(cell: Cell, checkFreshness: boolean) {
    const token = `${cell.id}@${cell.version}`;
    if (checkFreshness ? checked.has(token) : visited.has(token)) return;
    visited.add(token); if (checkFreshness) checked.add(token);
    refs.set(token, { cell: cell.id, version: cell.version }); paths.add(pathFor(cell));
    for (const ref of [...cell.cites, ...(cell.confirmed ? [cell.confirmed] : [])]) {
      if (ref.kind === "cell") {
        const cited = model.cells.find(candidate => candidate.id === ref.ref.cell && candidate.version === ref.ref.version);
        refs.set(formatRef(ref), ref.ref);
        if (checkFreshness && model.tree?.active[ref.ref.cell] !== ref.ref.version) addStale(ref.ref);
        if (cited) visit(cited, checkFreshness);
        else {
          paths.add(`cells/${ref.ref.cell}/v${ref.ref.version}.md`);
          if (checkFreshness) addStale(ref.ref);
        }
      } else if (ref.kind === "msg") paths.add(`sessions/${ref.session}.md`);
      else paths.add(`findings/${ref.id}.md`);
    }
    for (const link of model.catalog.coherence.links.filter(link => link.downstream === cell.id)) {
      const upstream = active(model, link.upstream);
      if (checkFreshness && (!upstream || !cell.cites.some(ref => ref.kind === "cell" && ref.ref.cell === link.upstream))) addStale({ cell: cell.id, version: cell.version });
      if (upstream) visit(upstream, checkFreshness);
    }
  }
  const cells: BriefCell[] = [];
  for (const id of selected) {
    const cell = active(model, id); if (!cell) continue;
    visit(cell, required.has(id));
    const keys = contract.keys?.[id];
    const carry = (bullets: Bullet[]) => structuredClone(keys ? bullets.filter(bullet => bullet.key !== undefined && keys.includes(bullet.key)) : bullets);
    cells.push({ cell: id, version: cell.version, direction: carry(cell.direction), watch: structuredClone(cell.watch), sources: structuredClone(cell.cites) });
  }
  const hash = createHash("sha256");
  hash.update(JSON.stringify([...refs.keys()].sort()));
  for (const path of [...paths].sort()) {
    // Length framing distinguishes missing files and boundaries; file bytes stay raw.
    const bytes = Object.hasOwn(model.files, path) ? model.files[path] : undefined;
    hash.update(JSON.stringify([path, bytes === undefined ? null : Buffer.byteLength(bytes, "utf8")]));
    if (bytes !== undefined) hash.update(bytes, "utf8");
  }
  const fingerprint = hash.digest("hex"); let priorChanged = false;
  try {
    const bytes = readBriefRootFile(model.root, `briefs/${contract.id}.json`);
    if (bytes !== undefined) {
      const previous: unknown = JSON.parse(bytes);
      priorChanged = typeof previous !== "object" || previous === null || !("fingerprint" in previous) || previous.fingerprint !== fingerprint;
    }
  } catch { priorChanged = true; }
  return { contract: contract.id, state: missing.length ? "missing" : stale.size || priorChanged ? "stale" : "ready", cells, missing,
    stale: [...stale.values()].sort((a, b) => a.cell.localeCompare(b.cell) || a.version - b.version), fingerprint, compiledAt: new Date().toISOString() };
}
