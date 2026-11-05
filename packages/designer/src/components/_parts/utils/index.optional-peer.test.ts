import { clsx, type ClassValue } from "clsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Literal outputs recorded from the original helper with the default merge config.
// Token-named classes intentionally retain that config's existing behavior.
const goldens: Array<{ name: string; inputs: ClassValue[]; output: string }> = [
  {
    "name": "structured-arrays-objects",
    "inputs": [
      [
        "p-2",
        [
          "font-medium",
          {
            "block": true,
            "hidden": false
          }
        ]
      ],
      {
        "rounded": true
      },
      false,
      null,
      0
    ],
    "output": "p-2 font-medium block rounded"
  },
  {
    "name": "conditional-ClassValue",
    "inputs": [
      false,
      "inline-flex",
      {
        "opacity-50": false,
        "pointer-events-none": true
      },
      [
        "text-sm",
        false
      ]
    ],
    "output": "inline-flex pointer-events-none text-sm"
  },
  {
    "name": "padding-forward",
    "inputs": [
      "p-4",
      "p-8"
    ],
    "output": "p-8"
  },
  {
    "name": "padding-reverse",
    "inputs": [
      "p-8",
      "p-4"
    ],
    "output": "p-4"
  },
  {
    "name": "token-spacing-forward",
    "inputs": [
      "px-md",
      "px-lg"
    ],
    "output": "px-md px-lg"
  },
  {
    "name": "token-spacing-reverse",
    "inputs": [
      "px-lg",
      "px-md"
    ],
    "output": "px-lg px-md"
  },
  {
    "name": "token-type-color",
    "inputs": [
      "text-body",
      "text-ink-on-accent"
    ],
    "output": "text-ink-on-accent"
  },
  {
    "name": "structured-token-type-color",
    "inputs": [
      [
        "px-md",
        {
          "hidden": false
        }
      ],
      {
        "px-lg": true
      },
      "text-body",
      {
        "text-ink-on-accent": true
      }
    ],
    "output": "px-md px-lg text-ink-on-accent"
  }
];

beforeEach(() => {
  vi.doUnmock("tailwind-merge");
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock("tailwind-merge");
  vi.resetModules();
  vi.restoreAllMocks();
});

function absentPeer() {
  const load = vi.fn(() => {
    throw new Error("Cannot find package 'tailwind-merge': simulated absent optional peer");
  });
  vi.doMock("tailwind-merge", load);
  return load;
}

describe("cn with its optional peer present", () => {
  for (const { name, inputs, output } of goldens) {
    it(`preserves the original default merge output for ${name}`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { cn } = await import("./index.js");
      const { twMerge } = await vi.importActual<typeof import("tailwind-merge")>("tailwind-merge");
      expect(cn(...inputs)).toBe(output);
      expect(cn(...inputs)).toBe(twMerge(clsx(inputs)));
      expect(warn).not.toHaveBeenCalled();
    });
  }
  it("propagates installed merge execution errors instead of degrading", async () => {
    const error = new Error("Installed merge execution failed");
    const merge = vi.fn(() => { throw error; });
    vi.doMock("tailwind-merge", () => ({ twMerge: merge }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { cn } = await import("./index.js");
    expect(() => cn(["p-4", { "p-8": true }])).toThrow(error);
    expect(merge).toHaveBeenCalledWith("p-4 p-8");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("cn when its optional peer is absent", () => {
  it("loads without a module error or an import-time degradation warning", async () => {
    absentPeer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(import("./index.js")).resolves.toHaveProperty("cn");
    expect(warn).not.toHaveBeenCalled();
  });
  it("retains clsx structured ClassValue normalization without resolving conflicts", async () => {
    absentPeer();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { cn } = await import("./index.js");
    const inputs: ClassValue[] = [["p-4", { hidden: false }], { "p-8": true }, false, null, undefined, 0, ["text-body", { "text-ink-on-accent": true }]];
    expect(cn(...inputs)).toBe("p-4 p-8 text-body text-ink-on-accent");
    expect(cn(...inputs)).toBe(clsx(inputs));
  });
  it("warns exactly once on the first actual fallback call", async () => {
    absentPeer();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { cn } = await import("./index.js");
    expect(warn).not.toHaveBeenCalled();
    expect(cn("p-4", "p-8")).toBe("p-4 p-8");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/tailwind-merge.*optional peer.*cn\(\)/);
    expect(warn.mock.calls[0]?.[0]).toContain("unmerged classes");
    expect(warn.mock.calls[0]?.[0]).toContain("once per process");
    warn.mockClear();
    cn("p-8", "p-4");
    cn({ "inline-flex": true }, ["text-sm"]);
    expect(warn).not.toHaveBeenCalled();
  });
  it("settles the optional load once and reuses the same module binding", async () => {
    const load = absentPeer();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = await import("./index.js");
    expect(first.cn("a")).toBe("a");
    expect(first.cn("b")).toBe("b");
    const second = await import("./index.js");
    expect(second.cn).toBe(first.cn);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
