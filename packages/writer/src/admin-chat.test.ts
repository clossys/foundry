import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ADMIN_CHAT_COPY_EN, getAdminCopy, getAdminCopyRecord, resolveAdminCopyRef } from "./admin-copy.js";
import { mainAdminCopyDraft } from "./admin-copy-draft-cli.js";

it("authors valid unapproved chat records through the draft command and exposes intended CopyRef consumers", () => {
  const root = mkdtempSync(join(tmpdir(), "writer-chat-copy-"));
  try {
    const input = join(root, "input.json"), output = join(root, "draft.json");
    writeFileSync(input, JSON.stringify({ locale: "en", records: ADMIN_CHAT_COPY_EN.records }));
    expect(mainAdminCopyDraft([input, output], { stdout() {}, stderr() {} })).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).records).toEqual(ADMIN_CHAT_COPY_EN.records);
    expect(ADMIN_CHAT_COPY_EN).toMatchObject({ state: "draft", activation: "none", locale: "en" });
    expect(getAdminCopy().envelopes).toContain(ADMIN_CHAT_COPY_EN);
    const allIds = getAdminCopy().records.map(record => record.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const record of ADMIN_CHAT_COPY_EN.records) {
      expect(getAdminCopyRecord(record.id)).toBe(record);
      expect(Object.isFrozen(record)).toBe(true);
      expect(record.status).toBe("draft");
      expect(record).not.toHaveProperty("approval");
      expect(ADMIN_CHAT_COPY_EN.bindings.filter(binding => binding.recordId === record.id)).toEqual([
        { cellId: record.context, recordId: record.id, target: record.context.endsWith("account.signIn") ? "AccountMenu" : "Chat", kind: "CopyRef" },
      ]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("resolves chat state, context, limits and all declared arguments without English fallbacks or approval", () => {
  const ref = (key: string) => ({ id: ADMIN_CHAT_COPY_EN.bindings.find(binding => binding.cellId === `admin.writer.chat.${key}`)!.recordId });
  expect(ADMIN_CHAT_COPY_EN.records.filter(record => record.context.startsWith("admin.writer.chat.starter."))).toHaveLength(4);
  expect(resolveAdminCopyRef(ref("account.signIn"))).toMatchObject({ text: "Sign in", status: "draft", activation: "none" });
  expect(resolveAdminCopyRef({ ...ref("context.using"), values: { context: "Writer / selected record" } })?.text).toBe("Using: Writer / selected record");
  expect(resolveAdminCopyRef({ ...ref("message.branch"), values: { current: 2, total: 3 } })?.text).toBe("2 / 3");
  expect(resolveAdminCopyRef({ ...ref("reasoning.duration"), values: { seconds: 12 } })?.text).toBe("Thought for 12s");
  expect(resolveAdminCopyRef({ ...ref("composer.characterLimit"), values: { count: 42, limit: 1000 } })?.text).toBe("Characters: 42 / 1,000");
  for (const record of ADMIN_CHAT_COPY_EN.records) {
    const values = Object.fromEntries((record.args ?? []).map(arg => [arg.name, arg.type === "number" ? 2 : `sample ${arg.name}`]));
    expect(resolveAdminCopyRef({ id: record.id, values }), record.context).toMatchObject({ status: "draft", servedLocale: "en", activation: "none" });
    if (record.args?.length) expect(resolveAdminCopyRef({ id: record.id }), record.context).toBeUndefined();
    expect(resolveAdminCopyRef({ id: record.id, locale: "fr", values })).toBeUndefined();
  }
  expect(resolveAdminCopyRef({ id: "st.0000000000" })).toBeUndefined();
});
