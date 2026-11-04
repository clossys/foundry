/**
 * Rules fixture stub (never shipped, never run by a check outside its fixture): a built Producer
 * and Publisher surface over a plain folder slot model, with one wiring defect: Studio slot detail never compares the pin sha256 with the pinned candidate bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFECT = "pin-hash";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const agentDir = (consumer, agent) => join(consumer, "agents", agent);
const slotDir = (consumer, agent, id) => join(agentDir(consumer, agent), id);
const parse = name => { const [, element, version] = /^(.+)-v(\d+)\.json$/.exec(name); return { element, version: Number(version) }; };
const pinOf = (consumer, agent, id) => { const path = join(slotDir(consumer, agent, id), "pin.json"); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; };

export function readCandidate(consumer, agent, id, name) {
  const bytes = readFileSync(join(slotDir(consumer, agent, id), "candidates", name), "utf8");
  return { name, bytes, sha256: sha(bytes) };
}
export function listSlots(consumer, agent) {
  const dir = agentDir(consumer, agent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map(id => ({ id, agent, dir: slotDir(consumer, agent, id), pin: pinOf(consumer, agent, id), candidates: readdirSync(join(slotDir(consumer, agent, id), "candidates")).sort() }));
}
const drifted = (consumer, agent, id, pin) => readCandidate(consumer, agent, id, pin.candidate).sha256 !== pin.sha256;
function pinsOf(consumer, prefix) {
  const pins = {};
  for (const entry of listSlots(consumer, "designer")) {
    if (!entry.pin) continue;
    if (drifted(consumer, "designer", entry.id, entry.pin)) throw new Error(`${prefix}${entry.id}: native pin hash drift`);
    pins[entry.id] = parse(entry.pin.candidate);
  }
  return pins;
}
export function slotInstallInputs(consumer) {
  const pins = pinsOf(consumer, "Specimen slot ");
  const options = new Map(listSlots(consumer, "designer").map(entry => [entry.id,
    DEFECT === "options" ? [] : entry.candidates.filter(name => name !== entry.pin?.candidate).map(parse)]));
  return { pins, options, fingerprint: sha(JSON.stringify(pins)) };
}
export const designerPins = repo => pinsOf(join(repo, "clossys"), "designer pin ");
export const libraryRecordSource = ({ roots }) => ({ consumer: roots[0] });
export const writerCopy = async () => ({});
function pagePin(consumer, id) {
  const pin = pinOf(consumer, "publisher", id);
  if (drifted(consumer, "publisher", id, pin)) throw new Error(`publisher ${id}: pin hash drift`);
  return JSON.parse(readCandidate(consumer, "publisher", id, pin.candidate).bytes);
}
export async function pageRecordFromCell(repo, id) { return pagePin(join(repo, "clossys"), id); }
export async function readPinnedPublication(consumer, id) { return { id, pages: [pagePin(consumer, "page.home")] }; }
export async function resolvePage(page, pins, source) {
  const slots = [page.frame, ...page.sections].filter(slot => pins[slot]).map(slot => {
    const { element, version } = pins[slot];
    return { slot, itemHash: readCandidate(source.consumer, "designer", slot, `${element}-v${version}.json`).sha256 };
  });
  return { slots };
}
export function writePin(consumer, agent, id, name, decision) {
  writeFileSync(join(slotDir(consumer, agent, id), "pin.json"), JSON.stringify({ candidate: name, sha256: readCandidate(consumer, agent, id, name).sha256, ...decision }));
}
export function slotDetail(repo, agent, id) {
  const consumer = join(repo, "clossys"), pin = pinOf(consumer, agent, id);
  const held = pin && (DEFECT === "pin-hash" || !drifted(consumer, agent, id, pin));
  const candidates = listSlots(consumer, agent).find(entry => entry.id === id).candidates.map(name => {
    const { sha256 } = readCandidate(consumer, agent, id, name), pinned = pin?.candidate === name;
    const live = pinned ? held : true;
    return { name, sha256, pinned, issues: [], preview: !(pinned && held), specimen: agent === "designer" && live ? { slot: id, ...parse(name) } : undefined };
  });
  return { kind: agent === "designer" ? "element" : "page", shown: pin?.candidate, candidates, checks: [
    { label: { copy: "studio.check-slot-placed" }, ok: true },
    { label: { copy: "studio.check-pin-matches" }, ok: Boolean(held), ...(held ? {} : { detail: { copy: "studio.check-pin-hash-mismatch" } }) },
  ] };
}
