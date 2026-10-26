import type { MatrixQuadrantProps, MatrixGridProps } from "./Matrix.js";
import { MatrixGrid } from "./matrix/grid.js";
import { assertMatrix, MatrixRenderer } from "./matrix/static.js";

export type { MatrixQuadrantProps, MatrixGridProps, MatrixCellData, MatrixSide, MatrixHeadingLevel } from "./Matrix.js";
/** The server entry supports the two static arrangements; interaction belongs to the ordinary entry. */
export type MatrixProps = MatrixQuadrantProps | MatrixGridProps;

export function Matrix(props: MatrixProps) {
  if (props.arrangement === "grid") return <MatrixGrid {...props} />;
  if (props.arrangement !== undefined && props.arrangement !== "sides") throw new TypeError("Matrix: server entry supports only sides and grid arrangements.");
  assertMatrix(props);
  return <MatrixRenderer {...props} />;
}
