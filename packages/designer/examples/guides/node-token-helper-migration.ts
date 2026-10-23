import { checkBrandFileCoverage } from "@clossys/designer/tokens";
import { readBrandCss } from "@clossys/designer/tokens/server";

const read = readBrandCss("src/styles/brand.css");
const coverage = checkBrandFileCoverage(read.declarations);
export { coverage };
