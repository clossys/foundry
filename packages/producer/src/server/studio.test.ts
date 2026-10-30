import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startStudio } from "./studio.js";

it("checks the shipped static asset without starting a slow dynamic root render", async () => {
  const root = await mkdtemp(join(tmpdir(), "producer-studio-ready-"));
  const entry = join(root, "studio.mjs");
  await writeFile(entry, `import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
const server = createServer(async (request, response) => {
  if (request.url === "/studio-mark.svg") { response.end("<svg/>"); return; }
  await writeFile(new URL("./dynamic-root-requested", import.meta.url), "requested");
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
`);
  const aborter = new AbortController();
  try {
    const child = await startStudio(entry, "http://127.0.0.1:4300", aborter.signal, 2_000);
    try {
      expect(child.process.exitCode).toBeNull();
      await expect(readFile(join(root, "dynamic-root-requested"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await child.stop(); }
  } finally { aborter.abort(); await rm(root, { recursive: true, force: true }); }
});
