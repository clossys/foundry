import { describe, expect, it } from "vitest";
import { BOTH, PAGE, node, rec, setPage, snapshotProperties, start, validSnapshot } from "./posthog-fake.test.js";

describe("PostHog review regressions", () => {
  it.each(["meta", "custom"])("latches an unsafe %s address even when another record fails masking", (kind) => {
    setPage();
    const { fake } = start(BOTH);
    const address = `${PAGE}?token=example`;
    const navigation = kind === "meta" ? rec.meta(address) : rec.custom({ href: address });
    expect(fake.emit("$snapshot", snapshotProperties([rec.input("unmasked"), navigation]))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties([rec.mutation({ attributes: [{ id: 1, attributes: { href: address } }] })]))).toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it("latches an unsafe address even when an earlier record cannot decode", () => {
    setPage();
    const { fake } = start(BOTH);
    const address = `${PAGE}?token=example`;
    expect(fake.emit("$snapshot", snapshotProperties([rec.input(5), rec.meta(address)]))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot()))).toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it.each(["snapshot", "added node", "mutation"])("rejects a non-string attribute value in a %s", (kind) => {
    setPage();
    const { fake } = start(BOTH);
    const attributes = { title: { textContent: "unmasked" } };
    const record = kind === "snapshot"
      ? rec.fullSnapshot([node.element("div", attributes)])
      : kind === "added node"
        ? rec.mutation({ adds: [{ parentId: 1, nextId: null, node: node.element("div", attributes) }] })
        : rec.mutation({ attributes: [{ id: 1, attributes }] });
    expect(fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), record]))).toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it("accepts string attributes and attribute-removal markers", () => {
    setPage();
    const { fake } = start(BOTH);
    expect(fake.emit("$snapshot", snapshotProperties([
      rec.meta(PAGE),
      rec.fullSnapshot([node.element("div", { title: "kept" })]),
      rec.mutation({ attributes: [{ id: 1, attributes: { title: null } }] }),
    ]))).not.toBeNull();
  });

  it.each(["attr__data-private", "attr__data-consent-banner", "attr__contenteditable"])("rejects malformed legacy %s markers", (marker) => {
    setPage();
    const { fake } = start({ autocapture: true });
    const target = { tag_name: "button", "attr__data-analytics-id": "cta" };
    const elements = marker === "attr__contenteditable"
      ? [{ ...target, [marker]: true }]
      : [target, { tag_name: "div", [marker]: true }];
    expect(fake.emit("$autocapture", { $event_type: "click", $current_url: PAGE, $elements: elements })).toBeNull();
    expect(fake.sent).toEqual([]);
  });
});
