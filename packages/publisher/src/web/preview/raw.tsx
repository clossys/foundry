import type { ReactElement } from "react";
import type { RevisionId } from "../../content/vocabulary.js";
import { ContentRoutePage } from "../content-route.js";
import type { ContentRouteInput } from "../content-route-types.js";
import { previewContentRouteInput } from "./selection.js";

export interface RawContentPreviewProps {
  readonly input: ContentRouteInput;
  readonly candidateId?: string;
  readonly revision?: RevisionId;
}

/** The production content route is also the raw preview renderer. */
export function RawContentPreview({ input, candidateId, revision }: RawContentPreviewProps): ReactElement {
  return <ContentRoutePage input={previewContentRouteInput(input, { candidateId, revision })} />;
}
