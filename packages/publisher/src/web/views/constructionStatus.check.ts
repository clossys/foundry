import type { CopyResolver } from "@clossys/writer";
import type { ConstructionStatusInput } from "../index.js";
import type { ConstructionStatusInput as ServerInput } from "../server.js";
import type { ConstructionStatusInput as ClientInput } from "../client.js";
import type { ConstructionStatusInput as ViewsInput } from "./index.js";
import type { ConstructionStatusInput as ServerViewsInput } from "./server.js";
import { constructionStatusProps } from "./constructionStatus.js";
import type { StatusViewProps } from "./StatusView.js";

declare const input: ConstructionStatusInput;
declare const resolveCopyId: CopyResolver;
const props: StatusViewProps = constructionStatusProps(input, resolveCopyId);
const entries: [ServerInput, ClientInput, ViewsInput, ServerViewsInput] = [input, input, input, input];
void props;
void entries;

// @ts-expect-error Visible copy must be a Writer CopyRef.
constructionStatusProps({ title: "Careers", description: { id: "description" } }, resolveCopyId);
// @ts-expect-error Action href is required.
constructionStatusProps({ ...input, action: { label: { id: "action" } } }, resolveCopyId);
// @ts-expect-error Closed input excludes view-owned style and content slots.
constructionStatusProps({ ...input, style: {} }, resolveCopyId);
// @ts-expect-error Closed destinations exclude arbitrary visible content.
constructionStatusProps({ ...input, destinations: { label: { id: "destinations" }, items: [], children: "Extra" } }, resolveCopyId);
