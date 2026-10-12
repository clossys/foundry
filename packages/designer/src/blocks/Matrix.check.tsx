import { Matrix, type MatrixSide } from "./Matrix.js";

const side: MatrixSide = { id: "left", label: "First", heading: "A shared view", points: ["One", "Two"] };
void <Matrix sides={[side, { ...side, id: "right" }]} featured="right" ground="inverse" headingLevel={4} />;
// @ts-expect-error Exactly two sides are required.
void <Matrix sides={[side]} />;
// @ts-expect-error Every side needs a stable id.
const missingId: MatrixSide = { label: "First", heading: "A shared view", points: ["One", "Two"] };
// @ts-expect-error Matrix side headings are required.
const missingHeading: MatrixSide = { id: "left", label: "First", points: ["One", "Two"] };
// A side may omit the label; its required heading supplies the semantic heading.
const unlabeled: MatrixSide = { id: "left", heading: "A shared view", points: ["One", "Two"] };
void <Matrix sides={[unlabeled, { ...unlabeled, id: "right" }]} headingLevel={4} />;
// @ts-expect-error A third side is outside the current contract.
void <Matrix sides={[side, side, side]} />;
// @ts-expect-error Grounds are closed.
void <Matrix sides={[side, side]} ground="other" />;
// @ts-expect-error The side label is below the page heading.
void <Matrix sides={[side, side]} headingLevel={1} />;
void missingId;
void missingHeading;
void unlabeled;
