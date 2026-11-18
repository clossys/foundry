import { describe, expect, it, vi } from "vitest";
import { publicationFormDefaults } from "../../content-map/outputs.js";
import { createFormEndpoint } from "./formEndpoint.js";

const form = { ...publicationFormDefaults("contact"), maxBytes: 1024 };
const ENV = { CONTACT_FORM_TARGET: "https://hooks.example.com/forms" };
const post = (body: string, type = "application/json", headers: Record<string, string> = {}) =>
  new Request("https://site.example/api/forms/contact", { method: "POST", headers: { "content-type": type, ...headers }, body });
const good = JSON.stringify({ name: "Ada", email: "ada@example.com", topic: "general", message: "Hello" });
const setup = (options: Partial<Parameters<typeof createFormEndpoint>[0]> = {}) => {
  const fetch = vi.fn(async () => new Response(null, { status: 202 }));
  return { fetch, endpoint: createFormEndpoint({ form, env: ENV, fetch, ...options }) };
};
const status = async (response: Response) => ({ code: response.status, body: await response.json() });

describe("createFormEndpoint", () => {
  it("delivers a valid submission to the target read from the named env var, once", async () => {
    const { fetch, endpoint } = setup();
    expect(await status(await endpoint.POST(post(good)))).toEqual({ code: 200, body: { status: "accepted" } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENV.CONTACT_FORM_TARGET);
    expect(JSON.parse(String(init.body))).toEqual({ form: "contact", kind: "contact", fields: { name: "Ada", email: "ada@example.com", topic: "general", message: "Hello" } });
  });
  it("accepts urlencoded bodies and refuses other media types", async () => {
    const { endpoint } = setup();
    expect((await endpoint.POST(post("email=ada%40example.com&message=Hi&name=Ada&topic=general", "application/x-www-form-urlencoded"))).status).toBe(200);
    expect((await endpoint.POST(post(good, "text/plain"))).status).toBe(415);
  });
  it("refuses an oversized body before parsing it", async () => {
    const { fetch, endpoint } = setup();
    expect((await endpoint.POST(post(JSON.stringify({ email: "a@b.co", message: "x".repeat(2000) })))).status).toBe(413);
    expect((await endpoint.POST(post(good, "application/json", { "content-length": "999999" }))).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates declared fields server-side and echoes no input", async () => {
    const { fetch, endpoint } = setup();
    const response = await status(await endpoint.POST(post(JSON.stringify({ email: "not-an-email", message: "", topic: "nope", name: "a\u0007" }))));
    expect(response.code).toBe(422);
    expect(response.body).toEqual({ status: "invalid", fields: [{ name: "name", code: "control-character" }, { name: "email", code: "invalid-email" }, { name: "topic", code: "not-an-option" }, { name: "message", code: "required" }] });
    expect(JSON.stringify(response.body)).not.toContain("not-an-email");
    expect((await endpoint.POST(post("{bad json"))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("silently drops a filled honeypot", async () => {
    const { fetch, endpoint } = setup();
    expect(await status(await endpoint.POST(post(JSON.stringify({ ...JSON.parse(good), website: "spam" }))))).toEqual({ code: 200, body: { status: "accepted" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("runs the rate-limit hook per client key", async () => {
    const check = vi.fn(() => false);
    const { fetch, endpoint } = setup({ limiter: { check } });
    expect((await endpoint.POST(post(good, "application/json", { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).status).toBe(429);
    expect(check).toHaveBeenCalledWith("203.0.113.9");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed when the target env var is unset, not https, or the delivery fails", async () => {
    for (const env of [{}, { CONTACT_FORM_TARGET: "http://hooks.example.com/forms" }, { CONTACT_FORM_TARGET: "" }]) {
      const { fetch, endpoint } = setup({ env });
      expect(await status(await endpoint.POST(post(good)))).toEqual({ code: 503, body: { status: "unavailable" } });
      expect(fetch).not.toHaveBeenCalled();
    }
    const failing = createFormEndpoint({ form, env: ENV, fetch: async () => new Response(null, { status: 500 }) });
    expect((await failing.POST(post(good))).status).toBe(503);
    const throwing = createFormEndpoint({ form, env: ENV, fetch: async () => { throw new Error("down"); } });
    expect((await throwing.POST(post(good))).status).toBe(503);
  });
  it("refuses to construct from a malformed form record", () => {
    expect(() => createFormEndpoint({ form: { ...form, targetEnv: "https://x" } })).toThrow(/targetEnv/);
  });
});
