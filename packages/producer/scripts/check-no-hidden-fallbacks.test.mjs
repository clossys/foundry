import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findHiddenFallbacks } from "./check-no-hidden-fallbacks.mjs";

function pkg(files) {
  const root = mkdtempSync(join(tmpdir(), "hidden-fallbacks-"));
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
}

test("a catch that returns a default, continues or is empty is a finding", () => {
  const root = pkg({
    "src/a.ts": "export function a() { try { return f(); } catch { return []; } }\n",
    "src/b.ts": "for (const x of xs) { try { g(x); } catch { continue; } }\n",
    "studio/lib/c.tsx": "try { h(); } catch { /* fall through */ }\n",
    "src/d.ts": "const mode = () => { try { return read(); } catch { return 'system'; } };\n",
    "src/e.ts": "const where = id => { try { return first.resolve(id); } catch { return second.resolve(id); } };\n",
    "src/f.ts": "const ok = p => { try { return check(p); } catch { return false || fallback; } };\n",
  });
  try { assert.deepEqual(findHiddenFallbacks(root).findings.map(finding => finding.path), ["src/a.ts:1", "src/b.ts:1", "src/d.ts:1", "src/e.ts:1", "src/f.ts:1", "studio/lib/c.tsx:1"]); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("a catch that rethrows, reads the error, reports it, hands on an error record or answers a probe passes; tests are out of scope", () => {
  const root = pkg({
    "src/a.ts": "try { f(); } catch { throw new Error('f failed'); }\n",
    "src/b.ts": "try { f(); } catch (error) { log(error); }\n",
    "src/c.ts": "try { f(); } catch { issues.push({ code: 'x' }); }\n",
    "src/d.ts": "try { f(); } catch { return { state: 'error', items: [] }; }\n",
    "src/e.ts": "try { f(); } catch { json(response, 400, { error: 'bad' }); }\n",
    "src/f.test.ts": "try { f(); } catch { return []; }\n",
    "src/g.ts": "try { f(); } catch { inputErrors.push('inputs could not be read'); }\n",
    "src/h.ts": "const state = () => { try { return f(); } catch { return 'invalid-pin'; } };\n",
    "src/i.ts": "const parse = () => { try { return f(); } catch { return { ok: false, message: 'not JSON' }; } };\n",
    "src/j.ts": "try { f(); } catch { row.candidatesError = true; }\n",
    "src/k.ts": "const isDir = p => { try { return stat(p).isDirectory(); } catch { return false; } };\n",
    "src/l.ts": "try { f(); } catch { return states(unavailable); }\n",
  });
  try { assert.deepEqual(findHiddenFallbacks(root).findings, []); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
