/**
 * Director owns no filesystem access to its strategy store; tests inject the one real
 * store, producer's slot-model reader (records/slots.ts) and writer (records/slot-write.ts),
 * exactly as `clossys director …` does.
 */
import { directorStore } from "../../producer/src/records/slot-write.js";

export const store = directorStore;
export const reader = directorStore.reader;
export const writer = directorStore.writer;
