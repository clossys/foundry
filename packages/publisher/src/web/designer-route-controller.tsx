"use client";
import { createElement, useSyncExternalStore, type ComponentType } from "react";
import { libraryHash, resolve, runtimeSnapshot, runtimeSourceFindings } from "@clossys/designer/catalog";
import type { RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import type { DesignerPreparedLibraryBoardOptions, DesignerPreparedLibraryBoards, WholeStudioState } from "@clossys/designer/studio/state";
import type { CompositeStudioSnapshot } from "@clossys/designer/studio";

export type PublisherDesignerBoardControl = NonNullable<ReturnType<DesignerPreparedLibraryBoardOptions["board"]>>;
export interface PublisherDesignerBoardSource {
  readonly options: DesignerPreparedLibraryBoardOptions;
  observe(prepared: DesignerPreparedLibraryBoards, whole: WholeStudioState): () => void;
}
/** Structurally available live inputs only: never a verified/ready runtime.
 * All original preview failures remain in prepared; the existing binder decides. */
export type DesignerFactoryInputs = {
  readonly status: "inputs";
  readonly prepared: Extract<DesignerPreparedLibraryBoards, { status: "prepared" }>;
  readonly whole: WholeStudioState;
  readonly ports: NonNullable<CompositeStudioSnapshot["runtime"]>;
  readonly sources: Readonly<Record<string, RuntimeRendererDescriptor>>;
} | { readonly status: "pending"; readonly needs: readonly string[] };

/** Caller-owned controls for the Publisher projection, never a capture of private
 * native Board state. No default mode, save permission, workflow or hash exists.
 * Descriptor bytes/ownership must be supplied by their source owner; structural
 * validation below is not Node source authentication or runtime qualification. */
export function createPublisherDesignerController(input: {
  readonly workflow?: DesignerPreparedLibraryBoardOptions["workflow"];
  readonly sources?: Readonly<Record<string, RuntimeRendererDescriptor>>;
}) {
  const controls = new Map<string, Omit<PublisherDesignerBoardControl, "sourceHashes">>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let mounted: { prepared: DesignerPreparedLibraryBoards; whole: WholeStudioState } | undefined;
  const sources = runtimeSnapshot(input.sources ?? {});
  const sourceHashes: Record<string, string> = {};
  for (const [source, descriptor] of Object.entries(sources)) {
    if (!source.trim() || runtimeSourceFindings(descriptor).length) throw new Error("Source-owner descriptor closure/hash required");
    sourceHashes[source] = descriptor.sourceHash;
  }
  const notify = () => { revision++; for (const listener of listeners) listener(); };
  // Each revision replaces the accessor identity so the original public hook's
  // memo observes changes while its provider/session and mounted page stay put.
  let board: DesignerPreparedLibraryBoardOptions["board"] = () => undefined;
  const update = () => {
    const current = new Map(controls);
    board = id => { const control = current.get(id); return control ? { ...control, sourceHashes } : undefined; };
    notify();
  };
  const boards: PublisherDesignerBoardSource = {
    get options() { return { board, ...(input.workflow ? { workflow: input.workflow } : {}) }; },
    observe(prepared, whole) {
      const current = { prepared, whole }; mounted = current;
      return () => { if (mounted === current) mounted = undefined; };
    },
  };
  return {
    boards,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => revision,
    setBoard(id: string, control: Omit<PublisherDesignerBoardControl, "sourceHashes">) {
      if (!id.trim()) throw new Error("Actual board identity required");
      controls.set(id, { mode: control.mode, canSave: control.canSave, pending: control.pending }); update();
    },
    removeBoard(id: string) { if (controls.delete(id)) update(); },
    /** The read-only Designer holds no edit session, so there is nothing to
     * flush; this controller implements no persistence and never saves. */
    flush(): Promise<boolean> { return Promise.resolve(false); },
    factoryInputs(): DesignerFactoryInputs {
      if (!mounted) return { status: "pending", needs: ["ORIGINAL_MOUNT_UNAVAILABLE"] };
      const { prepared, whole } = mounted;
      const needs: string[] = [];
      if (prepared.status !== "prepared") needs.push(prepared.code);
      // The committed load is the only session: its snapshot and identity, the
      // working library hash and the selection hash must match the projection.
      if (!whole.snapshot || whole.sessionIdentity !== prepared.projection.session.id || !whole.input ||
        libraryHash(whole.input.library) !== prepared.projection.libraryHash || resolve(whole.input).selectionHash !== prepared.projection.selectionHash)
        needs.push("CURRENT_PROVIDER_ASSOCIATION_UNAVAILABLE");
      if (prepared.status === "prepared" && prepared.boards.some(board => board.previews.status === "pending" && board.previews.code === "SOURCE_HASH_ASSOCIATION_UNAVAILABLE"))
        needs.push("SOURCE_HASH_ASSOCIATION_UNAVAILABLE");
      const ports = whole.snapshot?.runtime;
      if (!ports) needs.push("SELECTED_FRAME_SECTION_STAGE_RUNTIME_UNAVAILABLE");
      if (needs.length || prepared.status !== "prepared" || !ports) return { status: "pending", needs };
      // These exact live inputs still need the genuine source/runtime factory,
      // selected Stage parameters, header lease and existing Node operation.
      return { status: "inputs", prepared, whole, ports, sources };
    },
  };
}
export type PublisherDesignerController = ReturnType<typeof createPublisherDesignerController>;

/** Adapt the actual Product createDesignerPage(loadFrame,runtime,source,boards)
 * contract without moving functions into server props or replacing its provider.
 * Updating caller controls rerenders the same page type, not a new factory/page.
 * Genuine source and runtime inputs pass through unchanged when supplied. */
export function createPublisherDesignerMount<P extends object, F, S>(
  createPage: (loadFrame: F, runtime: CompositeStudioSnapshot["runtime"] | undefined, source: S | undefined, boards: PublisherDesignerBoardSource) => ComponentType<P>,
  input: { readonly loadFrame: F; readonly runtime?: CompositeStudioSnapshot["runtime"]; readonly source?: S; readonly controller: PublisherDesignerController },
): ComponentType<P> {
  const Page = createPage(input.loadFrame, input.runtime, input.source, input.controller.boards);
  return function PublisherDesignerMount(props: P) {
    useSyncExternalStore(input.controller.subscribe, input.controller.getSnapshot, input.controller.getSnapshot);
    return createElement(Page, props);
  };
}
