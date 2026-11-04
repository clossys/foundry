import { describe, expect, it } from "vitest";
import { metadata } from "./transaction.js";
// Root-scoped writes (confinement, lock, all-or-nothing commit) belong to the injected store:
// packages/producer/src/records/director-store.test.ts.
describe("cell metadata edits", () => {
  it("changes frontmatter alone and preserves CRLF body bytes", () => {
    const bytes = "---\r\nid: focus.segment.core\r\nstatus: draft\r\n---\r\n\r\n## Direction\r\n- status: draft\r\n";
    expect(metadata(bytes, { status: "active", confirmed: "msg:2026-10-29-1#U3" })).toBe(bytes.replace("status: draft\r\n---", "status: active\r\nconfirmed: msg:2026-10-29-1#U3\r\n---"));
  });
});
