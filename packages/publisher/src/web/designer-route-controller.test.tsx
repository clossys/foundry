/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WholeStudioProvider, useWholeStudio, useDesignerPreparedLibraryBoards } from "@clossys/designer/studio/state";
import type { CompositeStudioSnapshot } from "@clossys/designer/studio";
import { loadBuildCatalog, runtimeHash } from "@clossys/designer/catalog";
import type { CompositeStudioAdapter, CompositeStudioLabels } from "@clossys/designer/studio";
import type { DesignerPreparedLibraryBoards, WholeStudioState } from "@clossys/designer/studio/state";
import { adopt, smallCatalog, labels } from "../../../designer/dist/studio/__fixtures__/studio.js";
import { createPublisherDesignerController, createPublisherDesignerMount } from "./designer-route-controller.js";
import type { PublisherDesignerBoardSource } from "./designer-route-controller.js";

afterEach(cleanup);
/** Synthetic caller policy/source facts, real original read-only provider (no EditSession).
 * These tests qualify neither Product native controls nor a consumer source map. */
function fixture() {
  const { source, adoptedAt, ...values } = adopt(adopt(), "assets.icon-search", "lucide");
  const library = { source, adoptedAt, values, components: { fills: [], files: [] } };
  const save = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
  const adapter: CompositeStudioAdapter = { kind: "composite", catalog: { values: smallCatalog, components: { slots: [], fills: [] } }, contracts: loadBuildCatalog(), load: vi.fn(async () => ({ library })), save };
  const wholeLabels: CompositeStudioLabels = { ...labels, whole: { signoff: "SYNTHETIC", proposed: "SYNTHETIC", contract: "SYNTHETIC", contentSlots: "SYNTHETIC", configurations: "SYNTHETIC", unresolved: "SYNTHETIC", unassessed: "SYNTHETIC" } };
  return { adapter, wholeLabels, save };
}
function mount(controller: ReturnType<typeof createPublisherDesignerController>) {
  const f = fixture();
  let current!: { prepared: DesignerPreparedLibraryBoards; whole: WholeStudioState };
  function Observer({ boards }: { boards: PublisherDesignerBoardSource }) {
    const whole = useWholeStudio()!, prepared = useDesignerPreparedLibraryBoards(boards.options);
    current = { whole, prepared };
    useEffect(() => boards.observe(prepared, whole), [boards, prepared, whole]);
    return <output>{prepared.status}:{prepared.projection.session.status}</output>;
  }
  const source = { useRuntime: vi.fn() }, loadFrame = vi.fn();
  // Exact Product factory argument order; one factory/Page identity for all
  // controller updates, with the actual original public accessor/provider.
  const createPage = vi.fn((frame: typeof loadFrame, runtime: undefined, supplied: typeof source | undefined, boards: PublisherDesignerBoardSource) => {
    expect(frame).toBe(loadFrame); expect(runtime).toBeUndefined(); expect(supplied).toBe(source);
    return function Page() { return <WholeStudioProvider adapter={f.adapter} labels={f.wholeLabels}><Observer boards={boards} /></WholeStudioProvider>; };
  });
  const Page = createPublisherDesignerMount(createPage, { controller, loadFrame, source });
  const rendered = render(<Page />);
  return { ...f, createPage, rendered, current: () => current };
}
const control = { mode: "edit" as const, canSave: true, pending: false };
async function supplyCurrentBoards(m: ReturnType<typeof mount>, controller: ReturnType<typeof createPublisherDesignerController>) {
  await waitFor(() => expect(m.current().prepared.projection.phase).toBe("ready"));
  act(() => { for (const board of m.current().prepared.projection.boards) controller.setBoard(board.id, control); });
  await screen.findByText("prepared:saved");
}
it("does not invent default controls, hashes, workflow, a mounted source or runtime", async () => {
  const controller = createPublisherDesignerController({});
  expect(controller.factoryInputs()).toEqual({ status: "pending", needs: ["ORIGINAL_MOUNT_UNAVAILABLE"] });
  expect(controller.boards.options.workflow).toBeUndefined();
  expect(controller.boards.options.board("tokens/color")).toBeUndefined();
  const m = mount(controller);
  await waitFor(() => expect(m.current().prepared.status === "pending" && m.current().prepared.code).toBe("BOARD_CONTROLS_UNAVAILABLE"));
  expect(controller.factoryInputs()).toMatchObject({ status: "pending", needs: expect.arrayContaining(["BOARD_CONTROLS_UNAVAILABLE", "SELECTED_FRAME_SECTION_STAGE_RUNTIME_UNAVAILABLE"]) });
  await supplyCurrentBoards(m, controller);
  expect(controller.factoryInputs()).toMatchObject({ status: "pending", needs: expect.arrayContaining(["SOURCE_HASH_ASSOCIATION_UNAVAILABLE", "SELECTED_FRAME_SECTION_STAGE_RUNTIME_UNAVAILABLE"]) });
  expect(m.current().whole.snapshot?.runtime).toBeUndefined();
  expect(m.createPage).toHaveBeenCalledOnce(); expect(m.adapter.load).toHaveBeenCalledOnce(); expect(m.save).not.toHaveBeenCalled();
});
it("updates caller-owned board state and workflow without replacing the provider or its committed session identity", async () => {
  const workflow = { returnStep: "SYNTHETIC return to original host", checkCandidates: vi.fn(async () => ({ status: "unavailable" as const })) };
  const controller = createPublisherDesignerController({ workflow }), m = mount(controller);
  await supplyCurrentBoards(m, controller);
  const session = m.current().whole.sessionIdentity, identity = m.current().prepared.projection.session.id;
  expect(controller.boards.options.workflow).toBe(workflow);
  const prepared = m.current().prepared;
  if (prepared.status !== "prepared") throw new Error("Expected original prepared records");
  expect(prepared.records.flatMap(row => row.records.rows.items).every(row => row.prompt.returnStep === workflow.returnStep)).toBe(true);
  const id = prepared.projection.boards[0]!.id;
  act(() => controller.setBoard(id, { mode: "view", canSave: false, pending: true }));
  expect(controller.boards.options.board(id)).toMatchObject({ mode: "view", canSave: false, pending: true });
  expect(m.current().whole.sessionIdentity).toBe(session); expect(m.current().prepared.projection.session.id).toBe(identity);
  expect(m.createPage).toHaveBeenCalledOnce(); expect(m.adapter.load).toHaveBeenCalledOnce();
  act(() => controller.removeBoard(id));
  await waitFor(() => expect(m.current().prepared.status).toBe("pending"));
  expect(m.current().whole.sessionIdentity).toBe(session);
});
it("exposes no edit, resolves flush false without an edit session and revokes its live mount on cleanup", async () => {
  const controller = createPublisherDesignerController({});
  expect("edit" in controller).toBe(false);
  expect(await controller.flush()).toBe(false);
  const m = mount(controller);
  await supplyCurrentBoards(m, controller);
  let flushed: boolean | undefined;
  await act(async () => { flushed = await controller.flush(); });
  expect(flushed).toBe(false); expect(m.save).not.toHaveBeenCalled();
  m.rendered.unmount();
  expect(controller.factoryInputs()).toEqual({ status: "pending", needs: ["ORIGINAL_MOUNT_UNAVAILABLE"] });
  expect(await controller.flush()).toBe(false);
});
it("uses only an explicit source-owner descriptor association and refuses stale descriptor hashes", async () => {
  const source = { entry: "preview.js", files: { "preview.js": "// SYNTHETIC source-owner bytes" }, dependencies: {} };
  const descriptor = { id: "SYNTHETIC-owner", source, sourceHash: runtimeHash(source) };
  const controller = createPublisherDesignerController({ sources: { example: descriptor } });
  controller.setBoard("tokens/color", control);
  expect(controller.boards.options.board("tokens/color")!.sourceHashes).toEqual({ example: descriptor.sourceHash });
  expect(() => createPublisherDesignerController({ sources: { example: { ...descriptor, sourceHash: runtimeHash("SYNTHETIC fill id is not source closure") } } })).toThrow("Source-owner descriptor");
  const m = mount(controller); await supplyCurrentBoards(m, controller);
  const prepared = m.current().prepared;
  if (prepared.status !== "prepared") throw new Error("Expected original records");
  expect(prepared.boards.some(board => board.previews.status === "available")).toBe(true);
  expect(controller.factoryInputs()).toEqual({ status: "pending", needs: ["SELECTED_FRAME_SECTION_STAGE_RUNTIME_UNAVAILABLE"] });
  expect(m.current().whole.snapshot?.runtime).toBeUndefined();
});

it("reaches inputs from the committed read-only state and stays pending on a session-identity or hash mismatch", async () => {
  const source = { entry: "preview.js", files: { "preview.js": "// SYNTHETIC source-owner bytes" }, dependencies: {} };
  const descriptor = { id: "SYNTHETIC-owner", source, sourceHash: runtimeHash(source) };
  const controller = createPublisherDesignerController({ sources: { example: descriptor } }), m = mount(controller);
  await supplyCurrentBoards(m, controller);
  const { prepared, whole } = m.current();
  if (prepared.status !== "prepared" || !whole.snapshot) throw new Error("Expected committed prepared records");
  // Synthetic Stage runtime ports on the committed snapshot; the fixture host supplies none.
  const ports = { SYNTHETIC: "ports" } as unknown as NonNullable<CompositeStudioSnapshot["runtime"]>;
  const committed: WholeStudioState = { ...whole, snapshot: { ...whole.snapshot, runtime: ports } };
  act(() => { m.rendered.unmount(); });
  const settle = (p: DesignerPreparedLibraryBoards, w: WholeStudioState) => { const release = controller.boards.observe(p, w); const result = controller.factoryInputs(); release(); return result; };
  expect(settle(prepared, committed)).toEqual({ status: "inputs", prepared, whole: committed, ports, sources: { example: descriptor } });
  const identityMismatch = settle(prepared, { ...committed, sessionIdentity: "SYNTHETIC-other-session" });
  expect(identityMismatch).toEqual({ status: "pending", needs: ["CURRENT_PROVIDER_ASSOCIATION_UNAVAILABLE"] });
  const libraryMismatch = settle({ ...prepared, projection: { ...prepared.projection, libraryHash: runtimeHash("SYNTHETIC stale library") } }, committed);
  expect(libraryMismatch).toEqual({ status: "pending", needs: ["CURRENT_PROVIDER_ASSOCIATION_UNAVAILABLE"] });
  const selectionMismatch = settle({ ...prepared, projection: { ...prepared.projection, selectionHash: runtimeHash("SYNTHETIC stale selection") } }, committed);
  expect(selectionMismatch).toEqual({ status: "pending", needs: ["CURRENT_PROVIDER_ASSOCIATION_UNAVAILABLE"] });
  expect(settle(prepared, { ...committed, snapshot: undefined })).toMatchObject({ status: "pending", needs: expect.arrayContaining(["CURRENT_PROVIDER_ASSOCIATION_UNAVAILABLE"]) });
  expect(m.save).not.toHaveBeenCalled();
});
