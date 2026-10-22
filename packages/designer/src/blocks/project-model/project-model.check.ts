import type { Task } from "../index.js";

// This contract is compiled by the production TypeScript configuration.
// @ts-expect-error dependencies only support finish-to-start
const invalid: Task = { id: "b", title: "B", status: "todo", deps: [{ id: "a", type: "start-to-start" }] };

void invalid;
