import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const brand = vi.hoisted(() => ({ value: {} as { name?: string; mark?: { light: string; dark: string } } }));
vi.mock("./designer-globals.js", async original => ({ ...(await original<typeof import("./designer-globals.js")>()), consumerBrand: async () => brand.value }));
const { DEFAULT_AVATAR_PATH, defaultAvatarSvg, pinnedMarkSvg } = await import("./default-avatar.js");
const { startProducerServer } = await import("./index.js");

/** Foundry's own consumer library: its pinned assets.mark is the default avatar. */
const LIBRARY = fileURLToPath(new URL("../../../../clossys", import.meta.url));
const MARK_SLOT = join(LIBRARY, "agents", "designer", "assets.mark");

async function pinnedPositive(): Promise<string> {
  const pin = JSON.parse(await readFile(join(MARK_SLOT, "pin.json"), "utf8"));
  const candidate = JSON.parse(await readFile(join(MARK_SLOT, "candidates", pin.candidate), "utf8"));
  const tokens = JSON.parse(candidate.files.find((file: { path: string }) => file.path.endsWith(".json")).content);
  return tokens.assets.mark.positive.$value.trim();
}

describe("default avatar source", () => {
  let scratch: string;
  // The slot model refuses symlinked paths, and macOS tmpdir sits behind one.
  beforeEach(async () => { scratch = await realpath(await mkdtemp(join(tmpdir(), "producer-default-avatar-"))); });
  afterEach(async () => { brand.value = {}; await rm(scratch, { recursive: true, force: true }); });

  it("matches only single-file placeholder image paths under /avatars/", () => {
    for (const path of ["/avatars/shadcn.jpg", "/avatars/01.png", "/avatars/user-2.webp"]) expect(DEFAULT_AVATAR_PATH.test(path)).toBe(true);
    for (const path of ["/avatars/", "/avatars/../x.jpg", "/avatars/a/b.jpg", "/avatars/x.html", "/api/avatars/x.jpg", "/avatarsx.jpg"]) expect(DEFAULT_AVATAR_PATH.test(path)).toBe(false);
  });

  it("is the pinned assets.mark candidate's positive token", async () => {
    const svg = pinnedMarkSvg(LIBRARY);
    expect(svg).toBe(await pinnedPositive());
    expect(await defaultAvatarSvg(scratch, LIBRARY)).toBe(svg);
  });

  it("never serves a candidate whose bytes drifted from the pin", async () => {
    const library = join(scratch, "clossys");
    await mkdir(join(library, "agents", "designer"), { recursive: true });
    await cp(join(LIBRARY, "agents", "designer", "ia.json"), join(library, "agents", "designer", "ia.json"));
    const slot = join(library, "agents", "designer", "assets.mark");
    await cp(MARK_SLOT, slot, { recursive: true });
    expect(pinnedMarkSvg(library)).toBe(await pinnedPositive());
    const pin = JSON.parse(await readFile(join(slot, "pin.json"), "utf8"));
    const file = join(slot, "candidates", pin.candidate);
    await writeFile(file, (await readFile(file, "utf8")).replace("currentColor", "red"));
    expect(pinnedMarkSvg(library)).toBeUndefined();
  });

  it("falls back to the old-store mark cell when no slot pins a mark", async () => {
    brand.value = { name: "Example", mark: { light: "<svg aria-label=\"Example\"/></svg>", dark: "<svg/></svg>" } };
    expect(await defaultAvatarSvg(scratch, join(scratch, "clossys"))).toBe("<svg aria-label=\"Example\"/></svg>");
  });
});

describe("/avatars/* route", () => {
  let root: string;
  let server: Awaited<ReturnType<typeof startProducerServer>> | undefined;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "producer-avatar-route-")); await mkdir(join(root, "clossys")); });
  afterEach(async () => { await server?.close(); server = undefined; brand.value = {}; await rm(root, { recursive: true, force: true }); });
  const get = (path: string, method = "GET") => new Promise<{ status: number; text: string; headers: Record<string, any> }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: server!.port, path, method }, response => {
      let text = ""; response.setEncoding("utf8"); response.on("data", value => { text += value; }); response.on("end", () => resolve({ status: response.statusCode!, text, headers: response.headers }));
    }); req.on("error", reject); req.end();
  });
  const start = async () => { server = await startProducerServer({ root, port: 0, handleSignals: false, studioEntry: fileURLToPath(new URL("./__fixtures__/studio-child.mjs", import.meta.url)) }); };

  it("answers a stock block's sample avatar with the mark as SVG", async () => {
    const light = "<svg xmlns=\"http://www.w3.org/2000/svg\" aria-label=\"Example\"><rect width=\"1\" height=\"1\"/></svg>";
    brand.value = { name: "Example", mark: { light, dark: light } };
    await start();
    const avatar = await get("/avatars/shadcn.jpg");
    expect(avatar.status).toBe(200); expect(avatar.text).toBe(light);
    expect(avatar.headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
    expect(avatar.headers["x-content-type-options"]).toBe("nosniff");
    expect((await get("/avatars/shadcn.jpg", "POST")).status).not.toBe(200);
  });

  it("redirects to Studio's own mark when the workspace has none", async () => {
    await start();
    const avatar = await get("/avatars/shadcn.jpg");
    expect(avatar.status).toBe(302); expect(avatar.headers.location).toBe("/studio-mark.svg");
  });
});
