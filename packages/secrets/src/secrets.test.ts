import { describe, expect, it } from "vitest";
import {
  AsyncSecretAdapterError,
  MissingSecretError,
  SecretAccessError,
  createEnvSecretsAdapter,
  createSecretsClient,
  createTestSecretsAdapter,
  defineSecretCatalog,
} from "./index.js";

describe("createSecretsClient", () => {
  it("normalizes absent and empty values without changing present values", async () => {
    const client = createSecretsClient({
      get: (key) => ({ PRESENT: "example-value", EMPTY: "" })[key],
    });

    await expect(client.get("PRESENT")).resolves.toBe("example-value");
    await expect(client.get("EMPTY")).resolves.toBeNull();
    await expect(client.get("ABSENT")).resolves.toBeNull();
  });

  it("supports synchronous adapters through the same client", () => {
    const client = createSecretsClient({ get: () => "example-value" });
    expect(client.getSync("EXAMPLE_KEY")).toBe("example-value");
    expect(client.requireSync("EXAMPLE_KEY")).toBe("example-value");
  });

  it("fails explicitly when a synchronous method receives a thenable", () => {
    const client = createSecretsClient({ get: async () => "example-value" });
    expect(() => client.getSync("EXAMPLE_KEY")).toThrow(AsyncSecretAdapterError);
  });

  it("treats callable thenables as asynchronous adapter results", () => {
    const callable = Object.assign(
      () => undefined,
      { then: (resolve: (value: string) => void) => resolve("example-value") },
    ) as PromiseLike<string>;
    const client = createSecretsClient({ get: () => callable });

    expect(() => client.getSync("EXAMPLE_KEY")).toThrow(AsyncSecretAdapterError);
    expect(() => client.requireSync("EXAMPLE_KEY")).toThrow(AsyncSecretAdapterError);
  });

  it("consumes rejected asynchronous adapter results before synchronous methods fail", async () => {
    const rejection = new Error("adapter failure details");
    const client = createSecretsClient({ get: () => Promise.reject(rejection) });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      expect(() => client.getSync("EXAMPLE_KEY")).toThrow(AsyncSecretAdapterError);
      expect(() => client.requireSync("EXAMPLE_KEY")).toThrow(AsyncSecretAdapterError);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("uses safe missing and access errors without adapter details", async () => {
    const missing = createSecretsClient({ get: () => null });
    await expect(missing.require("EXAMPLE_KEY")).rejects.toMatchObject({
      code: "SECRET_MISSING",
      key: "EXAMPLE_KEY",
    });
    await expect(missing.require("EXAMPLE_KEY")).rejects.toBeInstanceOf(MissingSecretError);

    const failing = createSecretsClient({
      get: () => {
        throw new Error("provider response contained sensitive material");
      },
    });
    const error = await failing.get("EXAMPLE_KEY").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SecretAccessError);
    expect(String(error)).not.toContain("sensitive material");
  });
});

describe("adapters", () => {
  it("reads the environment source at call time", () => {
    let source: Record<string, string | undefined> = {};
    const client = createSecretsClient(createEnvSecretsAdapter(() => source));
    expect(client.getSync("EXAMPLE_KEY")).toBeNull();
    source = { EXAMPLE_KEY: "example-value" };
    expect(client.getSync("EXAMPLE_KEY")).toBe("example-value");
  });

  it("ignores inherited environment properties", () => {
    const environment = Object.create({ EXAMPLE_KEY: "inherited-example" }) as Record<string, string>;
    expect(createEnvSecretsAdapter(environment).get("EXAMPLE_KEY")).toBeNull();
    environment.EXAMPLE_KEY = "own-example";
    expect(createEnvSecretsAdapter(environment).get("EXAMPLE_KEY")).toBe("own-example");
  });

  it("provides a mutable test adapter whose inspection exposes keys only", () => {
    const adapter = createTestSecretsAdapter({ SECOND_KEY: "two" });
    adapter.set("FIRST_KEY", "one");
    expect(adapter.keys()).toEqual(["FIRST_KEY", "SECOND_KEY"]);
    expect(adapter.delete("FIRST_KEY")).toBe(true);
    adapter.clear();
    expect(adapter.keys()).toEqual([]);
  });

  it("accepts structurally valid ReadonlyMap implementations", () => {
    const backing = new Map([["EXAMPLE_KEY", "example-value"]]);
    const custom: ReadonlyMap<string, string> = {
      get size() {
        return backing.size;
      },
      entries: () => backing.entries(),
      forEach: (callback, thisArgument) => backing.forEach(callback, thisArgument),
      get: (key) => backing.get(key),
      has: (key) => backing.has(key),
      keys: () => backing.keys(),
      values: () => backing.values(),
      [Symbol.iterator]: () => backing[Symbol.iterator](),
    };

    expect(createTestSecretsAdapter(custom).get("EXAMPLE_KEY")).toBe("example-value");
  });
});

describe("defineSecretCatalog", () => {
  it("returns a detached, frozen, value-free catalog contract", () => {
    const entries = [{ key: "EXAMPLE_KEY", required: true, group: "runtime" }];
    const catalog = defineSecretCatalog(entries);
    entries[0] = { key: "CHANGED_KEY", required: false };

    expect(catalog).toEqual({
      version: 1,
      entries: [{ key: "EXAMPLE_KEY", required: true, group: "runtime" }],
    });
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries[0])).toBe(true);
  });

  it("copies only declared metadata fields from structurally compatible entries", () => {
    const extendedEntry = {
      key: "EXAMPLE_KEY",
      required: true,
      description: "Example metadata",
      value: "example-value",
    };

    const catalog = defineSecretCatalog([extendedEntry]);

    expect(catalog.entries[0]).toEqual({
      key: "EXAMPLE_KEY",
      required: true,
      description: "Example metadata",
    });
    expect(JSON.stringify(catalog)).not.toContain("example-value");
  });
});
