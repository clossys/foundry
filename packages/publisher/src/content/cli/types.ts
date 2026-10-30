import type { CopyResolver } from "@clossys/writer";
import type { ContentWriterContext } from "../composition.js";
import type { CompositeCatalogData } from "@clossys/designer/catalog";
import type { ContentFinding } from "../composition.js";
import type { ContentRegistry } from "../model.js";
import type { ReviewLibrarySnapshot } from "../review/types.js";

export type PublisherCommand = "slot-create" | "candidate-add" | "candidate-revise" | "review" | "approve" | "activate" | "release";
export interface PublisherCommandInput {
  readonly command: PublisherCommand;
  readonly root: string;
  readonly designerRoot: string;
  readonly catalog: CompositeCatalogData;
  /** Command-specific JSON; workflow metadata is never accepted as authored content. */
  readonly input: unknown;
  readonly at: string;
  readonly copyResolver?: CopyResolver;
  readonly writer?: ContentWriterContext;
}
export interface PublisherCommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly findings: readonly ContentFinding[];
  readonly data?: unknown;
}
export interface PublisherContext {
  readonly registry: ContentRegistry;
  readonly libraries: readonly ReviewLibrarySnapshot[];
}
