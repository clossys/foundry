import type * as Model from "./index.js";
import type * as Blocks from "../index.js";
import type * as Internal from "../../index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type GraphInputBlocksCheck = Assert<Equal<Model.GraphInput, Blocks.GraphInput>>;
export type GraphInputInternalCheck = Assert<Equal<Model.GraphInput, Internal.GraphInput>>;
export type GraphResultCheck = Assert<Equal<ReturnType<typeof Blocks.validateGraph>, Model.GraphModel>>;
export type GraphLayoutCheck = Assert<Equal<ReturnType<typeof Blocks.forceLayout>, Model.GraphPosition[]>>;
export type GraphReadonlyCheck = Assert<Equal<Model.GraphInput["nodes"], readonly Model.GraphNode[]>>;
