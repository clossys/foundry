import { formatRef, parseRef } from "@clossys/strategist";
import { isValidWriterLeafId, WRITER_LAYERS, type WriterLayer } from "../catalog-core/ids.js";
import { loadWriterCatalog } from "../catalog/ia/index.js";
import { canonicalLocale, intlDirectionFor } from "../locale.js";
import type { WriterShapeIssue } from "./types.js";

type Obj = Record<string, unknown>;
type Check = (value: unknown, path: string) => void;
const PREFIX: Record<WriterLayer, string> = { lexicon: "lx", strings: "st", patterns: "pt", passages: "ps", narratives: "nr" };
const RECORD_ID = /^(lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/;
const object = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const owns = (value: Obj, key: string): boolean => Object.hasOwn(value, key);

/** WR1 describes source shape only; approval, resolution, and freshness are later gates. */
class Shape {
  readonly issues: WriterShapeIssue[] = [];
  issue(path: string, message: string): void { this.issues.push({ code: "WR1", path, message }); }
  obj(value: unknown, path: string, fields: Record<string, Check>, optional: readonly string[] = []): value is Obj {
    if (!object(value)) { this.issue(path, "Expected an object"); return false; }
    for (const key of Object.keys(value)) if (!owns(fields, key)) this.issue(`${path}.${key}`, key === "strategistClaimKey"
      ? "strategistClaimKey was removed; migrate to strategy: { cell: <cell-id>, version: <positive integer> } using the confirmed strategy cell."
      : key === "strategist" && owns(fields, "leafFreeze")
        ? 'strategist.path was removed; migrate to strategy: { root: <strategy directory>, contract: "writer.messaging" }.'
        : "Unknown field");
    for (const [key, check] of Object.entries(fields)) {
      if (!owns(value, key)) { if (!optional.includes(key)) this.issue(`${path}.${key}`, "Required field"); }
      else check(value[key], `${path}.${key}`);
    }
    return true;
  }
  string: Check = (v, p) => { if (typeof v !== "string") this.issue(p, "Expected a string"); };
  boolean: Check = (v, p) => { if (typeof v !== "boolean") this.issue(p, "Expected a boolean"); };
  number: Check = (v, p) => { if (typeof v !== "number" || !Number.isFinite(v)) this.issue(p, "Expected a finite number"); };
  count: Check = (v, p) => { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) this.issue(p, "Expected a nonnegative safe integer"); };
  one(...values: readonly unknown[]): Check { return (v, p) => { if (!values.includes(v)) this.issue(p, `Expected one of ${values.join(", ")}`); }; }
  array(check: Check): Check { return (v, p) => { if (!Array.isArray(v)) this.issue(p, "Expected an array"); else v.forEach((item, i) => check(item, `${p}[${i}]`)); }; }
  map(check: Check): Check { return (v, p) => { if (!object(v)) this.issue(p, "Expected an object map"); else for (const [key, item] of Object.entries(v)) check(item, `${p}.${key}`); }; }
  fields(fields: Record<string, Check>, optional: readonly string[] = []): Check { return (v, p) => { this.obj(v, p, fields, optional); }; }
  id(prefix?: string): Check { return (v, p) => { if (typeof v !== "string" || RECORD_ID.exec(v)?.[0] !== v || (prefix !== undefined && !v.startsWith(`${prefix}.`))) this.issue(p, `Expected a ${prefix ?? "Writer"} record ID with ten lowercase Crockford characters`); }; }
  leaf(layer?: WriterLayer): Check { return (v, p) => { if (!isValidWriterLeafId(v) || (layer !== undefined && !v.startsWith(`${layer}.`))) this.issue(p, `Expected a ${layer ?? "Writer"} leaf ID`); }; }
  locale: Check = (v, p) => {
    try {
      const canonical = canonicalLocale(v);
      if (canonical !== v) this.issue(p, `non-canonical-locale: Expected ${canonical}`);
    } catch { this.issue(p, "locale: Expected a BCP 47 locale tag"); }
  };
  strategyRoot: Check = (v, p) => {
    if (typeof v !== "string" || !v.trim() || v.includes("\0")) this.issue(p, "Expected a nonempty strategy directory path without NUL characters");
  };
  cellRef: Check = (v, p) => {
    this.obj(v, p, {
      cell: (cell, path) => { if (typeof cell !== "string" || parseRef(formatRef({ kind: "cell", ref: { cell, version: 1 } }))?.kind !== "cell") this.issue(path, "Expected a strategy cell id (l1.l2.l3)"); },
      version: (version, path) => { if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) this.issue(path, "Expected a positive safe integer cell version"); },
    });
  };
  asset(): Check { return this.fields({ assetId: this.string, libraryVersion: this.string }); }
  common(layer: WriterLayer): Record<string, Check> {
    return {
      id: this.id(PREFIX[layer]), leaf: this.leaf(layer), context: this.string,
      status: this.one("draft", "approved", "retired"), origin: this.one("authored", "external", "foundry-default"),
      external: this.fields({ publisher: this.string, reference: this.string, retrievedAt: this.string, license: this.string }, ["license"]),
      approval: this.fields({ approvedBy: this.one("owner", "delegate"), approvedAt: this.string, textFingerprint: this.string, fingerprintAlgorithm: this.string,
        delegate: this.fields({ id: this.string, scope: this.array(this.string) }), pendingOwnerReview: this.boolean, expiresAt: this.string }, ["delegate", "pendingOwnerReview", "expiresAt"]),
      translation: this.fields({ sourceFingerprint: this.string, fingerprintAlgorithm: this.string, translatedAt: this.string, translatedBy: this.string, reviewedAt: this.string, reviewedBy: this.string }, ["translatedBy", "reviewedAt", "reviewedBy"]),
    };
  }
  ref: Check = (v, p) => {
    if (!object(v)) { this.issue(p, "Expected a passage reference"); return; }
    const prefix = v.ref === "string" ? "st" : v.ref === "term" ? "lx" : v.ref === "pattern" ? "pt" : undefined;
    this.obj(v, p, { ref: this.one("string", "term", "pattern"), id: this.id(prefix), ...(v.ref === "pattern" ? { part: this.string } : {}) }, ["part"]);
  };
  refs: Check = (v, p) => { if (Array.isArray(v)) this.array(this.ref)(v, p); else this.ref(v, p); };
  block: Check = (v, p) => {
    this.obj(v, p, {
      type: this.one("heading", "paragraph", "list", "quote", "code", "callout", "figure", "citation", "table", "toc"),
      designer: this.fields({ id: (id, path) => { if (typeof id !== "string" || /^(components|sections)\.[^\s]+$/.exec(id)?.[0] !== id) this.issue(path, "Expected a Designer component or section ID"); }, configId: this.string }),
      text: this.string, children: this.array(this.block), assetRef: this.asset(), claim: this.id("lx"), timing: this.fields({ startMs: this.count, endMs: this.count }),
    }, ["text", "children", "assetRef", "claim", "timing"]);
  };
}

export function validateWriterManifest(value: unknown, path = "writer.json"): WriterShapeIssue[] {
  const s = new Shape();
  s.obj(value, path, {
    consumer: s.string, messageSyntax: s.one("icu-mf1"), defaultLocale: s.locale,
    locales: s.array(s.fields({ tag: s.locale, dir: s.one("ltr", "rtl"), state: s.one("active", "planned", "pseudo") })),
    fallback: (v, p) => { if (!object(v)) { s.issue(p, "Expected a fallback map"); return; } for (const [tag, fallbacks] of Object.entries(v)) { s.locale(tag, `${p}.${tag}`); s.array(s.locale)(fallbacks, `${p}.${tag}`); } },
    strategy: s.fields({ root: s.strategyRoot, contract: s.one("writer.messaging") }), leafFreeze: s.fields(Object.fromEntries(WRITER_LAYERS.map(layer => [layer, s.string]))),
  });
  if (object(value) && Array.isArray(value.locales)) {
    const tags = new Set<string>();
    value.locales.forEach((locale: unknown, i: number) => {
      if (!object(locale) || typeof locale.tag !== "string") return;
      const tag = locale.tag.toLowerCase();
      if (tags.has(tag)) s.issue(`${path}.locales[${i}].tag`, "Locale tags must be unique");
      tags.add(tag);
      let canonical: string;
      try { canonical = canonicalLocale(locale.tag); } catch { return; }
      if (canonical === locale.tag) {
        const direction = intlDirectionFor(locale.tag);
        if (direction !== undefined && (locale.dir === "ltr" || locale.dir === "rtl") && locale.dir !== direction) {
          s.issue(`${path}.locales[${i}].dir`, `locale-direction: Expected ${direction} for ${locale.tag}`);
        }
      }
    });
    if (typeof value.defaultLocale === "string" && !tags.has(value.defaultLocale.toLowerCase())) s.issue(`${path}.defaultLocale`, "Default locale must be declared in locales");
  }
  return s.issues;
}

const COMMON_OPTIONAL = ["external", "approval", "translation"];

export function validateWriterRecord(value: unknown, layer: WriterLayer, path = "record"): WriterShapeIssue[] {
  const s = new Shape();
  if (!WRITER_LAYERS.includes(layer)) {
    s.issue(path, "Expected a valid Writer layer");
    return s.issues;
  }
  const validate = (fields: Record<string, Check>, optional: string[] = []) => s.obj(value, path, { ...s.common(layer), ...fields }, [...COMMON_OPTIONAL, ...optional]);
  if (!object(value)) { s.issue(path, "Expected a Writer record object"); return s.issues; }
  if (value.origin === "external" && !owns(value, "external")) s.issue(`${path}.external`, "External origin requires external metadata");
  if (value.origin !== "external" && owns(value, "external")) s.issue(`${path}.external`, "External metadata is only allowed for external origin");
  switch (layer) {
    case "lexicon": {
      const kind = s.one("voice-rule", "term", "pattern-rule", "claim", "format");
      switch (value.kind) {
        case "voice-rule": validate({ kind, rule: s.one("formality", "warmth", "energy", "person", "mood", "sentence-length", "reading-level"), value: (v, p) => { if (typeof v !== "string") s.number(v, p); }, forbidden: s.array(s.string) }, ["forbidden"]); break;
        case "term": validate({ kind, term: s.string, forms: s.array(s.string), casing: s.string, termStatus: s.one("brand", "preferred", "avoid"), alternative: s.string, reason: s.string, pronunciation: s.string, channel: s.string }, ["casing", "alternative", "pronunciation", "channel"]); break;
        case "pattern-rule": validate({ kind, pattern: s.fields({ source: s.string, flags: s.string }, ["flags"]), severity: s.one("error", "warning", "advisory"), reason: s.string, alternative: s.string }, ["alternative"]); break;
        case "claim": validate({ kind, strategy: s.cellRef, phrasings: s.array(s.string), requiresCitation: s.one(true) }); break;
        case "format": validate({ kind, format: s.one("number", "plural", "date", "time", "currency", "unit", "capitalization", "punctuation", "direction", "expansion"), value: (v, p) => { if (!object(v)) s.issue(p, "Expected a format configuration object"); else jsonValue(s, v, p); } }); break;
        default: validate({ kind });
      }
      break;
    }
    case "strings": validate({ text: s.string, args: s.array(s.fields({ name: s.string, type: s.one("string", "number", "date", "plural", "select") })), limits: s.fields({ maxChars: s.count, maxWords: s.count }, ["maxChars", "maxWords"]), assetRef: s.asset() }, ["args", "limits", "assetRef"]); break;
    case "patterns": {
      validate({ parts: s.map((v, p) => {
        if (!object(v)) { s.issue(p, "Expected a pattern part"); return; }
        if (owns(v, "text")) s.obj(v, p, { text: s.string });
        else s.obj(v, p, { ref: s.fields({ kind: s.one("string"), id: s.id("st") }) });
      }) });
      if (typeof value.leaf === "string" && object(value.parts)) {
        const contract = loadWriterCatalog().slots.find(slot => slot.id === value.leaf)?.contract.parts;
        if (object(contract) && contract.mode === "closed" && Array.isArray(contract.items)) {
          const items = contract.items.filter(object);
          const names = new Set(items.map(item => item.id));
          for (const name of Object.keys(value.parts)) if (!names.has(name)) s.issue(`${path}.parts.${name}`, "Unknown catalog pattern part");
          for (const item of items) if (item.required === true && typeof item.id === "string" && !owns(value.parts, item.id)) s.issue(`${path}.parts.${item.id}`, "Required catalog pattern part");
        }
      }
      break;
    }
    case "passages":
      validate({ schema: s.leaf("passages"), schemaDigest: s.string, fields: s.map(s.refs) });
      if (typeof value.schema === "string" && typeof value.leaf === "string" && value.schema !== value.leaf) s.issue(`${path}.schema`, "Passage schema must equal its leaf");
      break;
    case "narratives": {
      if (value.leaf === "narratives.site-chrome" || value.leaf === "narratives.app-chrome") {
        validate({ frame: s.fields({ frameId: s.string, configId: s.string }), regions: s.map(s.map(s.refs)) });
      } else if (value.leaf === "narratives.page-story" || value.leaf === "narratives.screen") {
        validate({ frame: s.fields({ frameId: s.string }), chrome: s.id("nr"), passages: s.array(s.id("ps")) }, ["chrome"]);
      } else {
        validate({ title: s.string, frame: s.fields({ frameId: s.string }), blocks: s.array(s.block) });
      }
      break;
    }
  }
  return s.issues;
}

// Format values are deliberately extensible JSON; reject non-JSON runtime values.
function jsonValue(s: Shape, value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { s.number(value, path); return; }
  if (Array.isArray(value)) { value.forEach((item, i) => jsonValue(s, item, `${path}[${i}]`)); return; }
  if (object(value)) { for (const [key, item] of Object.entries(value)) jsonValue(s, item, `${path}.${key}`); return; }
  s.issue(path, "Expected a JSON value");
}
