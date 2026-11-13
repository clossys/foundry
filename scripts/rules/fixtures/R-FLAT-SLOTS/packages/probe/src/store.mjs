import { readFileSync } from "node:fs";
import { join } from "node:path";

export const tree = root => readFileSync(join(root, "tree.json"), "utf8");
