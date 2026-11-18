/**
 * The locales a release ships (publisher.md 9.4.3 contract `locales`): `{ "required": [...] }`, or
 * `{ "from": "<agent>/<slot-id>:<Key>" }`, read from that slot's resolved candidate (Director Markdown: the value of
 * the one `- <Key>: <comma list>` line under `## Direction`, the line `brief.keys` checks; JSON: `content[<Key>]`). A key still on its package default is a template, not a decision: it does
 * not resolve. Every failure is an issue, and `release.locales` fails on any; nothing falls back to a default locale.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRecordHeader } from "../records/schema.js";
import { parseRefString, resolveSlot } from "../records/resolve.js";
import { slotDir } from "../records/candidate.js";
import { releaseSlotId } from "./paths.js";

export const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export interface ReleaseLocales { readonly locales: string[]; readonly issues: string[] }

/** The release slot's `slot.json`, or undefined. */
export function readReleaseSlot(root: string, publication: string): { contract?: Record<string, unknown>; brief?: unknown; kind?: unknown; status?: unknown } | undefined {
  try { return JSON.parse(readFileSync(join(slotDir(root, "publisher", releaseSlotId(root, publication)), "slot.json"), "utf8")); } catch { return undefined; }
}

function tokens(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.every(item => typeof item === "string") ? value.map(item => (item as string).trim()).filter(Boolean) : undefined;
  if (typeof value !== "string") return undefined;
  return value.split(/[\s,;]+/).map(item => item.replace(/^[-*]+/, "").trim()).filter(Boolean);
}

/** The value of the `- <key>: ...` line under `## Direction` of a Director brief body (as `brief.keys` reads it), if exactly one. */
function directionKey(body: string, key: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "## Direction");
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const hits = lines.slice(start + 1, end < 0 ? undefined : end).map(line => line.trim()).filter(line => line.startsWith(`- ${key}:`));
  return hits.length === 1 ? hits[0]!.slice(key.length + 3).trim() : undefined;
}

function keyValue(file: string, key: string): unknown {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".md")) {
    const body = text.startsWith("---") ? text.slice(text.indexOf("\n---", 3) + 4) : text;
    return directionKey(body, key);
  }
  if (file.endsWith(".json")) {
    readRecordHeader(file.split(/[\\/]/).pop()!, text);
    const content = (JSON.parse(text) as { content?: Record<string, unknown> }).content;
    return content?.[key];
  }
  return undefined;
}

export function releaseLocales(root: string, publication: string): ReleaseLocales {
  const slot = readReleaseSlot(root, publication);
  const where = `publisher/${releaseSlotId(root, publication)}`;
  if (!slot) return { locales: [], issues: [`${where} has no readable slot.json: no release contract`] };
  const spec = slot.contract?.locales as { required?: unknown; from?: unknown } | undefined;
  let list: string[] | undefined;
  if (spec?.required !== undefined) {
    list = tokens(spec.required);
    if (!list || !Array.isArray(spec.required)) return { locales: [], issues: [`${where} contract locales.required is not a list of locales`] };
  } else if (typeof spec?.from === "string") {
    const colon = spec.from.lastIndexOf(":");
    const ref = colon > 0 ? parseRefString(spec.from.slice(0, colon)) : undefined;
    const key = colon > 0 ? spec.from.slice(colon + 1) : "";
    if (!ref || !key || ref.candidate) return { locales: [], issues: [`${where} contract locales.from ${spec.from} is not <agent>/<slot-id>:<Key>`] };
    const resolved = resolveSlot(root, ref.agent, ref.slotId, ref.record);
    if (resolved.state === "unresolved") return { locales: [], issues: [`locales from ${spec.from}: ${resolved.reason}`] };
    if (resolved.state === "sample") return { locales: [], issues: [`locales from ${spec.from}: ${ref.agent}/${ref.slotId} is still its package default ${resolved.candidate}`] };
    let value: unknown;
    try { value = keyValue(resolved.file, key); } catch (error) { return { locales: [], issues: [`locales from ${spec.from}: ${(error as Error).message}`] }; }
    list = tokens(value);
    if (list === undefined || list.length === 0) {
      const line = resolved.file.endsWith(".md") ? `one "- ${key}: <comma list>" line under ## Direction` : `content.${key}`;
      return { locales: [], issues: [`locales from ${spec.from}: ${resolved.candidate} has no ${key} (expected ${line})`] };
    }
  } else return { locales: [], issues: [`${where} contract names no locales (locales.required or locales.from)`] };
  const issues = list.filter(locale => !LOCALE.test(locale)).map(locale => `${where} locale ${JSON.stringify(locale)} is not a locale tag`);
  const locales = [...new Set(list.filter(locale => LOCALE.test(locale)))];
  if (locales.length === 0 && issues.length === 0) issues.push(`${where} resolves no locales`);
  return { locales, issues };
}
