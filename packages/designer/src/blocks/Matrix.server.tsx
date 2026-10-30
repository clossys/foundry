import type { MatrixQuadrantProps, MatrixGridProps } from "./Matrix.js";
import { MatrixGrid } from "./matrix/grid.js";
import { assertMatrix, MatrixRenderer } from "./matrix/static.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.comparison", "foundry/sections.comparison");

export type { MatrixQuadrantProps, MatrixGridProps, MatrixCellData, MatrixSide, MatrixHeadingLevel } from "./Matrix.js";
/** The server entry supports the two static arrangements; interaction belongs to the ordinary entry. */
export type MatrixProps = MatrixQuadrantProps | MatrixGridProps;

export function Matrix(props: MatrixProps) {
  if (props.arrangement === "grid") return <MatrixGrid {...SECTION_STAMP} {...props} />;
  if (props.arrangement !== undefined && props.arrangement !== "sides") throw new TypeError("Matrix: server entry supports only sides and grid arrangements.");
  assertMatrix(props);
  return <MatrixRenderer {...SECTION_STAMP} {...props} />;
}
