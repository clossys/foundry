import { describe, expect, it } from "vitest";
import { parseFill } from "./cell.js";
import { EXAMPLE_FILLS, EXAMPLE_RESOLVED } from "./__fixtures__/example-library.js";

const slot = "tokens.color-ramp";
const id = `x/${slot}`;
const token = { $type: "color", $value: "#fff" };
const meta = { id, slot, source: "x" };
const root = (tokens: unknown, metadata: unknown = meta) => ({ $extensions: { "com.clossys.fill": metadata }, tokens });
const ramp = (value: unknown) => ({ "color-ramp": value });
const reason = (text: string, subject = id) => `contract: ${subject} is not a valid DTCG cell: ${text}`;
const messages = (value: unknown) => parseFill(value).findings.map(finding => finding.message);

describe("parseFill", () => {
  it("returns the clean cell", () => {
    const fill = root(ramp({ red: { "500": token } }));
    expect(parseFill(fill)).toEqual({ fill, findings: [] });
  });
  it("requires a plain root with metadata and tokens", () => {
    expect(messages(null)).toEqual([reason("missing fill metadata", "(unidentified)"), reason("missing tokens root", "(unidentified)")]);
  });
  it("requires plain fill metadata", () => {
    expect(messages(root(ramp({ a: token }), []))).toEqual([reason("missing fill metadata", "(unidentified)")]);
  });
  it.each([undefined, [], null, 1])("requires a plain tokens root: %s", tokens => {
    expect(messages(root(tokens))).toEqual([reason("missing tokens root")]);
  });
  it("rejects each extra root key", () => {
    expect(messages({ ...root(ramp({ red: { "500": token } })), extra: 1 })).toEqual([reason("extra root key extra")]);
  });
  it("requires a token type", () => {
    expect(messages(root(ramp({ a: { $value: "#fff" } })))).toEqual([reason("token tokens.color-ramp.a has no $type")]);
    expect(messages(root(ramp({ a: { $type: 1, $value: "#fff" } })))).toEqual([reason("token tokens.color-ramp.a has no $type")]);
  });
  it.each([null, [], 1])("requires values on non-object nodes: %s", value => {
    expect(messages(root(ramp({ a: value })))).toEqual([reason("token tokens.color-ramp.a has no $value")]);
  });
  it("requires values on empty leaves and reports both defects in sorted order", () => {
    expect(messages(root(ramp({ a: {} })))).toEqual([reason("token tokens.color-ramp.a has no $type"), reason("token tokens.color-ramp.a has no $value")]);
    expect(messages(root(ramp({ a: { $type: "color" } })))).toEqual([reason("token tokens.color-ramp.a has no $value")]);
  });
  it("rejects child entries on tokens", () => {
    expect(messages(root(ramp({ a: { ...token, child: token } })))).toEqual([reason("token tokens.color-ramp.a has child entries")]);
  });
  it("rejects inherited group types", () => {
    expect(messages(root({ "color-ramp": { $type: "color", a: token } }))).toEqual([reason("group-level $type at tokens.color-ramp is not supported")]);
  });
  it("requires strict membership under the slot path", () => {
    expect(messages(root({ "color-rampx": { a: token } }))).toEqual([reason("token tokens.color-rampx.a lies outside slot tokens.color-ramp")]);
    expect(messages(root({ typeface: { body: token } }))).toEqual([reason("token tokens.typeface.body lies outside slot tokens.color-ramp")]);
    expect(messages(root(ramp(token)))).toEqual([reason("token tokens.color-ramp lies outside slot tokens.color-ramp"), "id: member tokens.color-ramp is not a valid member id"]);
  });
  it.each([
    [{ ...meta, id: "bad" }, ["id: fill bad is not a valid fill id"]],
    [{ ...meta, slot: "Tokens.color-ramp" }, [reason("token tokens.color-ramp.a lies outside slot Tokens.color-ramp"), "id: slot Tokens.color-ramp is not a valid slot id"]],
    [{ ...meta, source: "Bad" }, ["id: source Bad is not a valid source id"]],
    [{ ...meta, conforms: ["dtcg#Alias"] }, ["id: clause dtcg#Alias is not a valid clause id"]],
  ])("validates metadata ids: %j", (metadata, expected) => {
    expect(messages(root(ramp({ a: token }), metadata))).toEqual(expected);
  });
  it.each([
    [{ ...meta, source: undefined }, "id: source undefined is not a valid source id"],
    [{ ...meta, source: ["foundry"] }, "id: source foundry is not a valid source id"],
  ])("requires id fields to be strings: %j", (metadata, message) => {
    expect(messages(root(ramp({ a: token }), metadata))).toEqual([message]);
  });
  it("validates token member ids", () => {
    expect(messages(root(ramp({ Bad: token })))).toEqual(["id: member tokens.color-ramp.Bad is not a valid member id"]);
  });
  it("gives contract findings their prescribed fields", () => {
    expect(parseFill(root([])).findings).toEqual([{ code: "C1", rule: "contract", severity: "error", subject: id, message: reason("missing tokens root") }]);
  });
  it("accepts every hand-written example and checks fixture key/hash form", () => {
    for (const fill of EXAMPLE_FILLS) expect(parseFill(fill)).toEqual({ fill, findings: [] });
    expect(EXAMPLE_RESOLVED.selectionHash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    const keys = Object.keys(EXAMPLE_RESOLVED.members);
    expect(keys).toEqual([...keys].sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
  });
});
