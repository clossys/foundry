/**
 * Scans declared live-copy trees for claim-shaped and magnitude-shaped prose
 * that is not accounted for in the voice claims register.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCopy, type VoiceFinding, type VoiceRecord } from "./voice/index.js";

const LIVE_FILE_RE = /\.(tsx?|jsx?|mdx?|md|json)$/i;
const IGNORE_MARKER_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*(?:copy-gate:ignore|voice-gate:ignore)/i;
const CLAIM_CITATION_RE = /(?:<!--|\/\*|\{\/\*|\/\/)\s*claim:([a-zA-Z][a-zA-Z0-9-]*)/g;

const NUMERIC_CLAIM_RE = new RegExp(
  [
    String.raw`[$€£]\s?\d[\d,]*(?:\.\d+)?\s?[kKmMbB]?\b`,
    String.raw`\b\d+(?:\.\d+)?\s?%`,
    String.raw`\b\d+(?:\.\d+)?[xX]\b`,
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    String.raw`\b\d+(?:\.\d+)?\s?(?:million|billion|thousand)\b`,
  ].join("|"),
  "gi",
);

export interface LiveCopyFinding extends VoiceFinding {
  file: string;
  line: number;
}

export interface LiveCopyScanResult {
  filesScanned: number;
  findings: LiveCopyFinding[];
}

function walkLiveTree(root: string): string[] {
  const files: string[] = [];
  const stack = [resolve(root)];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        stack.push(full);
      } else if (entry.isFile() && LIVE_FILE_RE.test(entry.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

function extractStringLiterals(text: string): { line: number; value: string }[] {
  const out: { line: number; value: string }[] = [];
  const lines = text.split(/\r?\n/);
  const literalRe = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (IGNORE_MARKER_RE.test(line)) continue;
    for (const m of line.matchAll(literalRe)) {
      const raw = m[0] as string;
      const value = raw.slice(1, -1);
      if (value.trim().length > 0) out.push({ line: i + 1, value });
    }
  }
  return out;
}

function lineHasClaimCitation(line: string): boolean {
  CLAIM_CITATION_RE.lastIndex = 0;
  return CLAIM_CITATION_RE.test(line);
}

export function scanLiveCopyTrees(record: VoiceRecord, roots: string[]): LiveCopyScanResult {
  const findings: LiveCopyFinding[] = [];
  let filesScanned = 0;

  for (const root of roots) {
    for (const file of walkLiveTree(root)) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      filesScanned++;
      const lines = text.split(/\r?\n/);
      for (const { line, value } of extractStringLiterals(text)) {
        const sourceLine = lines[line - 1] ?? "";
        if (lineHasClaimCitation(sourceLine)) continue;

        const voiceReport = checkCopy(record, value);
        for (const f of voiceReport.findings) {
          if (f.rule === "claim:unsupported") {
            findings.push({ ...f, file, line });
          }
        }

        if (NUMERIC_CLAIM_RE.test(value)) {
          NUMERIC_CLAIM_RE.lastIndex = 0;
          const covered = record.claims.some((claim) => {
            if (!claim.requiresSupport) return true;
            if (claim.factRef) return true;
            const phrases = claim.matchPhrases.length > 0 ? claim.matchPhrases : [claim.text];
            return phrases.some((p) => value.toLowerCase().includes(p.toLowerCase()));
          });
          if (!covered) {
            findings.push({
              rule: "live:magnitude-unmarked",
              severity: "error",
              message: `Magnitude-shaped copy is not covered by a supported claim in the voice register.`,
              path: value.slice(0, 80),
              file,
              line,
            });
          }
        }
      }
    }
  }

  return { filesScanned, findings };
}

export function liveTreeExists(path: string): boolean {
  try {
    return statSync(resolve(path)).isDirectory();
  } catch {
    return false;
  }
}
