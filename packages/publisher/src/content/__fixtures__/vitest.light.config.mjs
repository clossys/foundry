// Focused source checks only: deliberately no package build/globalSetup.
export default {
  test: {
    root: new URL("../../../../../", import.meta.url).pathname,
    environment: "node",
    include: ["packages/publisher/src/content/*.test.ts"],
    maxWorkers: 1,
  },
};
