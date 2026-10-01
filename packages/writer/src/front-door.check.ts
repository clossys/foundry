// Compile-time assertions for the front-door copy kind. This file has no
// runtime footprint and is not exported from `index.ts`; `tsc` compiling it is
// the check.

import { resolveFrontDoorCopy } from "./front-door.js";

// @ts-expect-error unknown front-door key
resolveFrontDoorCopy("front-door.sign-in.heading", {});

resolveFrontDoorCopy("front-door.sign-in.title", {});
