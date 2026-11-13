/** Pure write types. Locking, staging, rollback and file access belong to the injected store writer. */
import type { DirectorStoreChange } from "../store-io.js";

export type Change = DirectorStoreChange;
