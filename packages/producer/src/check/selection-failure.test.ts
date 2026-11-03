import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startProducerServer, type ProducerServer } from "../server/index.js";
import { librarySelection } from "../server/library-selection.js";
import type { StudioSelection } from "../server/selection.js";

/**
 * A broken Designer slot model must surface the reader's own message, not a generic one: in the
 * Studio config API (so the page can show it) and in the server log. The Studio client provider
 * and boundary this test once bundled were removed; the API and log contract they read remains.
 */
describe("Studio selection faults keep the actual compiler exception", () => {
  let directory: string;
  let server: ProducerServer | undefined;
  let compilerMessage = "";
  const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeAll(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "producer-selection-failure-")));
    const root = join(directory, "consumer");
    const designer = join(root, "clossys/agents/designer");
    await mkdir(designer, { recursive: true });
    await writeFile(join(designer, "ia.json"), "{");
    // Read the same way the server does to get the exact message it sees.
    try { librarySelection(join(root, "clossys")); }
    catch (error) { compilerMessage = error instanceof Error ? error.message : String(error); }
    expect(compilerMessage).toMatch(/JSON/);
    server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("../server/__fixtures__/studio-child.mjs", import.meta.url)) });
  }, 60_000);

  afterAll(async () => {
    try { await server?.close(); } finally { logs.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  });

  it("preserves the compiler message in the config API and the server log, with no runtime", async () => {
    const response = await fetch(`${server!.url}/api/config`);
    expect(response.status).toBe(200);
    const config = await response.json() as { selection: StudioSelection };
    expect(config.selection.message).toBe(compilerMessage);
    expect(config.selection.runtimeUrl).toBeUndefined();
    expect(logs).toHaveBeenCalledWith("Producer Designer selection failed:", compilerMessage);
  });
});
