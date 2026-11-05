// R-COMPILE-PURE fixture: the built CLI's compile verb asks a model client to render.
const verbs = { compile: async () => (await import("openai")).default };
const [verb] = process.argv.slice(2);
if (verb !== "compile") process.exit(2);
await verbs.compile().catch(() => process.exit(1));
