import type { ScenePart as DirectPart } from "./types.js";
import type { ScenePart as ScenePart } from "./index.js";
import type { ScenePart as BlocksPart } from "../index.js";
import type { ScenePart as ServerPart } from "../server.js";
import type { ScenePart as RootPart } from "../../index.js";

type WithoutTilt<T> = "k" extends keyof T ? never : true;
const direct: WithoutTilt<DirectPart> = true;
const scene: WithoutTilt<ScenePart> = true;
const blocks: WithoutTilt<BlocksPart> = true;
const server: WithoutTilt<ServerPart> = true;
const root: WithoutTilt<RootPart> = true;
void [direct, scene, blocks, server, root];
