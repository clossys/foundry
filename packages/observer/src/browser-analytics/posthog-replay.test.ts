import { describe, expect, it } from "vitest";
import { createPostHogProvider } from "./providers/posthog.js";
import { REPLAY_CAPABILITY_FIELDS, REPLAY_RECORDING_OPTIONS } from "./providers/posthog-options.js";
import {
  BOTH,
  CHAIN_PARTS,
  GOOD_PROBE,
  MASK,
  PAGE,
  chain,
  clickProperties,
  configFor,
  createFake,
  initOnly,
  node,
  rec,
  setPage,
  snapshotProperties,
  start,
  validSnapshot,
  type FakeOptions,
  type FlagOptions,
} from "./posthog-fake.test.js";

const SECRET = "secret-page-text";

/** Starts replay on a clean page and returns the fake and provider. */
function replaying(flags: FlagOptions = BOTH, fakeOptions: FakeOptions = {}) {
  setPage();
  const started = start(flags, fakeOptions);
  expect(started.fake.names()).toContain("startSessionRecording");
  return started;
}

/** The `$snapshot_data` the hook sends for a payload, or `null` when it drops the event. */
function snapshotOut(data: unknown, flags: FlagOptions = BOTH): unknown[] | null {
  const { fake } = replaying(flags);
  const out = fake.emit("$snapshot", snapshotProperties(data)) as { properties: Record<string, unknown> } | null;
  if (out && JSON.stringify(out).includes(SECRET)) throw new Error("a corpus string reached the seam");
  return out ? (out.properties.$snapshot_data as unknown[]) : null;
}

function withRecords(...records: unknown[]): unknown[] {
  return [rec.meta(PAGE), ...records];
}

function started(fake: ReturnType<typeof createFake>): boolean {
  return fake.names().includes("startSessionRecording");
}

describe("P-38 posthog-replay: eligibility (C-68)", () => {
  it("replay starts once, after the gate opens and after the session id is read, when all five conditions hold", () => {
    const { fake } = replaying();
    expect(fake.names()).toEqual(["opt_in_capturing", "get_session_id", "startSessionRecording"]);
    expect(fake.calls.at(-1)?.gate).toBe(true);
  });

  it("calls the probe exactly once, at init, and never again on a later grant", () => {
    setPage();
    let probes = 0;
    const { provider } = start({ replay: true, probe: () => (probes += 1, { ...GOOD_PROBE }) });
    provider.optOut();
    provider.optIn();
    expect(probes).toBe(1);
  });

  const BAD_PROBES: Array<[string, () => unknown]> = [
    ["a throwing probe", () => { throw new Error("no"); }],
    ["a promise-returning probe", () => Promise.resolve({ ...GOOD_PROBE })],
    ["a thenable probe report with every field true", () => ({ ...GOOD_PROBE, then() {} })],
    ["a probe returning undefined", () => undefined],
    ["a probe returning null", () => null],
    ["a probe returning a string", () => "true"],
    ["a probe returning an empty object", () => ({})],
    ...REPLAY_CAPABILITY_FIELDS.flatMap((field): Array<[string, () => unknown]> => [
      [`${field} false`, () => ({ ...GOOD_PROBE, [field]: false })],
      [`${field} "true"`, () => ({ ...GOOD_PROBE, [field]: "true" })],
      [`${field} 1`, () => ({ ...GOOD_PROBE, [field]: 1 })],
      [`${field} missing`, () => { const { [field]: _omitted, ...rest } = GOOD_PROBE; return rest; }],
    ]),
  ];

  it.each(BAD_PROBES)("never starts recording, and pageviews and autocapture still work: %s", (_label, probe) => {
    setPage();
    const { fake, provider } = start({ ...BOTH, probe });
    expect(started(fake)).toBe(false);
    expect(fake.names()).not.toContain("get_session_id");
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(fake.sent.map((event) => event.event)).toEqual(["$pageview", "$autocapture"]);
    fake.emit("$snapshot", snapshotProperties(validSnapshot()));
    expect(fake.sent).toHaveLength(2);
  });

  const ALTERATIONS: Array<[string, (configured: unknown) => unknown]> = [
    ...Object.entries({
      maskAllInputs: false,
      maskTextSelector: "p",
      blockSelector: "[data-private]",
      recordHeaders: true,
      recordBody: true,
      recordCanvas: true,
      compressEvents: true,
      recordCrossOriginIframes: true,
    }).map(([key, value]): [string, (configured: unknown) => unknown] => [
      `${key} altered`,
      (configured) => ({ ...(configured as object), [key]: value }),
    ]),
    ...Object.keys(REPLAY_RECORDING_OPTIONS).map((key): [string, (configured: unknown) => unknown] => [
      `${key} missing`,
      (configured) => {
        const { [key]: _omitted, ...rest } = configured as Record<string, unknown>;
        return rest;
      },
    ]),
    ["no recording options", () => undefined],
    ["recording options not an object", () => "on"],
    ["recording options null", () => null],
  ];

  it.each(ALTERATIONS)("a read-back with %s at init leaves replay off", (_label, alter) => {
    setPage();
    const fake = createFake();
    fake.reportedRecording = alter;
    const provider = createPostHogProvider(fake.sdk, configFor(BOTH));
    provider.init({ sanitizeUrl: (href) => href, eventNames: ["$pageview"] });
    provider.optIn();
    expect(started(fake)).toBe(false);
    expect(fake.names()).not.toContain("get_session_id");
    fake.emit("$autocapture", clickProperties(chain(CHAIN_PARTS.target)));
    expect(fake.sent.some((event) => event.event === "$autocapture")).toBe(true);
  });

  it("the console-log read-back must be exactly false", () => {
    for (const reported of [true, undefined, "false", 0]) {
      setPage();
      const fake = createFake();
      fake.reportedConsoleLog = () => reported;
      const provider = createPostHogProvider(fake.sdk, configFor(BOTH));
      provider.init({ sanitizeUrl: (href) => href, eventNames: ["$pageview"] });
      provider.optIn();
      expect(started(fake)).toBe(false);
    }
  });

  it("a recording block read back with an extra key still starts, so the SDK may add its own defaults", () => {
    setPage();
    const fake = createFake();
    fake.reportedRecording = (configured) => ({ ...(configured as object), sdkDefault: 1 });
    const provider = createPostHogProvider(fake.sdk, configFor(BOTH));
    provider.init({ sanitizeUrl: (href) => href, eventNames: ["$pageview"] });
    provider.optIn();
    expect(started(fake)).toBe(true);
  });

  it.each(["startSessionRecording", "stopSessionRecording", "reset", "get_session_id"])("an instance without %s never starts recording", (method) => {
    setPage();
    const { fake, provider } = start(BOTH, { omit: [method] });
    expect(started(fake)).toBe(false);
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.sent.some((event) => event.event === "$pageview")).toBe(true);
  });

  it("sampleRate 0, an unselected draw and a page with no secure random source never start recording", () => {
    setPage();
    let probes = 0;
    const zero = start({ replay: true, sampleRate: 0, probe: () => (probes += 1, { ...GOOD_PROBE }) });
    expect(started(zero.fake)).toBe(false);
    expect(probes).toBe(0);

    setPage({ draws: [0.5] });
    expect(started(start({ replay: true, sampleRate: 0.5 }).fake)).toBe(false);

    setPage({ draws: [0.4999] });
    expect(started(start({ replay: true, sampleRate: 0.5 }).fake)).toBe(true);

    setPage({ draws: "none" });
    const { fake, provider } = start({ ...BOTH });
    expect(started(fake)).toBe(false);
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.sent.some((event) => event.event === "$pageview")).toBe(true);
  });

  it("each grant draws once, so a later grant can be selected when the first was not", () => {
    setPage({ draws: [0.9, 0.1] });
    const { fake, provider } = start({ replay: true, sampleRate: 0.5 });
    expect(started(fake)).toBe(false);
    provider.optOut();
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
  });

  it("on a re-grant, a read-back altered after init skips that start and every later one", () => {
    const { fake, provider } = replaying();
    provider.optOut();
    fake.reportedRecording = (configured) => ({ ...(configured as object), maskAllInputs: false });
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
    fake.reportedRecording = null;
    provider.optOut();
    provider.optIn();
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(1);
    // The grant is otherwise normal: the gate is open and a pageview still goes out.
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.sent.some((event) => event.event === "$pageview")).toBe(true);
  });

  it("the read-back also runs before the first start, so an alteration between init and optIn skips it", () => {
    setPage();
    const { fake, provider } = initOnly(BOTH);
    fake.reportedRecording = (configured) => ({ ...(configured as object), recordCanvas: true });
    provider.optIn();
    expect(started(fake)).toBe(false);
  });

  it("a throwing startSessionRecording does not fail the grant, and a withdrawal still stops recording", () => {
    setPage();
    const { fake, provider } = start(BOTH, { throwIn: ["startSessionRecording"] });
    expect(started(fake)).toBe(true);
    provider.capture({ kind: "pageview", url: "https://example.test/", properties: {} });
    expect(fake.sent.some((event) => event.event === "$pageview")).toBe(true);
    provider.optOut();
    expect(fake.names()).toContain("stopSessionRecording");
  });

  it("a snapshot meta href is rewritten to the sanitized URL, and one that cannot be rewritten drops the event", () => {
    setPage();
    const fake = createFake();
    const provider = createPostHogProvider(fake.sdk, configFor(BOTH));
    provider.init({
      sanitizeUrl: (href) => (href.startsWith("https://example.test") ? "https://example.test/rewritten" : null),
      eventNames: ["$pageview"],
    });
    provider.optIn();
    const out = fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), rec.incremental(3, { id: 1, x: 0, y: 0 })])) as {
      properties: { $snapshot_data: Array<{ type: number; data: { href?: string } }> };
    } | null;
    expect(out?.properties.$snapshot_data[0]?.data.href).toBe("https://example.test/rewritten");

    const dropped = fake.emit("$snapshot", snapshotProperties([rec.meta("https://other.test/"), rec.incremental(3, { id: 1 })]));
    expect(dropped).toBeNull();
  });

  it("the input payload is not changed by the hook", () => {
    const { fake } = replaying();
    const payload = validSnapshot();
    const copy = JSON.stringify(payload);
    fake.emit("$snapshot", snapshotProperties(payload));
    expect(JSON.stringify(payload)).toBe(copy);
  });
});

describe("P-41 posthog-replay: payload check (C-68)", () => {
  it("a fully masked payload passes with its custom records removed and style text kept", () => {
    const out = snapshotOut(validSnapshot());
    expect(out).not.toBeNull();
    expect(out!.some((record) => (record as { type: number }).type === 5)).toBe(false);
    expect(out).toHaveLength(validSnapshot().length - 1);
    expect(JSON.stringify(out)).toContain("body { color: red }");
    expect(JSON.stringify(out)).toContain("kept");
  });

  it("masked forms pass: asterisks, whitespace, empty text, and a null text-change or attribute marker", () => {
    const data = withRecords(
      rec.fullSnapshot([node.element("p", {}, [node.text(""), node.text("   "), node.text("* ** \n*")])]),
      rec.mutation({ texts: [{ id: 1, value: null }], attributes: [{ id: 2, attributes: { value: null } }] }),
      rec.input(""),
    );
    expect(snapshotOut(data)).not.toBeNull();
  });

  const DROP: Array<[string, unknown]> = [
    ["a string-encoded payload", "H4sIAAAAAAAA/6tWKkktLlGyUlAqSS0uUbJSyk/KSU0uyQAAAA=="],
    ["a payload that is an object", { 0: rec.meta(PAGE) }],
    ["an empty payload", []],
    ["a null payload", null],
    ["a payload holding a string record", [rec.meta(PAGE), "eJzLSM3JyQcABiwCFQ=="]],
    ["a payload holding a null record", [rec.meta(PAGE), null]],
    ["a payload holding a number record", [rec.meta(PAGE), 7]],
    ["a payload holding an array record", [rec.meta(PAGE), []]],
    ["a record whose data is a string", [rec.meta(PAGE), { type: 3, data: "eJzLSM3JyQcABiwCFQ==", timestamp: 1 }]],
    ["a custom record whose data is a string", [rec.meta(PAGE), { type: 5, data: "eJzLSM3JyQcABiwCFQ==", timestamp: 1 }]],
    ["a full snapshot record whose data is a string", [rec.meta(PAGE), { type: 2, data: "eJzLSM3JyQcABiwCFQ==", timestamp: 1 }]],
    ["a meta record whose data is a string", [{ type: 4, data: "eJzLSM3JyQcABiwCFQ==", timestamp: 1 }]],
    ["a record whose data is an array", [rec.meta(PAGE), { type: 3, data: [], timestamp: 1 }]],
    ["a record with a compression marker cv", [rec.meta(PAGE), { ...rec.incremental(3, { id: 1 }), cv: "2024-10" }]],
    ["a record with a version marker v", [rec.meta(PAGE), { ...rec.incremental(3, { id: 1 }), v: "v1" }]],
    ["a record with no type", [rec.meta(PAGE), { data: { source: 3 } }]],
    ["a record whose type is a string", [rec.meta(PAGE), { type: "3", data: { source: 3 } }]],
    ["a record of an unlisted type", [rec.meta(PAGE), { type: 1, data: {} }]],
    ["a record of type 0", [rec.meta(PAGE), { type: 0, data: {} }]],
    ["an incremental record with no source", [rec.meta(PAGE), { type: 3, data: {} }]],
    ["an incremental record of an unlisted source", [rec.meta(PAGE), rec.incremental(99)]],
    ["a canvas mutation record", [rec.meta(PAGE), rec.incremental(9, { id: 1, type: 0, commands: [{ property: "x", args: [] }] })]],
    ["a log record", [rec.meta(PAGE), rec.incremental(11, { level: "log", trace: [], payload: [SECRET] })]],
    ["a font record", [rec.meta(PAGE), rec.incremental(10, { family: "x" })]],
    ["a selection record", [rec.meta(PAGE), rec.incremental(14, { ranges: [] })]],
    ["a console plugin record", [rec.meta(PAGE), rec.plugin("rrweb/console@1", { level: "log", payload: [SECRET] })]],
    ["a network plugin record", [rec.meta(PAGE), rec.plugin("rrweb/network@1", { requests: [{ url: SECRET }] })]],
    ["any other plugin record", [rec.meta(PAGE), rec.plugin("other@1", {})]],
    ["a meta record with no href", [{ type: 4, data: { width: 1, height: 1 } }]],
    ["a meta record whose href is a number", [{ type: 4, data: { href: 5 } }]],
    ["a full snapshot with no node", [rec.meta(PAGE), { type: 2, data: {} }]],
    ["an unmasked text node in a full snapshot", withRecords(rec.fullSnapshot([node.element("p", {}, [node.text(SECRET)])]))],
    ["an unmasked comment node", withRecords(rec.fullSnapshot([node.comment(SECRET)]))],
    ["an unmasked CDATA node", withRecords(rec.fullSnapshot([node.cdata(SECRET)]))],
    ["a comment node marked as style text", withRecords(rec.fullSnapshot([node.element("style", {}, [{ ...node.comment(SECRET), isStyle: true }])]))],
    ["a script element's text", withRecords(rec.fullSnapshot([node.element("script", {}, [node.text(SECRET)])]))],
    ["a text node whose isStyle is not a boolean", withRecords(rec.fullSnapshot([node.element("style", {}, [node.text(SECRET, { isStyle: "true" })])]))],
    ["a text node with a partly masked value", withRecords(rec.fullSnapshot([node.element("p", {}, [node.text("***a***")])]))],
    ["a text node whose text is not a string", withRecords(rec.fullSnapshot([node.element("p", {}, [{ type: 3, textContent: 5, id: 1 }])]))],
    ["a text node with no text", withRecords(rec.fullSnapshot([node.element("p", {}, [{ type: 3, id: 1 }])]))],
    ["a node of an unknown type", withRecords(rec.fullSnapshot([{ type: 9, id: 1 }]))],
    ["a node that is not an object", withRecords(rec.fullSnapshot(["text"]))],
    ["a node whose child list is not an array", withRecords(rec.fullSnapshot([{ type: 2, tagName: "p", attributes: {}, childNodes: "x", id: 1 }]))],
    ["a node whose attributes are a string", withRecords(rec.fullSnapshot([{ type: 2, tagName: "p", attributes: "x", childNodes: [], id: 1 }]))],
    ["an unmasked text node inside a shadow root", withRecords(rec.fullSnapshot([node.element("div", {}, [{ ...node.element("#shadow-root", {}, [node.text(SECRET)]), isShadow: true }])]))],
    ["an unmasked text node inside a same-origin iframe document", withRecords(rec.fullSnapshot([node.element("iframe", {}, [node.document([node.element("html", {}, [node.text(SECRET)])])])]))],
    ["an unmasked value attribute in a snapshot", withRecords(rec.fullSnapshot([node.element("input", { type: "text", value: SECRET })]))],
    ["a value attribute that is not a string in a snapshot", withRecords(rec.fullSnapshot([node.element("input", { value: 5 })]))],
    ["a null value attribute in a snapshot", withRecords(rec.fullSnapshot([node.element("input", { value: null })]))],
    ["an unmasked text node in a mutation's added nodes", withRecords(rec.mutation({ adds: [{ parentId: 1, nextId: null, node: node.element("p", {}, [node.text(SECRET)]) }] }))],
    ["an unmasked text node in a mutation's added shadow root", withRecords(rec.mutation({ adds: [{ parentId: 1, nextId: null, node: node.element("div", {}, [{ ...node.element("#shadow-root", {}, [node.text(SECRET)]), isShadow: true }]) }] }))],
    ["an unmasked value attribute in a mutation's added node", withRecords(rec.mutation({ adds: [{ parentId: 1, nextId: null, node: node.element("input", { value: SECRET }) }] }))],
    ["an unmasked text change", withRecords(rec.mutation({ texts: [{ id: 1, value: SECRET }] }))],
    ["a text change whose value is a number", withRecords(rec.mutation({ texts: [{ id: 1, value: 5 }] }))],
    ["an unmasked value in an attribute mutation", withRecords(rec.mutation({ attributes: [{ id: 1, attributes: { value: SECRET } }] }))],
    ["a numeric value in an attribute mutation", withRecords(rec.mutation({ attributes: [{ id: 1, attributes: { value: 5 } }] }))],
    ["an unmasked input record", withRecords(rec.input(SECRET))],
    ["an input record whose text is a number", withRecords(rec.input(5))],
    ["an input record with no text", withRecords({ type: 3, data: { source: 5, isChecked: false, id: 1 } })],
    ["a mutation whose data is an object but whose adds are an encoded string", withRecords(rec.mutation({ adds: "eJzLSM3JyQcABiwCFQ==" }))],
    ["a mutation whose text changes are an encoded string", withRecords(rec.mutation({ texts: "eJzLSM3JyQcABiwCFQ==" }))],
    ["a mutation whose attribute changes are an encoded string", withRecords(rec.mutation({ attributes: "eJzLSM3JyQcABiwCFQ==" }))],
    ["a mutation whose removals are an encoded string", withRecords(rec.mutation({ removes: "eJzLSM3JyQcABiwCFQ==" }))],
    ["a mutation whose text change is a string", withRecords(rec.mutation({ texts: ["x"] }))],
    ["a mutation whose attribute change has encoded attributes", withRecords(rec.mutation({ attributes: [{ id: 1, attributes: "x" }] }))],
    ["a mutation add that is not an object", withRecords(rec.mutation({ adds: ["x"] }))],
    ["a mutation add whose node is missing", withRecords(rec.mutation({ adds: [{ parentId: 1 }] }))],
  ];

  it.each(DROP)("is dropped whole: %s", (_label, data) => {
    expect(snapshotOut(data)).toBeNull();
  });

  it("one bad record drops a payload of otherwise good records", () => {
    const good = validSnapshot();
    expect(snapshotOut([...good, rec.input(SECRET)])).toBeNull();
    expect(snapshotOut([rec.input(SECRET), ...good])).toBeNull();
    expect(snapshotOut([...good, rec.plugin("rrweb/console@1")])).toBeNull();
  });

  it("a payload nested 20000 levels deep is checked at any depth without a call-depth failure", () => {
    const deep = (leaf: unknown) => {
      let current: unknown = leaf;
      for (let i = 0; i < 20_000; i += 1) current = node.element("div", {}, [current]);
      return current;
    };
    // The output is not serialized here: a structure this deep exceeds the JSON stringifier's own stack.
    const { fake } = replaying();
    expect(fake.emit("$snapshot", snapshotProperties(withRecords(rec.fullSnapshot([deep(node.text(SECRET))]))))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(withRecords(rec.fullSnapshot([deep(node.text(MASK))]))))).not.toBeNull();
  });

  it("an unmasked value hidden among many masked records is found", () => {
    const records = Array.from({ length: 2000 }, () => rec.input(MASK));
    expect(snapshotOut([rec.meta(PAGE), ...records, rec.input(SECRET)])).toBeNull();
    expect(snapshotOut([rec.meta(PAGE), ...records])).not.toBeNull();
  });

  it("no corpus string other than masked text reaches the fake seam", () => {
    const { fake } = replaying();
    for (const [, data] of DROP) fake.emit("$snapshot", snapshotProperties(data));
    expect(JSON.stringify(fake.sent)).not.toContain(SECRET);
    expect(JSON.stringify(fake.calls)).not.toContain(SECRET);
    expect(fake.sent).toEqual([]);
  });

  it("a snapshot that fails the check does not stop the next good one", () => {
    const { fake } = replaying();
    expect(fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), rec.input(SECRET)]))).toBeNull();
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot()))).not.toBeNull();
  });
});

describe("P-42 posthog-replay: query and fragment (C-68, C-20)", () => {
  const SNAPSHOT = () => snapshotProperties(validSnapshot());

  it("a page address with a non-empty query or fragment drops the snapshot, and every later one of the grant even once the address is clean", () => {
    for (const dirty of ["https://example.test/pricing?plan=pro", "https://example.test/pricing#section", "https://example.test/pricing?a=1#b"]) {
      const { fake } = replaying();
      expect(fake.emit("$snapshot", SNAPSHOT())).not.toBeNull();
      setPage({ href: dirty });
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
      setPage({ href: PAGE });
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    }
  });

  it("a clean page address but a load address carrying a query or fragment drops the snapshot and latches", () => {
    for (const load of ["https://example.test/pricing?token=abc", "https://example.test/pricing#token"]) {
      setPage({ load });
      const { fake } = start(BOTH);
      expect(started(fake)).toBe(true);
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
      setPage({ load: PAGE });
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    }
  });

  it("a load address that is unavailable is not a failure; one that cannot be read is", () => {
    setPage({ load: null });
    expect(start(BOTH).fake.emit("$snapshot", SNAPSHOT())).not.toBeNull();

    setPage({ load: "throw" });
    const { fake } = start(BOTH);
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    setPage({ load: PAGE });
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
  });

  it("an address that does not parse counts as unsafe, on the page and in a custom record, and latches", () => {
    const { fake } = replaying();
    setPage({ href: "not a url" });
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    setPage();
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();

    const second = replaying();
    expect(second.fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), rec.custom({ href: "http://" })]))).toBeNull();
    expect(second.fake.emit("$snapshot", SNAPSHOT())).toBeNull();
  });

  it("a page whose address cannot be read drops the snapshot", () => {
    const { fake } = replaying();
    setPage({ href: null });
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
  });

  it("a meta record's href with a query or fragment drops the snapshot and latches, read before the rewrite", () => {
    for (const href of ["https://example.test/pricing?x=1", "https://example.test/pricing#frag"]) {
      const { fake } = replaying();
      // The default sanitizer would rewrite the address clean, so only a check before the rewrite drops it.
      expect(fake.emit("$snapshot", snapshotProperties([rec.meta(href), rec.input(MASK)]))).toBeNull();
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    }
  });

  it("a custom record's address with a query or fragment drops the snapshot and latches, at any depth", () => {
    for (const payload of [
      { href: "https://example.test/pricing?x=1" },
      { nested: { deeper: [{ url: "http://example.test/a#frag" }] } },
      { list: ["ok", "  https://example.test/x?y=1"] },
    ]) {
      const { fake } = replaying();
      expect(fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), rec.custom(payload)]))).toBeNull();
      expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    }
  });

  it("on a clean page, attribute values holding a link and empty query and fragment markers are accepted", () => {
    const { fake } = replaying();
    const data = [
      rec.meta("https://example.test/pricing?"),
      rec.meta("https://example.test/pricing#"),
      rec.fullSnapshot([node.element("a", { href: "https://example.test/other?x=1#y", title: "a link" }, [node.text(MASK)])]),
    ];
    expect(fake.emit("$snapshot", snapshotProperties(data))).not.toBeNull();
  });

  it("a snapshot dropped for another reason does not latch the grant", () => {
    const { fake } = replaying();
    expect(fake.emit("$snapshot", snapshotProperties([rec.meta(PAGE), rec.input(SECRET)]))).toBeNull();
    expect(fake.emit("$snapshot", SNAPSHOT())).not.toBeNull();
  });

  it("a new grant on a clean address records again", () => {
    const { fake, provider } = replaying();
    setPage({ href: "https://example.test/pricing?x=1" });
    expect(fake.emit("$snapshot", SNAPSHOT())).toBeNull();
    provider.optOut();
    setPage();
    provider.optIn();
    expect(started(fake)).toBe(true);
    expect(fake.names().filter((name) => name === "startSessionRecording")).toHaveLength(2);
    expect(fake.emit("$snapshot", snapshotProperties(validSnapshot(), fake.session.id as string))).not.toBeNull();
  });
});
