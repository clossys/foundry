// Rules fixture: shipped code that opens a pin by hand instead of through the one slot-model reader.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const pinOf = (consumer, id) => JSON.parse(readFileSync(join(consumer, "agents", "designer", id, "pin.json"), "utf8"));
